<?php

namespace App\Actions\Inventory;

use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Support\StockPlace;
use Illuminate\Support\Facades\DB;

/**
 * Ask another place for stock.
 *
 * A keeper works at one place and may not help themselves to another's shelf
 * — which is right, and left a shop with no way to get what the godown held
 * except to telephone somebody who could. So the place that NEEDS the stock
 * raises the transfer, as a request: nothing moves, nothing is promised, and
 * the place that holds it sees what was asked for and answers
 * (`SendStockTransferAction::fulfil`) or declines.
 *
 * Whoever asks must work at the place it is for. It is not checked against
 * what the other place holds: the asker cannot see that shelf's future, and a
 * request for forty when there are twenty is answered with twenty.
 *
 * @phpstan-import-type Line from SendStockTransferAction
 */
class RequestStockTransferAction
{
    /**
     * @param  array{from_branch_id: string, to_branch_id: string, notes?: ?string, items: array<int, Line>}  $data
     */
    public function execute(Tenant $tenant, array $data): StockTransfer
    {
        SendStockTransferAction::twoOpenPlaces($tenant, $data);
        StockPlace::mustActAt(auth()->user(), $data['to_branch_id'], 'ask for stock for');

        return DB::transaction(function () use ($tenant, $data): StockTransfer {
            $transfer = SendStockTransferAction::open($tenant, $data, StockTransfer::REQUESTED);
            SendStockTransferAction::lines($tenant, $transfer, $data['items'], asked: true);

            return $transfer->load('items', 'fromBranch:id,name,kind', 'toBranch:id,name,kind');
        });
    }
}
