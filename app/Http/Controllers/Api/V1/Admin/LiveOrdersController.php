<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\FulfillmentType;
use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Tenant;
use App\Services\NotificationService;
use App\Services\OrderService;
use App\Support\ApiResponse;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * LIVE ORDERS — every marketplace order still open, across every shop, with
 * the ones that are STUCK said first: a shop that has not answered, a delivery
 * nobody is carrying, a transfer nobody checked, an order running late.
 *
 * The screen the platform watches on launch day. It reads; the one thing it
 * may do is cancel an order that has gone wrong, with a reason the customer
 * and the shop are both told.
 */
class LiveOrdersController extends Controller
{
    /** Minutes before each kind of wait is called stuck. */
    public const SHOP_SLOW_AFTER = 5;

    public const NO_RIDER_AFTER = 15;

    public const LATE_AFTER = 60;

    private const OPEN = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

    public function index(Request $request): JsonResponse
    {
        $orders = Order::withoutTenancy()
            ->whereIn('status', self::OPEN)
            ->where('channel', 'online')
            ->with(['tenant:id,business_name,slug,phone', 'rider:id,name,phone'])
            ->orderBy('placed_at')
            ->limit(300)
            ->get()
            ->map(fn (Order $o) => $this->row($o));

        // FILTERS, narrowing what is SHOWN — the counts above stay the whole
        // marketplace's, so a narrowed board still says what else is stuck.
        $flag = (string) $request->query('flag', '');
        $search = mb_strtolower(trim((string) $request->query('search', '')));
        $shop = (string) $request->query('shop', '');
        $status = (string) $request->query('status', '');
        $payment = (string) $request->query('payment', '');
        $how = (string) $request->query('fulfillment', '');

        $shown = $orders->filter(function (array $r) use ($flag, $search, $shop, $status, $payment, $how): bool {
            if ($flag !== '' && ! in_array($flag, $r['flags'], true)) {
                return false;
            }
            if ($shop !== '' && ($r['shop']['id'] ?? null) !== $shop) {
                return false;
            }
            if ($status !== '' && $r['status'] !== $status) {
                return false;
            }
            if ($payment !== '' && $r['payment_method'] !== $payment) {
                return false;
            }
            if ($how !== '' && $r['fulfillment_type'] !== $how) {
                return false;
            }
            if ($search !== '') {
                $hay = mb_strtolower(implode(' ', [$r['order_number'], $r['customer_name'], $r['customer_phone'] ?? '', $r['shop']['business_name'] ?? '']));

                return str_contains($hay, $search);
            }

            return true;
        })->values();

        return ApiResponse::ok([
            'orders' => $shown->all(),
            // The shops with something open — for the shop filter, drawn from
            // what is there rather than every shop on the platform.
            'shops' => $orders->pluck('shop')->filter()->unique('id')->sortBy('business_name')->values()->map(fn ($s) => ['id' => $s['id'], 'name' => $s['business_name']])->all(),
            'counts' => [
                'open' => $orders->count(),
                'shop_slow' => $orders->filter(fn ($r) => in_array('shop_slow', $r['flags'], true))->count(),
                'no_rider' => $orders->filter(fn ($r) => in_array('no_rider', $r['flags'], true))->count(),
                'transfer_unchecked' => $orders->filter(fn ($r) => in_array('transfer_unchecked', $r['flags'], true))->count(),
                'late' => $orders->filter(fn ($r) => in_array('late', $r['flags'], true))->count(),
            ],
            'as_of' => now()->toIso8601String(),
        ]);
    }

    public function cancel(Request $request, string $id, OrderService $service, NotificationService $notifications): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:300']]);

        $order = Order::withoutTenancy()->findOrFail($id);
        $order = $service->cancel($order, $data['reason']);

        $shop = Tenant::query()->find($order->tenant_id);
        if ($shop !== null) {
            $notifications->notifyWhoCanAct(
                $shop,
                Permissions::ORDERS_MANAGE,
                'order.cancelled_by_platform',
                'Order cancelled by '.config('app.name'),
                "{$order->order_number}: {$data['reason']}",
                ['order_id' => $order->id],
                "order-platform-cancel-{$order->id}",
                $order->branch_id,
            );
        }

        return ApiResponse::ok($this->row($order->load('tenant:id,business_name,slug,phone', 'rider:id,name,phone')), "{$order->order_number} cancelled");
    }

    /** @return array<string, mixed> */
    private function row(Order $o): array
    {
        $minutes = $o->placed_at !== null ? (int) $o->placed_at->diffInMinutes(now()) : 0;
        $delivery = $o->fulfillment_type === FulfillmentType::Delivery;

        $flags = [];
        if ($o->status === OrderStatus::Pending && $minutes >= self::SHOP_SLOW_AFTER) {
            $flags[] = 'shop_slow';
        }
        if ($delivery && in_array($o->status, [OrderStatus::Confirmed, OrderStatus::Preparing, OrderStatus::Ready], true)
            && $o->rider_accepted_at === null && $minutes >= self::NO_RIDER_AFTER) {
            $flags[] = 'no_rider';
        }
        if ($o->awaitsItsTransfer()) {
            $flags[] = 'transfer_unchecked';
        }
        if ($o->status->isOpen() && $minutes >= self::LATE_AFTER) {
            $flags[] = 'late';
        }

        return [
            'id' => $o->id,
            'order_number' => $o->order_number,
            'status' => $o->status->value,
            'fulfillment_type' => $o->fulfillment_type->value,
            'payment_method' => $o->payment_method,
            'total' => $o->total,
            'customer_name' => $o->customer_name,
            'customer_phone' => $o->customer_phone,
            'delivery_address' => $o->delivery_address,
            'placed_at' => $o->placed_at?->toIso8601String(),
            'minutes' => $minutes,
            'shop' => $o->tenant?->only(['id', 'business_name', 'slug', 'phone']),
            'rider' => $o->rider !== null ? ['name' => $o->rider->name, 'phone' => $o->rider->phone, 'accepted' => $o->rider_accepted_at !== null] : null,
            'flags' => $flags,
        ];
    }
}
