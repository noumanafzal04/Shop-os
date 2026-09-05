<?php

namespace App\Http\Controllers\Api\V1\Marketplace;

use App\Enums\FulfillmentType;
use App\Enums\OrderStatus;
use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\RiderProfile;
use App\Models\Tenant;
use App\Services\OrderService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class CustomerOrderController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $orders = Order::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->with(['tenant:id,business_name,slug', 'items', 'rider:id,name,rider_profile_id', 'rider.riderProfile:id,latitude,longitude,last_seen_at', 'branch:id,name,address,phone'])
            ->orderByDesc('placed_at')
            ->paginate(min((int) $request->query('per_page', 15), 100))
            ->through(fn (Order $o) => $this->serialize($o));

        return ApiResponse::paginated($orders);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $order = Order::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->with(['tenant:id,business_name,slug', 'items', 'rider:id,name,rider_profile_id', 'rider.riderProfile:id,latitude,longitude,last_seen_at', 'branch:id,name,address,phone'])
            ->findOrFail($id);

        return ApiResponse::ok($this->serialize($order));
    }

    public function store(Request $request, OrderService $service): JsonResponse
    {
        $data = $request->validate([
            'shop_slug' => ['required', 'string'],
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
            'idempotency_key' => ['nullable', 'string', 'max:64'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
        ]);

        $shop = Tenant::query()->marketplaceVisible()->where('slug', $data['shop_slug'])->firstOrFail();

        $order = $service->place($request->user(), $shop, $data);

        return ApiResponse::created($this->serialize($order->load('tenant:id,business_name,slug', 'branch:id,name,address,phone')), "Order {$order->order_number} placed");
    }

    public function cancel(Request $request, string $id, OrderService $service): JsonResponse
    {
        $order = Order::withoutTenancy()
            ->where('customer_id', $request->user()->id)
            ->with('items', 'branch:id,name,address,phone')
            ->findOrFail($id);

        // ── A customer may cancel only while NOBODY HAS ANSWERED YET ─────
        //
        // Until `confirmed` the order is a request. The moment the shop accepts
        // it, the shop has committed something real — a slot in the kitchen,
        // stock held off the shelf, sometimes a rider — and a customer undoing
        // that from a phone leaves the shop carrying the cost of a decision it
        // was never part of.
        //
        // `confirmed` used to be cancellable here, which made "accepted" mean
        // nothing to the shop that said it. Past this point the answer is a
        // conversation, not a button.
        if ($order->status !== OrderStatus::Pending) {
            return ApiResponse::error(
                'The shop has already accepted this order — call them to cancel it.',
                409,
                code: 'ORDER_NOT_CANCELLABLE',
            );
        }

        $order = $service->cancel($order, 'Cancelled by customer');

        return ApiResponse::ok($this->serialize($order), 'Order cancelled');
    }

    /**
     * Where the rider is, if that is a fair thing to say right now.
     *
     * Three conditions, all of them necessary: they are carrying THIS order,
     * they have a fix, and the fix is recent. Drop any one and the map shows a
     * confident pin that is a guess.
     *
     * @return array{lat: ?float, lng: ?float}
     */
    private function riderPin(Order $o): array
    {
        $p = $o->rider?->riderProfile;

        $live = $p !== null
            && $o->picked_up_at !== null
            && $o->delivered_at === null
            && $p->latitude !== null
            && $p->last_seen_at !== null
            && $p->last_seen_at->gt(now()->subMinutes(RiderProfile::STALE_AFTER_MINUTES));

        return $live
            ? ['lat' => (float) $p->latitude, 'lng' => (float) $p->longitude]
            : ['lat' => null, 'lng' => null];
    }

    private function serialize(Order $o): array
    {
        $pin = $this->riderPin($o);

        return [
            'id' => $o->id,
            'order_number' => $o->order_number,
            'shop' => ['slug' => $o->tenant?->slug, 'business_name' => $o->tenant?->business_name],
            'status' => $o->status,
            'fulfillment_type' => $o->fulfillment_type,
            'payment_method' => $o->payment_method,
            'payment_status' => $o->payment_status,
            'delivery_address' => $o->delivery_address,
            // WHERE IT IS COMING FROM — and for a pickup, where to walk to.
            //
            // The branch that fills an order is chosen by distance now, so a
            // customer collecting one has no way of knowing which shop to go to
            // unless it is on the order. Before this it was always the default
            // branch and nobody had to be told; that is not a reason to leave a
            // pickup customer guessing now that it varies.
            //
            // Name, address and phone only. This is the allow-list that keeps a
            // marketplace response from carrying a shop's internals, and what a
            // customer needs is what they would need to walk there and ring the
            // bell.
            'branch' => $o->branch !== null ? [
                'name' => $o->branch->name,
                'address' => $o->branch->address,
                'phone' => $o->branch->phone,
            ] : null,
            'subtotal' => $o->subtotal,
            'discount' => $o->discount,
            'coupon_code' => $o->coupon_code,
            'delivery_fee' => $o->delivery_fee,
            'total' => $o->total,
            // ── Delivery tracking ────────────────────────────────────
            //
            // The stage comes from the RIDER'S OWN timestamps now, not from
            // the order status. Those two disagree by design for most of a
            // delivery: an order sits at `preparing` while the rider is
            // already on their way to collect it, and "assigned" was the only
            // word the status had for that whole stretch.
            //
            // Rider phone is still never exposed — that decision has not
            // changed. Their POSITION is, and only while they are carrying
            // THIS order, and only while their phone is still saying where
            // they are. A stale pin is worse than no pin: it shows a rider
            // parked somewhere they left ten minutes ago.
            'rider' => $o->rider !== null ? [
                'name' => $o->rider->name,
                'stage' => match (true) {
                    $o->delivered_at !== null || $o->status->value === 'completed' => 'delivered',
                    $o->picked_up_at !== null || $o->status->value === 'out_for_delivery' => 'on_the_way',
                    $o->rider_accepted_at !== null => 'to_pickup',
                    default => 'assigned',
                },
                'accepted_at' => $o->rider_accepted_at?->toIso8601String(),
                'picked_up_at' => $o->picked_up_at?->toIso8601String(),
                'latitude' => $pin['lat'],
                'longitude' => $pin['lng'],
            ] : null,
            // THE CODE THE RIDER ASKS FOR AT THE DOOR.
            //
            // Only once it is actually on its way: handing it over at
            // checkout would make it a number the customer forgets by the time
            // it matters, and it is the only proof this app has that a
            // delivery marked complete reached the person who paid.
            'delivery_otp' => $o->picked_up_at !== null && $o->status->value === 'out_for_delivery'
                ? $o->delivery_otp
                : null,
            'delivered_at' => $o->delivered_at?->toIso8601String(),
            'items' => $o->items->map(fn ($i) => [
                'product_name' => $i->product_name,
                'variant_name' => $i->variant_name,
                'unit_name' => $i->unit_name,
                'modifiers' => $i->modifiers,
                'quantity' => $i->quantity,
                'unit_price' => $i->unit_price,
                'line_total' => $i->line_total,
            ]),
            'placed_at' => $o->placed_at?->toIso8601String(),
        ];
    }
}
