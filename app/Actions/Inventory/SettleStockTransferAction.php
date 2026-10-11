<?php

namespace App\Actions\Inventory;

use App\Exceptions\DomainException;
use App\Models\StockTransfer;
use App\Models\StockTransferItem;
use App\Services\InventoryService;
use App\Support\StockPlace;
use App\Support\TransferLots;
use Illuminate\Support\Facades\DB;

/**
 * Decide what became of stock that left and did not arrive.
 *
 * Two answers, and they are the sender's to give, because it is the sender's
 * books the goods left:
 *
 *   returned     it never went, or it came back. It goes on the sender's
 *                shelf again, as the lots it was.
 *   written_off  it is gone — broken in the van, lost on the way. Nothing
 *                moves: it left the sender when it was sent, and it stays
 *                left. The transfer keeps the quantity and the reason.
 *
 * Until every short line has one, the transfer stays `short` and the place
 * that sent it cannot be deleted.
 */
class SettleStockTransferAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  string  $outcome  what happened to every unsettled line…
     * @param  array<string, string>  $perItem  …unless a line says otherwise (item id → outcome)
     */
    public function execute(StockTransfer $transfer, string $outcome, array $perItem = []): StockTransfer
    {
        StockPlace::mustActAt(auth()->user(), $transfer->from_branch_id, 'settle a shortage for stock sent from');

        return DB::transaction(function () use ($transfer, $outcome, $perItem): StockTransfer {
            /** @var StockTransfer $transfer */
            $transfer = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();

            if ($transfer->status !== StockTransfer::SHORT) {
                throw DomainException::conflict(
                    "Transfer {$transfer->reference} has no shortage waiting to be settled.",
                    'TRANSFER_NOTHING_TO_SETTLE',
                );
            }

            /** @var StockTransferItem $item */
            foreach ($transfer->items()->get() as $item) {
                if (! $item->isUnsettled()) {
                    continue;
                }

                $decided = $perItem[$item->id] ?? $outcome;

                if ($decided === StockTransfer::OUTCOME_RETURNED) {
                    $short = $item->short();
                    // What did not arrive is what was left AFTER the lots that did.
                    [, $comingBack] = TransferLots::split($item->lots ?? [], (float) $item->quantity_received);

                    $this->inventory->adjust([
                        'product_id' => $item->product_id,
                        'variant_id' => $item->variant_id,
                        'branch_id' => $transfer->from_branch_id,
                        'type' => 'in',
                        'quantity' => $short,
                        'reason' => "Transfer {$transfer->reference} — short, put back",
                        'reference_type' => 'transfer',
                        'reference_id' => $transfer->id,
                        'idempotency_key' => "transfer-{$transfer->id}-{$item->id}-back",
                        'lots_placed' => $comingBack !== [],
                    ]);

                    TransferLots::putDown($transfer->tenant_id, $transfer->from_branch_id, $item->product_id, $item->variant_id, $comingBack);
                }

                $item->forceFill(['short_outcome' => $decided])->save();
            }

            $transfer->forceFill([
                'status' => StockTransfer::COMPLETED,
                'settled_at' => now(),
                'settled_by' => auth()->id(),
            ])->save();

            return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
        });
    }
}
