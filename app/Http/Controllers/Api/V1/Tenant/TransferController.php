<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Inventory\TransferStockAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\StoreTransferRequest;
use App\Models\StockTransfer;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

class TransferController extends Controller
{
    /** Transfer history — most recent first, with branches + line items. */
    public function index(): JsonResponse
    {
        $transfers = StockTransfer::query()
            ->with(['fromBranch:id,name', 'toBranch:id,name', 'items:id,stock_transfer_id,product_name,quantity'])
            ->latest()
            ->paginate(20);

        return ApiResponse::paginated($transfers);
    }

    /** Move stock between two branches (immediate + audited). */
    public function store(StoreTransferRequest $request, TenantContext $context, TransferStockAction $action): JsonResponse
    {
        $transfer = $action->execute($context->get(), $request->validated());

        return ApiResponse::created($transfer, 'Stock transferred');
    }
}
