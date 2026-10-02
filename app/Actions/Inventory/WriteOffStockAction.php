<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\StockDisposal;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\DocumentCounter;
use Illuminate\Support\Facades\DB;

/**
 * WRITING OFF STOCK THAT WAS NEVER IN A LOT.
 *
 * The Disposals module answers one question — what did the shop lose, and what
 * is a distributor still due to credit back — and until now only a PHARMACY
 * could answer it. The sole way to create a disposal was to delete a BATCH,
 * and a mart, a clothing shop, a hardware store or a tyre shop keeps most of
 * its stock in no batch at all.
 *
 * Those shops were not left without a way to take the stock off the shelf.
 * They were left without a way to record what it COST them, because the path
 * they actually use — Inventory → Adjust → out, reason "Damaged" — writes a
 * `stock_movements` row, and that table has no money column of any kind. Three
 * broken cartons came off the shelf correctly and the year's shrinkage could
 * not be totalled at all, on a screen the shop was given, which says in its own
 * words: "Stock that left without being sold — binned, or sent back for credit."
 *
 * ── WHY THIS REFUSES A LOT-TRACKED ITEM ─────────────────────────────
 *
 * A disposal row carries ONE batch number and ONE expiry. Writing off six
 * strips of a medicine held in four lots would have to either invent a lot or
 * silently pick one, and the figure a pharmacist needs — which lot went in the
 * bin — would be wrong in a way nothing downstream could detect. So an item
 * holding live lots is refused here and sent to the lot itself, where the
 * expiry and the lot's own cost travel with the record.
 *
 * ── THE COST ────────────────────────────────────────────────────────
 *
 * `products.cost` is the blended moving average maintained on every receipt,
 * so it is what the shop actually paid for the units on the shelf now. A
 * variant's own cost wins where it has one. Where NOTHING is recorded the cost
 * stays NULL and does not become zero — zero is a claim that the carton was
 * free, and `DisposeBatchAction` already draws that distinction.
 */
class WriteOffStockAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array{
     *     product_id: string, variant_id?: ?string, branch_id?: ?string,
     *     quantity: float|int|string, disposition: string, reason: string,
     *     notes?: ?string, supplier_id?: ?string, credit_expected?: float|int|string|null
     * }  $data
     */
    public function execute(User $user, array $data): StockDisposal
    {
        return DB::transaction(function () use ($user, $data): StockDisposal {
            /** @var Product $product */
            $product = Product::query()->whereKey($data['product_id'])->firstOrFail();

            $variant = null;
            if (! empty($data['variant_id'])) {
                /** @var ProductVariant $variant */
                $variant = ProductVariant::query()
                    ->whereKey($data['variant_id'])
                    ->where('product_id', $product->id)
                    ->firstOrFail();
            }

            $branchId = $data['branch_id'] ?? null;
            $quantity = round((float) $data['quantity'], 3);

            // A LOT-TRACKED ITEM GOES OUT BY ITS LOT. See the class comment.
            $lots = ProductBatch::query()
                ->where('product_id', $product->id)
                ->when($variant !== null, fn ($q) => $q->where('variant_id', $variant->id))
                ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
                ->where('quantity', '>', 0)
                ->count();

            if ($lots > 0) {
                throw DomainException::unprocessable(
                    '"'.$product->name.'" is tracked by lot. Write off the lot itself, '
                        .'so its batch number, its expiry and what that lot cost go with the record.',
                    'WRITE_OFF_IS_LOT_TRACKED',
                );
            }

            $unitCost = $variant?->cost !== null
                ? (float) $variant->cost
                : ($product->cost === null ? null : (float) $product->cost);

            $disposal = StockDisposal::query()->create([
                'branch_id' => $branchId,
                'number' => DocumentCounter::formatted($user->tenant_id, 'stock_disposal', 'DSP'),
                'product_id' => $product->id,
                'variant_id' => $variant?->id,
                // Snapshotted, like every other document here: a disposal is
                // read months later and the product may have been renamed or
                // removed by then.
                'product_name' => trim($product->name.($variant !== null ? ' — '.$variant->name : '')),
                'batch_number' => null,
                'expiry_date' => null,
                'quantity' => $quantity,
                'unit_cost' => $unitCost,
                'total_cost' => $unitCost === null ? null : round($unitCost * $quantity, 2),
                'disposition' => $data['disposition'],
                'reason' => $data['reason'],
                'notes' => $data['notes'] ?? null,
                // Only something sent BACK has a party to claim from — the same
                // rule DisposeBatchAction applies, and for the same reason: a
                // supplier on a binned carton is a claim nobody can make.
                'supplier_id' => $data['disposition'] === StockDisposal::RETURNED
                    ? ($data['supplier_id'] ?? null)
                    : null,
                'credit_expected' => $data['disposition'] === StockDisposal::RETURNED
                    ? ($data['credit_expected'] ?? null)
                    : null,
                'disposed_at' => now(),
            ]);

            // The stock itself moves through the ONE path that owns stock
            // arithmetic — including its refusal to go negative and its refusal
            // to adjust the parent of a sized item, neither of which this
            // action should be re-deciding.
            if ($product->track_inventory) {
                $movement = $this->inventory->adjust([
                    'product_id' => $product->id,
                    'variant_id' => $variant?->id,
                    'branch_id' => $branchId,
                    'type' => 'out',
                    'quantity' => $quantity,
                    'reason' => ($data['disposition'] === StockDisposal::RETURNED
                        ? 'Returned to supplier'
                        : 'Written off').' ('.$data['reason'].') · '.$disposal->number,
                    'reference_type' => 'stock_disposal',
                    'reference_id' => $disposal->id,
                    'idempotency_key' => "write-off-{$disposal->id}",
                ]);

                $disposal->forceFill(['stock_movement_id' => $movement->id])->save();
            }

            return $disposal->fresh(['supplier:id,name']);
        });
    }
}
