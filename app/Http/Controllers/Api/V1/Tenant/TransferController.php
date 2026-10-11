<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Inventory\CancelStockTransferAction;
use App\Actions\Inventory\ReceiveStockTransferAction;
use App\Actions\Inventory\RequestStockTransferAction;
use App\Actions\Inventory\SendStockTransferAction;
use App\Actions\Inventory\SettleStockTransferAction;
use App\Actions\Inventory\TransferStockAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Inventory\ReceiveTransferRequest;
use App\Http\Requests\Inventory\SendRequestedTransferRequest;
use App\Http\Requests\Inventory\SettleTransferRequest;
use App\Http\Requests\Inventory\StoreTransferRequest;
use App\Models\StockTransfer;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\StockPlace;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class TransferController extends Controller
{
    private const WITH = [
        'fromBranch:id,name,kind',
        'toBranch:id,name,kind',
        'items:id,stock_transfer_id,product_id,variant_id,product_name,variant_name,quantity,quantity_requested,quantity_received,short_reason,short_outcome,lots',
        'sender:id,name',
        'requester:id,name',
        'receiver:id,name',
    ];

    /**
     * Transfers, most recent first — the ones that touch the place being
     * looked at, or all of them from head office.
     *
     * `waiting` is what the screen opens on: how many are on their way to be
     * counted in, and how many arrived short and still need a decision. Both
     * are asked of the same place the list is, so the number on the tab and
     * the rows under it cannot disagree.
     */
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        $place = $branch->scopeId();
        $status = $request->query('status');

        $transfers = $this->touching($place)
            ->when(in_array($status, StockTransfer::STATUSES, true), fn (Builder $q) => $q->where('status', $status))
            ->with(self::WITH)
            ->latest()
            ->stably()->paginate(20);

        $user = $request->user();
        $transfers->getCollection()->each(fn (StockTransfer $t) => $t->setAttribute('can', $this->can($t, $user)));

        return ApiResponse::paginated($transfers, 'OK', [
            'waiting' => [
                // Asked of the place it is to come FROM…
                'to_send' => StockTransfer::query()
                    ->where('status', StockTransfer::REQUESTED)
                    ->when($place !== null, fn (Builder $q) => $q->where('from_branch_id', $place))
                    ->count(),
                // …counted in at the place it was SENT TO…
                'to_receive' => StockTransfer::query()
                    ->where('status', StockTransfer::IN_TRANSIT)
                    ->when($place !== null, fn (Builder $q) => $q->where('to_branch_id', $place))
                    ->count(),
                // …and a shortage is settled by the place it was SENT FROM.
                'to_settle' => StockTransfer::query()
                    ->where('status', StockTransfer::SHORT)
                    ->when($place !== null, fn (Builder $q) => $q->where('from_branch_id', $place))
                    ->count(),
            ],
        ]);
    }

    /**
     * Send stock to another place — or, with `mode: move`, put it straight
     * there. A caller that names neither has always meant a move.
     */
    public function store(
        StoreTransferRequest $request,
        TenantContext $context,
        SendStockTransferAction $send,
        TransferStockAction $move,
        RequestStockTransferAction $ask,
    ): JsonResponse {
        $data = $request->validated();

        if (($data['mode'] ?? 'move') === 'request') {
            $transfer = $ask->execute($context->get(), $data);

            return ApiResponse::created($this->shown($transfer, $request), "{$transfer->fromBranch?->name} has been asked — transfer {$transfer->reference} is waiting for them to send it");
        }

        if (($data['mode'] ?? 'move') === 'send') {
            $transfer = $send->execute($context->get(), $data);

            return ApiResponse::created($this->shown($transfer, $request), "Transfer {$transfer->reference} sent — waiting to be received");
        }

        $transfer = $move->execute($context->get(), $data);

        return ApiResponse::created($this->shown($transfer, $request), 'Stock transferred');
    }

    /** Answer a request: send what was asked for, or what can be spared. */
    public function send(SendRequestedTransferRequest $request, string $id, SendStockTransferAction $action): JsonResponse
    {
        $transfer = $action->fulfil(StockTransfer::query()->findOrFail($id), $request->sending());

        return ApiResponse::ok($this->shown($transfer, $request), "Transfer {$transfer->reference} sent — waiting to be received");
    }

    public function receive(ReceiveTransferRequest $request, string $id, ReceiveStockTransferAction $action): JsonResponse
    {
        $transfer = $action->execute(StockTransfer::query()->findOrFail($id), $request->counted());

        return ApiResponse::ok(
            $this->shown($transfer, $request),
            $transfer->status === StockTransfer::SHORT
                ? "Transfer {$transfer->reference} received short — {$transfer->fromBranch?->name} needs to settle the difference"
                : "Transfer {$transfer->reference} received",
        );
    }

    public function settle(SettleTransferRequest $request, string $id, SettleStockTransferAction $action): JsonResponse
    {
        $transfer = $action->execute(
            StockTransfer::query()->findOrFail($id),
            $request->validated('outcome'),
            $request->perItem(),
        );

        return ApiResponse::ok($this->shown($transfer, $request), "Transfer {$transfer->reference} settled");
    }

    public function cancel(Request $request, string $id, CancelStockTransferAction $action): JsonResponse
    {
        $asked = StockTransfer::query()->findOrFail($id);
        $onlyAsked = $asked->status === StockTransfer::REQUESTED;
        $transfer = $action->execute($asked);

        return ApiResponse::ok($this->shown($transfer, $request), $onlyAsked
            ? "Request {$transfer->reference} declined — nothing was sent"
            : "Transfer {$transfer->reference} called back — the stock is at {$transfer->fromBranch?->name} again");
    }

    /** The slip that travels with the goods, as a page to print. */
    public function slip(string $id, TenantContext $context): Response
    {
        $tenant = $context->get();

        return response()->view('inventory.transfer-slip', [
            'tenant' => $tenant,
            'settings' => $tenant?->allSettings() ?? [],
            'transfer' => StockTransfer::query()->with(self::WITH)->findOrFail($id),
        ]);
    }

    /** @return Builder<StockTransfer> */
    private function touching(?string $place): Builder
    {
        return StockTransfer::query()->when($place !== null, fn (Builder $q) => $q->touching($place));
    }

    private function shown(StockTransfer $transfer, Request $request): StockTransfer
    {
        return $transfer->load(self::WITH)->setAttribute('can', $this->can($transfer, $request->user()));
    }

    /**
     * What THIS person may do to this transfer now.
     *
     * Answered here so the screen draws the buttons the server will honour.
     * The rule itself is `StockPlace`'s; a copy of it in the panel would be a
     * second rule, and the first time they differed a stock keeper would be
     * shown a Receive button that refuses.
     *
     * @return array{send: bool, receive: bool, settle: bool, cancel: bool}
     */
    private function can(StockTransfer $transfer, mixed $user): array
    {
        $atSender = StockPlace::mayActAt($user, $transfer->from_branch_id);
        $atReceiver = StockPlace::mayActAt($user, $transfer->to_branch_id);
        $asked = $transfer->status === StockTransfer::REQUESTED;

        return [
            'send' => $asked && $atSender,
            'receive' => $transfer->status === StockTransfer::IN_TRANSIT && $atReceiver,
            'settle' => $transfer->status === StockTransfer::SHORT && $atSender,
            // Stock on the road is the sender's to call back. A request is
            // either end's to refuse: one declines, the other withdraws.
            'cancel' => ($transfer->status === StockTransfer::IN_TRANSIT && $atSender) || ($asked && ($atSender || $atReceiver)),
        ];
    }
}
