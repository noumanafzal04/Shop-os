<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\FulfillmentType;
use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Rider;
use App\Services\OrderService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = Order::query()
            ->with('items', 'rider', 'branch')
            ->when($request->query('status'), fn ($q, $s) => $q->where('status', $s))
            // Which door it came through. A shop wants to know whether the
            // online storefront is earning its keep, and that question cannot
            // be asked of a list that treats a phone call and a web checkout
            // as the same thing.
            ->when($request->query('channel'), fn ($q, $c) => $q->where('channel', $c))
            ->when($request->boolean('open_only'), fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled']))
            ->orderByDesc('placed_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($orders);
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(Order::query()->with('items', 'rider', 'branch')->findOrFail($id));
    }

    /**
     * An order taken over the phone or on WhatsApp.
     *
     * The most common delivery order in Pakistan arrives as a call, and until
     * now there was no way to record one. A shop either rang it at the till as
     * an ordinary counter sale — losing the entire fulfilment chain, so no
     * rider could be assigned, no status moved, and the kitchen had nothing to
     * work from — or kept it on a paper chit beside the phone.
     *
     * Prices are NOT accepted from the client. The staff member enters what the
     * customer asked for; the server decides what it costs, exactly as it does
     * for a web order. A counter that could type its own prices is a counter
     * that can discount without anyone knowing.
     */
    public function store(Request $request, OrderService $service, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'channel' => ['sometimes', Rule::in(['phone', 'whatsapp', 'walk_in'])],
            'customer_name' => ['required', 'string', 'max:255'],
            // The number is how the rider reaches them and how the CRM
            // recognises them next time. Not strictly required — a regular
            // standing at the counter may not give one — but nearly always
            // there on a phone order.
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'fulfillment_type' => ['required', Rule::enum(FulfillmentType::class)],
            'delivery_address' => ['required_if:fulfillment_type,delivery', 'nullable', 'string', 'max:500'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'payment_method' => ['sometimes', Rule::in(['cod', 'paid'])],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'uuid'],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:1000'],
            'items.*.modifier_option_ids' => ['sometimes', 'array', 'max:50'],
            'items.*.modifier_option_ids.*' => ['uuid'],
            'notes' => ['nullable', 'string', 'max:500'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
        ]);

        $order = $service->place(
            customer: null,
            shop: $context->get(),
            data: $data,
            staff: $request->user(),
        );

        return ApiResponse::created(
            $order->load('items'),
            "Order {$order->order_number} taken",
        );
    }

    public function assignRider(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate([
            // null clears the assignment; a uuid must be one of this shop's riders.
            'rider_id' => [
                'nullable', 'uuid',
                Rule::exists('riders', 'id')
                    ->where('tenant_id', $request->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
        ]);

        $rider = $data['rider_id'] !== null
            ? Rider::query()->findOrFail($data['rider_id'])
            : null;

        $order = $service->assignRider(Order::query()->with('items')->findOrFail($id), $rider);

        return ApiResponse::ok($order, $rider !== null ? "Assigned to {$rider->name}" : 'Rider cleared');
    }

    public function advance(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::enum(OrderStatus::class)]]);

        $order = $service->advance(
            Order::query()->with('items')->findOrFail($id),
            OrderStatus::from($data['status']),
        );

        return ApiResponse::ok($order, "Order {$order->order_number} → {$order->status->value}");
    }

    public function cancel(Request $request, string $id, OrderService $service): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:255']]);

        $order = $service->cancel(
            Order::query()->with('items')->findOrFail($id),
            $data['reason'] ?? 'Cancelled by shop',
        );

        return ApiResponse::ok($order, 'Order cancelled — stock restored');
    }
}
