<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\AppNotification;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\StockMovement;
use App\Support\Permissions;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * THE single write-path for stock. Nothing else in the codebase mutates
 * stock_quantity — sales (Step 9) and reservations (Step 13) all come
 * through here, so every unit is accounted for in stock_movements.
 *
 * Edge cases handled:
 *  - concurrent updates    → row lock (SELECT ... FOR UPDATE) inside a
 *                            transaction; two devices selling the last item
 *                            serialize, the second one fails cleanly
 *  - stock going negative  → INSUFFICIENT_STOCK, nothing applied
 *  - duplicate submission  → idempotency_key replays the original movement
 *                            without applying twice
 *  - service items         → PRODUCT_NOT_TRACKED (services have no stock)
 */
class InventoryService
{
    public function __construct(private readonly NotificationService $notifications) {}

    /**
     * @param array{
     *   product_id: string, variant_id?: ?string, branch_id?: ?string,
     *   type: 'in'|'out'|'set', quantity?: int, new_quantity?: int,
     *   reason?: ?string, idempotency_key?: ?string,
     *   reference_type?: ?string, reference_id?: ?string
     * } $data
     *
     * branch_id defaults to the tenant's default "Main" branch when omitted.
     */
    public function adjust(array $data): StockMovement
    {
        // Replay path: same key → same result, no double-apply.
        if (! empty($data['idempotency_key'])) {
            $existing = StockMovement::query()
                ->where('idempotency_key', $data['idempotency_key'])
                ->first();

            if ($existing !== null) {
                return $existing;
            }
        }

        try {
            return DB::transaction(function () use ($data): StockMovement {
                // Lock the product row — concurrent adjustments serialize here.
                /** @var Product $product */
                $product = Product::query()
                    ->whereKey($data['product_id'])
                    ->lockForUpdate()
                    ->firstOrFail();

                if (! $product->track_inventory) {
                    throw DomainException::unprocessable(
                        'This item does not track inventory.',
                        'PRODUCT_NOT_TRACKED',
                    );
                }

                $variant = null;
                if (! empty($data['variant_id'])) {
                    /** @var ProductVariant $variant */
                    $variant = ProductVariant::query()
                        ->whereKey($data['variant_id'])
                        ->where('product_id', $product->id)
                        ->lockForUpdate()
                        ->firstOrFail();
                }

                $target = $variant ?? $product;

                // Which branch's stock does this touch? Callers that don't care
                // (the vast majority — single-branch shops) get the tenant's
                // default "Main" branch, so behaviour is unchanged.
                $defaultBranchId = Branch::withoutTenancy()
                    ->where('tenant_id', $product->tenant_id)
                    ->where('is_default', true)
                    ->value('id');
                $branchId = $data['branch_id'] ?? $defaultBranchId;

                // Per-branch on-hand is the source of truth. Lock it (the product
                // row lock above already serialises adjusts for this product).
                $stockRow = BranchStock::withoutTenancy()
                    ->where('branch_id', $branchId)
                    ->where('product_id', $product->id)
                    ->where('variant_id', $variant?->id)
                    ->lockForUpdate()
                    ->first();
                // Missing row on the DEFAULT branch → seed on-hand from the legacy
                // rollup (product/variant.stock_quantity), which historically lived
                // entirely at Main. This makes products created outside the
                // branch_stock path (tests, direct creates, pre-migration data)
                // self-heal on first adjust. Other branches start empty.
                $current = $stockRow !== null
                    ? (float) $stockRow->quantity
                    : ($branchId === $defaultBranchId ? (float) $target->stock_quantity : 0.0);

                // When touching a NON-default branch, first make sure the default
                // branch's row exists (seeded from the legacy rollup). Otherwise the
                // rollup recompute below would sum only existing rows and silently
                // drop stock that had only ever lived in product.stock_quantity.
                if ($branchId !== $defaultBranchId) {
                    $hasDefaultRow = BranchStock::withoutTenancy()
                        ->where('branch_id', $defaultBranchId)
                        ->where('product_id', $product->id)
                        ->where('variant_id', $variant?->id)
                        ->exists();
                    if (! $hasDefaultRow) {
                        BranchStock::withoutTenancy()->create([
                            'tenant_id' => $product->tenant_id,
                            'branch_id' => $defaultBranchId,
                            'product_id' => $product->id,
                            'variant_id' => $variant?->id,
                            'quantity' => (float) $target->stock_quantity,
                        ]);
                    }
                }

                // Quantities are decimal(12,3) — weight/length items sell fractions.
                $delta = match ($data['type']) {
                    'in' => (float) $data['quantity'],
                    'out' => -(float) $data['quantity'],
                    'set' => (float) $data['new_quantity'] - $current,
                };

                $newQuantity = round($current + $delta, 3);

                // Recipe/BOM ingredient depletion passes allow_negative: a dish is
                // made to order, so an under-recorded ingredient must never block
                // the sale (least of all a dine-in settle for food already served).
                // Stock simply goes negative — a visible "recount / restock" signal.
                $allowNegative = ! empty($data['allow_negative']);

                if ($newQuantity < 0 && ! $allowNegative) {
                    // NAME THE ITEM. This message reached the counter, the
                    // order form and the transfer screen as "Insufficient
                    // stock: only 0 in stock." — a refusal with nothing in it
                    // anybody could act on. A basket of nine things told the
                    // shop one of them was short and would not say which, so
                    // the only way through was to remove lines one at a time.
                    $named = trim($product->name.($variant !== null ? ' ('.$variant->name.')' : ''));

                    throw DomainException::unprocessable(
                        "Not enough {$named}: only {$current} in stock.",
                        'INSUFFICIENT_STOCK',
                    );
                }

                // ── Batch/expiry integrity. Batches are scoped to the exact stock
                // target: product-level lots carry variant_id = NULL, variant lots
                // carry that variant's id (so a medicine's 250mg vs 500mg strips
                // each get their own FEFO + expiry fence). Batch housekeeping itself
                // (reference_type 'batch': add/remove on the Batches page) is
                // exempt — those movements reconcile stock TO the batch rows and
                // must neither re-deplete nor re-fill other batches.
                $batchScope = ($data['reference_type'] ?? null) !== 'batch';
                $batchVariantId = $variant?->id;
                // Match this target's lots only, at THIS branch (NULL variant →
                // product-level lots). Lots are per-branch, mirroring stock.
                $scopeVariant = function ($q) use ($batchVariantId, $branchId) {
                    $q->where('branch_id', $branchId);

                    return $batchVariantId === null
                        ? $q->whereNull('variant_id')
                        : $q->where('variant_id', $batchVariantId);
                };

                // Expired stock is UNSELLABLE. Block any OUT that would dip into
                // quantity sitting in expired batches — the pharmacist must remove
                // the expired batch (a batch-scoped OUT) before that stock moves.
                // Best-effort recipe depletion (allow_negative) is exempt: it never
                // blocks, and FEFO below still eats the freshest lots first.
                if ($data['type'] === 'out' && $batchScope && ! $allowNegative) {
                    $expired = (float) ProductBatch::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where($scopeVariant)
                        ->where('quantity', '>', 0)
                        ->whereNotNull('expiry_date')
                        ->whereDate('expiry_date', '<', today())
                        ->lockForUpdate()
                        ->sum('quantity');

                    if ($expired > 0) {
                        $sellable = max(0, round($current - $expired, 3));
                        if ((float) $data['quantity'] > $sellable) {
                            throw DomainException::unprocessable(
                                "Only {$sellable} sellable in stock — {$expired} is in expired batches. Remove the expired batch(es) from the Batches screen first.",
                                'STOCK_EXPIRED',
                            );
                        }
                    }
                }

                // Write the per-branch on-hand (the source of truth)…
                if ($stockRow !== null) {
                    $stockRow->forceFill(['quantity' => $newQuantity])->save();
                } else {
                    $stockRow = BranchStock::withoutTenancy()->create([
                        'tenant_id' => $product->tenant_id,
                        'branch_id' => $branchId,
                        'product_id' => $product->id,
                        'variant_id' => $variant?->id,
                        'quantity' => $newQuantity,
                    ]);
                }

                // …then refresh the denormalised rollup so every existing read
                // (marketplace, low-stock, product display) sees the total across
                // branches. Single-branch shops: rollup == the one Main row.
                $rollup = (float) BranchStock::withoutTenancy()
                    ->where('product_id', $product->id)
                    ->where('variant_id', $variant?->id)
                    ->sum('quantity');
                $target->forceFill(['stock_quantity' => round($rollup, 3)])->save();

                // Which lots this movement actually touched. Recorded on the
                // movement below, because a recall is only answerable if the
                // consumption was written down at the moment it happened — the
                // batch rows themselves are gone or changed by the time anyone
                // asks who got the bad stock.
                $allocations = [];

                // FEFO batch depletion: stock OUT eats the earliest-expiring
                // NON-EXPIRED batches first (expired quantity was fenced off
                // above and stays put until explicitly removed).
                if ($data['type'] === 'out' && $batchScope) {
                    $remaining = (float) $data['quantity'];
                    $batches = ProductBatch::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where($scopeVariant)
                        ->where('quantity', '>', 0)
                        ->where(fn ($q) => $q->whereNull('expiry_date')->orWhereDate('expiry_date', '>=', today()))
                        ->oldestFirst()
                        ->lockForUpdate()
                        ->get();
                    foreach ($batches as $batch) {
                        if ($remaining <= 0) {
                            break;
                        }
                        $take = min((float) $batch->quantity, $remaining);
                        $batch->update(['quantity' => round((float) $batch->quantity - $take, 3)]);
                        $remaining = round($remaining - $take, 3);
                        $allocations[] = [
                            'batch_id' => $batch->id,
                            'batch_number' => $batch->batch_number,
                            'expiry_date' => $batch->expiry_date?->toDateString(),
                            'quantity' => round($take, 3),
                        ];
                    }
                }

                // Reverse of FEFO: stock coming BACK from a hold or return goes
                // into the earliest-expiring non-expired batch — the one FEFO
                // depleted — keeping batch totals in step with stock_quantity.
                // Plain manual/purchase INs are new, unbatched stock; batches for
                // those are created by their own flows (Batches page, PO receive).
                if ($data['type'] === 'in' && $batchScope
                    && in_array($data['reference_type'] ?? null,
                        ['sale_return', 'sale_cancellation', 'order_release', 'reservation_release', 'transfer'], true)) {
                    $restoreTo = ProductBatch::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where($scopeVariant)
                        ->where(fn ($q) => $q->whereNull('expiry_date')->orWhereDate('expiry_date', '>=', today()))
                        ->oldestFirst()
                        ->lockForUpdate()
                        ->first();
                    if ($restoreTo !== null) {
                        $restoreTo->update([
                            'quantity' => round((float) $restoreTo->quantity + (float) $data['quantity'], 3),
                        ]);
                    } elseif (ProductBatch::withoutTenancy()
                        ->where('product_id', $product->id)
                        ->where($scopeVariant)
                        ->exists()
                    ) {
                        // Batch-managed target but every lot is expired (or empty
                        // history): without a lot the returned quantity would sit
                        // outside batch accounting — unfenced and invisible to
                        // FEFO. Land it in a fresh undated RESTOCK lot (undated
                        // sells LAST) so lot totals stay equal to stock and the
                        // pharmacist can date or write it off from Batches.
                        ProductBatch::withoutTenancy()->create([
                            'tenant_id' => $product->tenant_id,
                            'branch_id' => $branchId,
                            'product_id' => $product->id,
                            'variant_id' => $batchVariantId,
                            'batch_number' => 'RESTOCK',
                            'expiry_date' => null,
                            'quantity' => round((float) $data['quantity'], 3),
                        ]);
                    }
                }

                // Low-stock alert — only on CROSSING the threshold (not every
                // sale below it) and deduped per item until it recovers.
                $threshold = $target->low_stock_threshold;
                if ($threshold !== null) {
                    if ($current > $threshold && $newQuantity <= $threshold) {
                        $label = $variant !== null ? "{$product->name} / {$variant->name}" : $product->name;
                        // Whoever REORDERS, not merely whoever owns the shop.
                        // A stock keeper holding `inventory.manage` was never
                        // told a shelf had run down — the one person the alert
                        // is for. At the branch that ran down, because a chain
                        // told about every other branch's shelves stops reading
                        // any of them.
                        $this->notifications->notifyWhoCanAct(
                            $product->tenant_id,
                            Permissions::INVENTORY_MANAGE,
                            'stock.low',
                            'Low stock alert',
                            "{$label} is down to {$newQuantity} (alert level {$threshold}).",
                            ['product_id' => $product->id, 'variant_id' => $variant?->id],
                            "low-stock-{$target->id}",
                            $branchId,
                        );
                    } elseif ($current <= $threshold && $newQuantity > $threshold) {
                        // Recovered — clear the dedupe so the NEXT drop alerts again.
                        AppNotification::query()
                            ->where('dedupe_key', 'like', "low-stock-{$target->id}:%")
                            ->update(['dedupe_key' => null]);
                    }
                }

                return StockMovement::query()->create([
                    'tenant_id' => $product->tenant_id,
                    'branch_id' => $branchId,
                    'product_id' => $product->id,
                    'variant_id' => $variant?->id,
                    'type' => $data['type'],
                    'quantity_change' => $delta,
                    'quantity_after' => $newQuantity,
                    'reason' => $data['reason'] ?? null,
                    'batch_allocations' => $allocations === [] ? null : $allocations,
                    'reference_type' => $data['reference_type'] ?? null,
                    'reference_id' => $data['reference_id'] ?? null,
                    'idempotency_key' => $data['idempotency_key'] ?? null,
                    'created_by' => auth()->id(),
                ]);
            });
        } catch (QueryException $e) {
            // Concurrent same-key adjustment won the race — the loser's txn
            // rolled back (row lock prevents any double-apply); return the
            // original movement instead of a unique-constraint 500.
            if (! empty($data['idempotency_key']) && (string) $e->getCode() === '23000') {
                $existing = StockMovement::query()->where('idempotency_key', $data['idempotency_key'])->first();
                if ($existing !== null) {
                    return $existing;
                }
            }
            throw $e;
        }
    }
}
