<?php

namespace App\Services;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockMovement;
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
    public function __construct(private readonly NotificationService $notifications)
    {
    }

    /**
     * @param array{
     *   product_id: string, variant_id?: ?string,
     *   type: 'in'|'out'|'set', quantity?: int, new_quantity?: int,
     *   reason?: ?string, idempotency_key?: ?string,
     *   reference_type?: ?string, reference_id?: ?string
     * } $data
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
            $current = (float) $target->stock_quantity;

            // Quantities are decimal(12,3) — weight/length items sell fractions.
            $delta = match ($data['type']) {
                'in' => (float) $data['quantity'],
                'out' => -(float) $data['quantity'],
                'set' => (float) $data['new_quantity'] - $current,
            };

            $newQuantity = round($current + $delta, 3);

            if ($newQuantity < 0) {
                throw DomainException::unprocessable(
                    "Insufficient stock: only {$current} in stock.",
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
            // Match this target's lots only (NULL variant → product-level lots).
            $scopeVariant = fn ($q) => $batchVariantId === null
                ? $q->whereNull('variant_id')
                : $q->where('variant_id', $batchVariantId);

            // Expired stock is UNSELLABLE. Block any OUT that would dip into
            // quantity sitting in expired batches — the pharmacist must remove
            // the expired batch (a batch-scoped OUT) before that stock moves.
            if ($data['type'] === 'out' && $batchScope) {
                $expired = (float) \App\Models\ProductBatch::withoutTenancy()
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

            $target->forceFill(['stock_quantity' => $newQuantity])->save();

            // FEFO batch depletion: stock OUT eats the earliest-expiring
            // NON-EXPIRED batches first (expired quantity was fenced off
            // above and stays put until explicitly removed).
            if ($data['type'] === 'out' && $batchScope) {
                $remaining = (float) $data['quantity'];
                $batches = \App\Models\ProductBatch::withoutTenancy()
                    ->where('product_id', $product->id)
                    ->where($scopeVariant)
                    ->where('quantity', '>', 0)
                    ->where(fn ($q) => $q->whereNull('expiry_date')->orWhereDate('expiry_date', '>=', today()))
                    ->orderByRaw('expiry_date IS NULL, expiry_date')
                    ->lockForUpdate()
                    ->get();
                foreach ($batches as $batch) {
                    if ($remaining <= 0) {
                        break;
                    }
                    $take = min((float) $batch->quantity, $remaining);
                    $batch->update(['quantity' => round((float) $batch->quantity - $take, 3)]);
                    $remaining = round($remaining - $take, 3);
                }
            }

            // Reverse of FEFO: stock coming BACK from a hold or return goes
            // into the earliest-expiring non-expired batch — the one FEFO
            // depleted — keeping batch totals in step with stock_quantity.
            // Plain manual/purchase INs are new, unbatched stock; batches for
            // those are created by their own flows (Batches page, PO receive).
            if ($data['type'] === 'in' && $batchScope
                && in_array($data['reference_type'] ?? null,
                    ['sale_return', 'sale_cancellation', 'order_release', 'reservation_release'], true)) {
                $restoreTo = \App\Models\ProductBatch::withoutTenancy()
                    ->where('product_id', $product->id)
                    ->where($scopeVariant)
                    ->where(fn ($q) => $q->whereNull('expiry_date')->orWhereDate('expiry_date', '>=', today()))
                    ->orderByRaw('expiry_date IS NULL, expiry_date')
                    ->lockForUpdate()
                    ->first();
                if ($restoreTo !== null) {
                    $restoreTo->update([
                        'quantity' => round((float) $restoreTo->quantity + (float) $data['quantity'], 3),
                    ]);
                } elseif (\App\Models\ProductBatch::withoutTenancy()
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
                    \App\Models\ProductBatch::withoutTenancy()->create([
                        'tenant_id' => $product->tenant_id,
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
                    $this->notifications->notifyTenantOwners(
                        $product->tenant_id,
                        'stock.low',
                        'Low stock alert',
                        "{$label} is down to {$newQuantity} (alert level {$threshold}).",
                        ['product_id' => $product->id, 'variant_id' => $variant?->id],
                        "low-stock-{$target->id}",
                    );
                } elseif ($current <= $threshold && $newQuantity > $threshold) {
                    // Recovered — clear the dedupe so the NEXT drop alerts again.
                    \App\Models\AppNotification::query()
                        ->where('dedupe_key', 'like', "low-stock-{$target->id}:%")
                        ->update(['dedupe_key' => null]);
                }
            }

            return StockMovement::query()->create([
                'tenant_id' => $product->tenant_id,
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                'type' => $data['type'],
                'quantity_change' => $delta,
                'quantity_after' => $newQuantity,
                'reason' => $data['reason'] ?? null,
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
