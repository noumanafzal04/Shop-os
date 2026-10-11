<?php

namespace App\Actions\Inventory;

use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Support\StockPlace;
use Illuminate\Support\Facades\DB;

/**
 * Move stock from one place to another in a single step — out of the source
 * and into the destination together, or not at all.
 *
 * This is the transfer for a godown that is the room behind the shop: the
 * person moving the cartons is standing at both ends, and asking them to
 * "send" and then "receive" their own armful is ceremony. Anything that
 * travels — a van, another street, another pair of hands — is sent and then
 * received, and those are `SendStockTransferAction` and
 * `ReceiveStockTransferAction`.
 *
 * It is exactly those two, one after the other inside one transaction, so
 * there is one way stock leaves a place and one way it arrives. Because it
 * acts at both ends, whoever does it must be allowed at both.
 *
 * @param array{from_branch_id: string, to_branch_id: string, notes?: ?string,
 *   items: array<int, array{product_id: string, variant_id?: ?string, quantity: float}>} $data
 */
class TransferStockAction
{
    public function __construct(
        private readonly SendStockTransferAction $send,
        private readonly ReceiveStockTransferAction $receive,
    ) {}

    public function execute(Tenant $tenant, array $data): StockTransfer
    {
        if ($data['from_branch_id'] !== $data['to_branch_id']) {
            StockPlace::mustActAt(auth()->user(), $data['to_branch_id'], 'move stock into');
        }

        return DB::transaction(fn (): StockTransfer => $this->receive->execute($this->send->execute($tenant, $data)));
    }
}
