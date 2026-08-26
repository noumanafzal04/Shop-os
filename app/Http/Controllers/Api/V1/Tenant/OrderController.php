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
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class OrderController extends Controller
{
    /**
     * THE ORDER QUEUE.
     *
     * A queue, not a ledger — which is why the STAGE COUNTS ride along on
     * every response. "How many are waiting to be confirmed" is the question
     * this screen exists to answer, and before this the only way to find out
     * was to click each stage in turn and read the paginator.
     *
     * Counted per axis with every other filter applied but not its own, the
     * same rule the marketplace facets and the tenant list follow. A count
     * taken with its own filter applied always equals the rows on screen,
     * which is a number that agrees with the screen no matter what.
     */
    public function index(Request $request): JsonResponse
    {
        /** @param string|null $except the axis being counted, left out */
        $scoped = fn (?string $except = null) => Order::query()
            ->when($except !== 'status' && $request->query('status'), fn ($q, $s) => $q->where('status', $s))
            // Which door it came through. A shop wants to know whether the
            // online storefront is earning its keep, and that question cannot
            // be asked of a list that treats a phone call and a web checkout
            // as the same thing.
            ->when($request->query('channel'), fn ($q, $c) => $q->where('channel', $c))
            ->when($request->query('fulfillment'), fn ($q, $f) => $q->where('fulfillment_type', $f))
            ->when($request->query('rider_id'), fn ($q, $id) => $q->where('rider_id', $id))
            // DELIVERIES NOBODY IS CARRYING. The one operational question this
            // screen could not be asked: an order marked out for delivery with
            // no rider on it is a customer waiting for a bike that was never
            // sent.
            ->when($request->boolean('unassigned'), fn ($q) => $q
                ->where('fulfillment_type', FulfillmentType::Delivery)
                ->whereNull('rider_id')
                ->whereNotIn('status', [OrderStatus::Completed->value, OrderStatus::Cancelled->value]))
            ->when($request->query('search'), function ($q, $search): void {
                // The three things somebody has in hand: the number on the
                // chit, the customer's name, the number they rang from.
                $q->where(function ($q) use ($search): void {
                    $q->where('order_number', 'like', "%{$search}%")
                        ->orWhere('customer_name', 'like', "%{$search}%")
                        ->orWhere('customer_phone', 'like', "%{$search}%");
                });
            })
            ->when($request->query('from'), fn ($q, $from) => $q->where('placed_at', '>=', $from))
            // The whole of the day it names — "today" is the range this screen
            // is opened with, and midnight would drop every order in it.
            ->when($request->query('to'), fn ($q, $to) => $q->where('placed_at', '<=', $to.' 23:59:59'))
            ->when($request->boolean('open_only'), fn ($q) => $q->whereNotIn('status', ['completed', 'cancelled']));

        $orders = $scoped()
            ->with('items', 'rider', 'branch')
            ->orderByDesc('placed_at')
            ->paginate(min((int) $request->query('per_page', 15), 100));

        return ApiResponse::paginated($orders, meta: [
            'status_counts' => $this->stageCounts($scoped('status')),
            // Deliveries with nobody carrying them, counted whatever stage is
            // on screen — it is a warning, not a filter result.
            'unassigned' => (clone $scoped('status'))
                ->where('fulfillment_type', FulfillmentType::Delivery)
                ->whereNull('rider_id')
                ->whereNotIn('status', [OrderStatus::Completed->value, OrderStatus::Cancelled->value])
                ->count(),
        ]);
    }

    /**
     * How many orders sit at each stage, in one query rather than seven.
     *
     * Conditional sums rather than a GROUP BY, because the answer must contain
     * a ZERO for a stage nothing is in: a missing key would leave the screen
     * drawing a chip with no number beside six that have one, and "no number"
     * reads as "not counted", not as "none".
     *
     * `select(DB::raw(...))`, never `selectRaw` — selectRaw APPENDS, so the
     * aggregate would arrive beside `select *` and MySQL's ONLY_FULL_GROUP_BY
     * refuses that outright while SQLite allows it.
     *
     * @return array<string, int>
     */
    private function stageCounts(Builder $query): array
    {
        // The values come from a PHP enum, never from input, and every one of
        // them is a bare lowercase identifier — so no quoting is needed and
        // none is used: backticks are MySQL's and would have to be swapped for
        // double quotes on SQLite.
        $cases = [];
        foreach (OrderStatus::cases() as $stage) {
            $cases[] = "SUM(CASE WHEN status = '{$stage->value}' THEN 1 ELSE 0 END) as {$stage->value}";
        }
        $cases[] = 'COUNT(*) as all_of_them';

        $row = $query->select(DB::raw(implode(', ', $cases)))->toBase()->first();

        $counts = ['all' => (int) ($row->all_of_them ?? 0)];
        foreach (OrderStatus::cases() as $stage) {
            $counts[$stage->value] = (int) ($row->{$stage->value} ?? 0);
        }

        return $counts;
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
