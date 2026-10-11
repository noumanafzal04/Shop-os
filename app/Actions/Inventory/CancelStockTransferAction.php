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
 * Call a transfer back before it has been received — or decline one that was
 * only ever asked for.
 *
 * The van never left, or the wrong cartons were loaded. Everything goes back
 * on the sender's shelf, as the lots it was. Once the receiver has counted it
 * in there is nothing to call back — that stock is theirs, and returning it is
 * a transfer the other way.
 *
 * A REQUEST has moved nothing, so there is nothing to put back: the place
 * that was asked says no, or the place that asked thinks better of it. Either
 * end may, because it is each one's answer to give.
 */
class CancelStockTransferAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    public function execute(StockTransfer $transfer): StockTransfer
    {
        $user = auth()->user();
        $asked = $transfer->status === StockTransfer::REQUESTED;

        // A request is either end's to refuse; stock on the road is the sender's to recall.
        if (! ($asked && StockPlace::mayActAt($user, $transfer->to_branch_id))) {
            StockPlace::mustActAt($user, $transfer->from_branch_id, $asked ? 'decline a request for stock from' : 'call back stock sent from');
        }

        return DB::transaction(function () use ($transfer): StockTransfer {
            /** @var StockTransfer $transfer */
            $transfer = StockTransfer::query()->whereKey($transfer->id)->lockForUpdate()->firstOrFail();

            if ($transfer->status === StockTransfer::REQUESTED) {
                $transfer->forceFill([
                    'status' => StockTransfer::CANCELLED,
                    'cancelled_at' => now(),
                    'cancelled_by' => auth()->id(),
                ])->save();

                return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
            }

            if ($transfer->status !== StockTransfer::IN_TRANSIT) {
                throw DomainException::conflict(
                    "Transfer {$transfer->reference} has already been ".($transfer->status === StockTransfer::CANCELLED ? 'called back' : 'received').' — it cannot be called back now.',
                    'TRANSFER_NOT_IN_TRANSIT',
                );
            }

            /** @var StockTransferItem $item */
            foreach ($transfer->items()->get() as $item) {
                $lots = $item->lots ?? [];

                $this->inventory->adjust([
                    'product_id' => $item->product_id,
                    'variant_id' => $item->variant_id,
                    'branch_id' => $transfer->from_branch_id,
                    'type' => 'in',
                    'quantity' => (float) $item->quantity,
                    'reason' => "Transfer {$transfer->reference} — called back",
                    'reference_type' => 'transfer',
                    'reference_id' => $transfer->id,
                    'idempotency_key' => "transfer-{$transfer->id}-{$item->id}-cancel",
                    'lots_placed' => $lots !== [],
                ]);

                TransferLots::putDown($transfer->tenant_id, $transfer->from_branch_id, $item->product_id, $item->variant_id, $lots);
            }

            $transfer->forceFill([
                'status' => StockTransfer::CANCELLED,
                'cancelled_at' => now(),
                'cancelled_by' => auth()->id(),
            ])->save();

            return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
        });
    }
}
