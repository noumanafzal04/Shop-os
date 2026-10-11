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
 * Count a transfer in at the place it was sent to.
 *
 * What arrived goes onto the receiver's shelf, as the lots it left as. A line
 * that arrived short is NOT quietly made up to the full figure and is not
 * quietly written off either: the difference stays on the transfer, with the
 * reason the receiver gave, until somebody at the sending end decides what
 * became of it (`SettleStockTransferAction`). That is the whole point of
 * receiving — thirty cartons left and twenty-eight arrived, and the record has
 * to say so with a name on each end.
 *
 * More than was sent cannot be counted in. If more arrived, more was sent, and
 * that is another transfer.
 */
class ReceiveStockTransferAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array<string, array{quantity_received: float|int|string, short_reason?: ?string}>  $counted
     *                                                                                                      item id → what arrived. A line left out arrived in full.
     */
    public function execute(StockTransfer $transfer, array $counted = []): StockTransfer
    {
        StockPlace::mustActAt(auth()->user(), $transfer->to_branch_id, 'receive stock at');

        return DB::transaction(function () use ($transfer, $counted): StockTransfer {
            /** @var StockTransfer $transfer */
            $transfer = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();

            if ($transfer->status !== StockTransfer::IN_TRANSIT) {
                throw DomainException::conflict(
                    "Transfer {$transfer->reference} has already been ".($transfer->status === StockTransfer::CANCELLED ? 'called back' : 'received').'.',
                    'TRANSFER_NOT_IN_TRANSIT',
                );
            }

            $anyShort = false;

            /** @var StockTransferItem $item */
            foreach ($transfer->items()->get() as $item) {
                $sent = (float) $item->quantity;
                $row = $counted[$item->id] ?? null;
                $received = $row === null ? $sent : round((float) $row['quantity_received'], 3);

                if ($received < 0 || $received > $sent) {
                    throw DomainException::unprocessable(
                        "{$item->product_name}: {$sent} was sent, so between 0 and {$sent} can be received.",
                        'TRANSFER_RECEIVED_OUT_OF_RANGE',
                    );
                }

                $short = round($sent - $received, 3);
                if ($short > 0 && empty($row['short_reason'])) {
                    throw DomainException::unprocessable(
                        "{$item->product_name}: say why {$short} did not arrive — missing or damaged.",
                        'TRANSFER_SHORT_NEEDS_A_REASON',
                    );
                }

                if ($received > 0) {
                    [$arriving] = TransferLots::split($item->lots ?? [], $received);

                    $this->inventory->adjust([
                        'product_id' => $item->product_id,
                        'variant_id' => $item->variant_id,
                        'branch_id' => $transfer->to_branch_id,
                        'type' => 'in',
                        'quantity' => $received,
                        'reason' => "Transfer {$transfer->reference}",
                        'reference_type' => 'transfer',
                        'reference_id' => $transfer->id,
                        'idempotency_key' => "transfer-{$transfer->id}-{$item->id}-in",
                        // The lots that left are put down as themselves, just
                        // below — not folded into whichever lot is open here.
                        'lots_placed' => $arriving !== [],
                    ]);

                    TransferLots::putDown($transfer->tenant_id, $transfer->to_branch_id, $item->product_id, $item->variant_id, $arriving);
                }

                $item->forceFill([
                    'quantity_received' => $received,
                    'short_reason' => $short > 0 ? $row['short_reason'] : null,
                ])->save();

                $anyShort = $anyShort || $short > 0;
            }

            $transfer->forceFill([
                'status' => $anyShort ? StockTransfer::SHORT : StockTransfer::COMPLETED,
                'received_at' => now(),
                'received_by' => auth()->id(),
            ])->save();

            return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
        });
    }
}
