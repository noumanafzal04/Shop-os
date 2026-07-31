<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Enums\PurchaseStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchase\ReceivePurchaseOrderRequest;
use App\Http\Requests\Purchase\StorePurchaseOrderRequest;
use App\Models\PurchaseOrder;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseOrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = PurchaseOrder::query()
            ->with('supplier:id,name')
            ->withCount('items')
            ->when($request->query('search'), fn ($q, $s) => $q->where('po_number', 'like', "%{$s}%"))
            ->when($request->query('status'), fn ($q, $st) => $q->where('status', $st))
            ->when($request->query('supplier_id'), fn ($q, $id) => $q->where('supplier_id', $id))
            ->orderByDesc('created_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($orders);
    }

    public function store(StorePurchaseOrderRequest $request, CreatePurchaseOrderAction $action): JsonResponse
    {
        $po = $action->execute($request->validated());

        return ApiResponse::created($po, 'Purchase order created');
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            // Expose each line's product serialization/expiry flags so the
            // Receive dialog can prompt for serials (serialized goods) and a
            // batch/expiry (medicines) on the right lines only.
            PurchaseOrder::query()
                ->with(['supplier', 'items.product:id,tracks_serial,item_type', 'payments'])
                ->findOrFail($id),
        );
    }

    /** Move a draft to ordered (so goods can be received). */
    public function place(string $id): JsonResponse
    {
        /** @var PurchaseOrder $po */
        $po = PurchaseOrder::query()->findOrFail($id);

        if ($po->status !== PurchaseStatus::Draft) {
            throw DomainException::conflict('Only draft orders can be placed.', 'PO_NOT_DRAFT');
        }

        $po->forceFill(['status' => PurchaseStatus::Ordered])->save();

        return ApiResponse::ok($po->load('supplier', 'items'), 'Purchase order placed');
    }

    public function receive(ReceivePurchaseOrderRequest $request, string $id, ReceivePurchaseOrderAction $action): JsonResponse
    {
        $po = PurchaseOrder::query()->findOrFail($id);
        $updated = $action->execute($po, $request->receiveMap(), $request->validated('idempotency_key'));

        return ApiResponse::ok($updated, 'Goods received into inventory');
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        /** @var PurchaseOrder $po */
        $po = PurchaseOrder::query()->findOrFail($id);

        if (! $po->status->isOpen()) {
            throw DomainException::conflict('This purchase order can no longer be cancelled.', 'PO_NOT_CANCELLABLE');
        }

        // Received goods stay in stock; only the outstanding order is voided.
        $po->forceFill([
            'status' => PurchaseStatus::Cancelled,
            'cancel_reason' => $request->input('reason'),
        ])->save();

        return ApiResponse::ok($po->load('supplier', 'items'), 'Purchase order cancelled');
    }
}
