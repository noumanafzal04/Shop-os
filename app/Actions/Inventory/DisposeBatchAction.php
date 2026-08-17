<?php

namespace App\Actions\Inventory;

use App\Models\ProductBatch;
use App\Models\StockDisposal;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\DocumentCounter;
use Illuminate\Support\Facades\DB;

/**
 * Take a batch off the shelf, and say where it went.
 *
 * ── Why this is not just a delete ───────────────────────────────────────
 *
 * Removing a batch used to write one stock movement whose reason was the
 * generated string "Batch X removed/expired", and then hard-delete the row. The
 * stock arithmetic was right. Everything a pharmacist needs afterwards was not
 * recorded at all:
 *
 *   - a write-off and a supplier return became the same event
 *   - the lot's cost went with the deleted row, so the year's expiry loss
 *     could not be totalled from figures that existed a moment earlier
 *   - a return had no supplier and no claim, so the money a distributor owes
 *     back was tracked on paper or not at all
 *
 * ── The order of operations is load-bearing ─────────────────────────────
 *
 * The disposal record is written from the batch BEFORE the batch is touched.
 * `batch_number`, `expiry_date` and `cost` are read off a live row; a moment
 * later that row does not exist. Reading them afterwards is precisely the
 * mistake this replaces.
 *
 * ── What it deliberately does not do ────────────────────────────────────
 *
 * It does not post anything to the supplier's ledger. A return is a CLAIM, not
 * a payment: the distributor decides what they will credit and when, and
 * crediting the shop's own books the moment a box leaves the shop would put
 * money in them that nobody has agreed to. The claim is recorded, and settling
 * it is a second, deliberate act.
 */
class DisposeBatchAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array{
     *     disposition: string, reason: string, notes?: ?string,
     *     supplier_id?: ?string, credit_expected?: float|int|string|null
     * }  $data
     */
    public function execute(User $user, ProductBatch $batch, array $data): ?StockDisposal
    {
        return DB::transaction(function () use ($user, $batch, $data): ?StockDisposal {
            $remaining = (float) $batch->quantity;

            // Everything worth keeping, read while the row still exists.
            $unitCost = $batch->cost === null ? null : (float) $batch->cost;
            $disposal = $remaining <= 0 ? null : StockDisposal::query()->create([
                'branch_id' => $batch->branch_id,
                'number' => DocumentCounter::formatted($user->tenant_id, 'stock_disposal', 'DSP'),
                'product_id' => $batch->product_id,
                'variant_id' => $batch->variant_id,
                'product_name' => $batch->product?->name ?? '—',
                'batch_number' => $batch->batch_number,
                'expiry_date' => $batch->expiry_date,
                'quantity' => $remaining,
                'unit_cost' => $unitCost,
                // Null cost stays null rather than becoming zero. Zero is a
                // claim that this lot cost nothing; null says nobody recorded
                // it, and a report can show the difference.
                'total_cost' => $unitCost === null ? null : round($unitCost * $remaining, 2),
                'disposition' => $data['disposition'],
                'reason' => $data['reason'],
                'notes' => $data['notes'] ?? null,
                // Only a return has a party to claim from.
                'supplier_id' => $data['disposition'] === StockDisposal::RETURNED
                    ? ($data['supplier_id'] ?? null)
                    : null,
                'credit_expected' => $data['disposition'] === StockDisposal::RETURNED
                    ? ($data['credit_expected'] ?? null)
                    : null,
                'disposed_at' => now(),
            ]);

            // Zero the batch FIRST so the FEFO hook cannot double-deplete it,
            // then move the stock. `reference_type: 'batch'` is what tells
            // InventoryService this movement reconciles stock TO the batch rows
            // rather than eating other lots — see the batchScope comment there.
            $batch->update(['quantity' => 0]);

            if ($remaining > 0 && $batch->product?->track_inventory) {
                $movement = $this->inventory->adjust([
                    'product_id' => $batch->product_id,
                    'variant_id' => $batch->variant_id,
                    'branch_id' => $batch->branch_id,
                    'type' => 'out',
                    'quantity' => $remaining,
                    // The reason now says which of the three things happened,
                    // rather than covering all of them with one string.
                    'reason' => $this->reasonLine($batch, $data),
                    'reference_type' => 'batch',
                    'reference_id' => $batch->id,
                    'idempotency_key' => "batch-out-{$batch->id}",
                ]);

                $disposal?->forceFill(['stock_movement_id' => $movement->id])->save();
            }

            $batch->delete();

            return $disposal?->fresh(['supplier:id,name']);
        });
    }

    /** @param array<string, mixed> $data */
    private function reasonLine(ProductBatch $batch, array $data): string
    {
        $what = $data['disposition'] === StockDisposal::RETURNED
            ? 'returned to supplier'
            : 'written off';

        return trim("Batch {$batch->batch_number} {$what} ({$data['reason']})");
    }
}
