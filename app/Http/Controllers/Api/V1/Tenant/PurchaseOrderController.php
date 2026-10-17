<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\DraftOrdersFromReorderList;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Enums\PurchaseStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchase\FromReorderListRequest;
use App\Http\Requests\Purchase\ReceivePurchaseOrderRequest;
use App\Http\Requests\Purchase\StorePurchaseOrderRequest;
use App\Models\Branch;
use App\Models\PurchaseOrder;
use App\Support\ApiResponse;
use App\Support\Retention;
use App\Support\ShopDay;
use App\Support\StockPlace;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PurchaseOrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = PurchaseOrder::query()
            ->with(['supplier:id,name', 'deliverTo:id,name,kind'])
            ->withCount('items')
            ->when($request->query('search'), fn ($q, $s) => $q->where('po_number', 'like', "%{$s}%"))
            ->when($request->query('status'), fn ($q, $st) => $q->where('status', $st))
            ->when($request->query('supplier_id'), fn ($q, $id) => $q->where('supplier_id', $id))
            ->tap(fn ($q) => ShopDay::between($q, 'created_at', $request->query('from'), $request->query('to')))
            // Older paperwork is archived with everything else. A received PO
            // has already moved the stock, and that stock level is NOT fenced
            // — see App\Support\Retention on why a balance never is.
            ->tap(fn (Builder $q) => Retention::fence($q, 'purchase_orders.created_at'))
            ->orderByDesc('created_at')
            ->stably()->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($orders, meta: array_filter([
            'retention' => Retention::notice($request->query('from')),
        ]));
    }

    public function store(StorePurchaseOrderRequest $request, CreatePurchaseOrderAction $action): JsonResponse
    {
        $po = $action->execute($request->validated());

        return ApiResponse::created($po, 'Purchase order created');
    }

    /**
     * Draft orders straight off the reorder list.
     *
     * One per supplier, because a Monday reorder list holds twenty lines from
     * five distributors and a single order containing all twenty is not an
     * order anybody can send. See DraftOrdersFromReorderList.
     */
    public function fromReorderList(
        FromReorderListRequest $request,
        DraftOrdersFromReorderList $action,
    ): JsonResponse {
        $result = $action->execute($request->validated('product_ids'));
        $count = count($result['orders']);

        $message = $count === 1
            ? '1 draft order raised.'
            : "{$count} draft orders raised, one per supplier.";

        // Named, not silently dropped. A buyer who selected fifteen items and
        // got twelve on orders has to be told which three, and why.
        if ($result['unknown'] !== []) {
            $names = implode(', ', $result['unknown']);
            $message .= " Not included, because they have never been bought before and have no supplier to order from: {$names}.";
        }
        if ($result['sized'] !== []) {
            $message .= ' Not included, because they are sold in sizes — order them size by size: '.implode(', ', $result['sized']).'.';
        }
        if ($result['by_tanker'] !== []) {
            $message .= ' Not included, because it is kept in a tank — take it in from Fuel → Deliveries: '.implode(', ', $result['by_tanker']).'.';
        }

        return ApiResponse::created($result['orders'], $message);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        // Expose each line's product serialization/expiry flags so the
        // Receive dialog can prompt for serials (serialized goods) and a
        // batch/expiry (medicines) on the right lines only.
        $po = PurchaseOrder::query()
            ->with([
                'supplier', 'items.product:id,tracks_serial,item_type', 'payments', 'deliverTo:id,name,kind,is_active',
                // Its payment history: when, how much of this order, and how.
                'allocations' => fn ($q) => $q->oldest(),
                'allocations.payment:id,amount,method,reference,paid_at,notes',
            ])
            ->findOrFail($id);

        return ApiResponse::ok($po->toArray() + ['can' => ['receive' => $this->mayReceive($po, $request->user())]]);
    }

    /**
     * Whether THIS person may take this delivery in (B35).
     *
     * A keeper pinned to the shop was offered "Receive all" on an order
     * addressed to the godown, and pressed it, and was refused. The rule is
     * `StockPlace`'s, asked of the place the delivery would land in — the
     * order's address while that place is open, else where the receiver
     * stands, which is always theirs (see `receive`).
     */
    private function mayReceive(PurchaseOrder $po, mixed $user): bool
    {
        if (! in_array($po->status, [PurchaseStatus::Ordered, PurchaseStatus::PartiallyReceived], true)) {
            return false;
        }

        $address = $po->deliverTo;

        return $address === null || ! $address->is_active || StockPlace::mayActAt($user, $address->id);
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
        // Into the place this receipt names; failing that, the place the
        // ORDER was addressed to — but only while that place is still open.
        // An order addressed to a godown that has since closed is received
        // where its receiver stands, not into a place nobody can count.
        $into = $request->validated('branch_id') ?? Branch::query()
            ->where('is_active', true)
            ->whereKey($po->deliver_to_branch_id)
            ->value('id');
        $updated = $action->execute($po, $request->receiveMap(), $request->validated('idempotency_key'), $into);

        // Say WHERE, for a business with more than one place: "into
        // inventory" does not tell a shop with a godown which of the two just
        // gained forty cartons. With one place there is nothing to tell apart.
        $place = $into !== null && Branch::query()->where('is_active', true)->count() > 1
            ? Branch::query()->whereKey($into)->value('name')
            : null;

        return ApiResponse::ok($updated, $place !== null ? "Goods received into {$place}" : 'Goods received into inventory');
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
