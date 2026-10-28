<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\KitchenTicket;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\ItemTypes;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * AN ORDER FROM THE PHONE OR THE ONLINE SHOP REACHES THE KITCHEN.
 *
 * ── What was found ───────────────────────────────────────────────────
 *
 * One phone order was taken through its whole life in a restaurant — taken,
 * confirmed, "Start preparing", out for delivery, completed — and then the
 * pass was looked at. It had never heard of the order. A table's order
 * reaches the kitchen when it is fired and a counter order when it is paid;
 * an order in the Orders queue reached nobody.
 *
 * The tests are in the order a kitchen would meet them.
 */
class AnOrderReachesTheKitchenTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $biryani;

    private Product $lemonade;

    private Product $water;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'business_type' => 'food', 'setup_completed' => true, 'city_id' => $city->id,
            'features' => Modules::normalize([
                'products' => true, 'pos' => true, 'kitchen' => true, 'marketplace' => true, 'delivery' => true,
            ]),
            'settings' => ['kitchen_stations' => ['Kitchen', 'Bar']],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->biryani = $this->item('Chicken Biryani', ItemTypes::FOOD, 450, ['kitchen_station' => 'Kitchen']);
        $this->lemonade = $this->item('Mint Lemonade', ItemTypes::FOOD, 180, ['kitchen_station' => 'Bar']);
        $this->water = $this->item('Water 1.5L', ItemTypes::PHYSICAL, 80, ['track_inventory' => true, 'stock_quantity' => 50]);
    }

    private function item(string $name, string $type, float $price, array $more = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => $type,
            'name' => $name, 'price' => $price, 'stock_quantity' => 0, 'track_inventory' => false, 'is_active' => true,
        ], $more));
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  list<array{0: Product, 1: float}>  $lines */
    private function takeOrder(array $lines, array $more = []): array
    {
        return $this->asOwner()->postJson('/api/v1/orders', array_merge([
            'channel' => 'phone',
            'customer_name' => 'Mrs. Khan',
            'customer_phone' => '03001112233',
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12-B, Johar Town',
            'items' => array_map(fn (array $l): array => ['product_id' => $l[0]->id, 'quantity' => $l[1]], $lines),
        ], $more))->assertCreated()->json('data');
    }

    private function move(array $order, string $to): void
    {
        $this->asOwner()->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
    }

    /** @return list<array<string, mixed>> */
    private function pass(): array
    {
        return $this->asOwner()->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
    }

    public function test_an_order_being_prepared_is_on_the_pass_under_its_own_number_and_the_callers_name(): void
    {
        $order = $this->takeOrder([[$this->biryani, 2], [$this->lemonade, 1]], ['notes' => 'no chilli, ring the bell']);

        // Taken, and confirmed: nobody has said "cook it" yet.
        $this->assertSame([], $this->pass(), 'an order nobody has accepted is already on the pass');
        $this->move($order, 'confirmed');
        $this->assertSame([], $this->pass(), 'a confirmed order is cooked before the shop said to start');

        $this->move($order, 'preparing');

        $pass = collect($this->pass());
        // One docket a station: the biryani to the kitchen, the lemonade to the bar.
        $this->assertEqualsCanonicalizing(['Kitchen', 'Bar'], $pass->pluck('station')->all());
        foreach ($pass as $docket) {
            $this->assertSame($order['order_number'], $docket['ticket_number']);
            $this->assertSame('Mrs. Khan', $docket['table_name'], 'the pass has nothing to call out');
            $this->assertSame('takeaway', $docket['order_type']);
            $this->assertSame('Delivery — no chilli, ring the bell', $docket['notes']);
        }
        $kitchen = $pass->firstWhere('station', 'Kitchen');
        $this->assertSame(['Chicken Biryani'], array_column($kitchen['items'], 'name'));
        $this->assertEquals(2, $kitchen['items'][0]['quantity']);
    }

    public function test_it_is_sent_once_however_far_the_order_then_goes(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1]]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');
        $this->move($order, 'out_for_delivery');
        $this->move($order, 'completed');

        $this->assertSame(1, RestaurantTicket::withoutTenancy()->where('ticket_number', $order['order_number'])->count());
        $this->assertSame(1, KitchenTicket::withoutTenancy()->where('tenant_id', $this->shop->id)->count(), 'the same meal was sent to the kitchen twice');
    }

    public function test_an_order_collected_from_the_shop_says_pickup(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1]], ['fulfillment_type' => 'pickup', 'delivery_address' => null]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');

        $this->assertSame(['Pickup'], array_column($this->pass(), 'notes'));
    }

    public function test_only_what_a_kitchen_cooks_is_on_the_docket_and_an_order_of_packets_sends_none(): void
    {
        $mixed = $this->takeOrder([[$this->biryani, 1], [$this->water, 2]]);
        $this->move($mixed, 'confirmed');
        $this->move($mixed, 'preparing');

        $names = collect($this->pass())->flatMap(fn (array $d) => array_column($d['items'], 'name'))->all();
        $this->assertSame(['Chicken Biryani'], $names, 'a bottle of water was sent to the cook');

        $packets = $this->takeOrder([[$this->water, 6]], ['customer_name' => 'Mr. Ali']);
        $this->move($packets, 'confirmed');
        $this->move($packets, 'preparing');

        $this->assertSame(0, RestaurantTicket::withoutTenancy()->where('ticket_number', $packets['order_number'])->count());
    }

    public function test_a_cancelled_order_comes_off_the_pass_and_what_was_already_served_stays_on_the_record(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1], [$this->lemonade, 1]]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');

        // The bar has already handed its glass over.
        $bar = KitchenTicket::withoutTenancy()->where('tenant_id', $this->shop->id)->where('station', 'Bar')->firstOrFail();
        $bar->forceFill(['status' => 'served', 'served_at' => now()])->save();

        $this->asOwner()->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'Customer rang back'])->assertOk();

        $this->assertSame([], $this->pass(), 'a cook is making a meal nobody will collect');
        $this->assertSame('served', $bar->fresh()->status, 'cancelling rewrote what the bar had already sent out');
        $this->assertSame('void', KitchenTicket::withoutTenancy()->where('tenant_id', $this->shop->id)->where('station', 'Kitchen')->value('status'));
    }

    /**
     * #RS2 — handed to the rider, delivered and paid, and 26 minutes later
     * its docket still read NEW, flagged LATE, offering "Start cooking".
     */
    public function test_a_delivered_order_comes_off_the_pass_and_its_dockets_keep_what_the_kitchen_said(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1]]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');
        $this->assertCount(1, $this->pass());

        $this->move($order, 'out_for_delivery');
        $this->move($order, 'completed');

        $this->assertSame([], $this->pass(), 'a delivered order is still asking to be cooked');
        // Nobody bumped it, so nobody claims it was served.
        $this->assertSame('fired', KitchenTicket::withoutTenancy()->where('tenant_id', $this->shop->id)->value('status'));
    }

    public function test_the_step_that_sends_it_hands_back_what_the_screen_needs_to_print_the_slip(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1], [$this->lemonade, 1]]);

        $confirmed = $this->asOwner()->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->assertNull($confirmed->json('data.kitchen_ticket'), 'a slip was handed back for an order nobody has started');

        $started = $this->asOwner()->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'preparing'])->assertOk();
        $ticket = $started->json('data.kitchen_ticket');
        $this->assertSame($order['order_number'], $ticket['ticket_number']);
        $this->assertEqualsCanonicalizing(['Kitchen', 'Bar'], array_column($ticket['kots'], 'station'));
        // …and each of those is a slip that can be fetched to print.
        foreach ($ticket['kots'] as $kot) {
            $slip = $this->asOwner()->get("/api/v1/restaurant/tickets/{$ticket['ticket_id']}/kot/{$kot['id']}")->assertOk();
            $this->assertStringContainsString($order['order_number'], $slip->getContent(), 'the slip does not carry the order\'s number');
        }

        // Sent once: the next step has no slip to print again.
        $out = $this->asOwner()->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'out_for_delivery'])->assertOk();
        $this->assertNull($out->json('data.kitchen_ticket'));
    }

    public function test_an_order_the_shop_took_itself_can_go_to_the_kitchen_in_the_breath_it_is_taken(): void
    {
        $taken = $this->asOwner()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 2]],
            'send_to_kitchen' => true,
        ])->assertCreated()->json('data');

        // Not "new — waiting to be accepted", by the people who just accepted it.
        $this->assertSame('preparing', $taken['status']);
        $this->assertSame($taken['order_number'], $taken['kitchen_ticket']['ticket_number']);
        $this->assertCount(1, $taken['kitchen_ticket']['kots']);
        $this->assertSame([$taken['order_number']], array_column($this->pass(), 'ticket_number'));
    }

    public function test_left_unsaid_the_order_waits_in_the_queue_as_it_always_did(): void
    {
        $order = $this->takeOrder([[$this->biryani, 1]]);

        $this->assertSame('pending', $order['status']);
        $this->assertNull($order['kitchen_ticket']);
        $this->assertSame([], $this->pass());
    }

    public function test_a_shop_with_no_kitchen_takes_the_order_and_has_nobody_to_send_it_to(): void
    {
        $this->shop->forceFill(['features' => Modules::normalize(['products' => true, 'pos' => true, 'marketplace' => true, 'delivery' => true])])->save();

        $taken = $this->asOwner()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 1]],
            'send_to_kitchen' => true,
        ])->assertCreated()->json('data');

        $this->assertSame('pending', $taken['status'], 'an order was moved on for a kitchen the shop does not have');
        $this->assertNull($taken['kitchen_ticket']);
    }

    public function test_a_shop_with_no_kitchen_sends_nothing_and_its_order_is_none_the_worse(): void
    {
        $this->shop->forceFill(['features' => Modules::normalize(['products' => true, 'pos' => true, 'marketplace' => true, 'delivery' => true])])->save();

        $order = $this->takeOrder([[$this->biryani, 1]]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');
        $this->move($order, 'out_for_delivery');
        $this->move($order, 'completed');

        $this->assertSame(0, RestaurantTicket::withoutTenancy()->count());
        $done = $this->asOwner()->getJson("/api/v1/orders/{$order['id']}")->json('data');
        $this->assertSame('completed', $done['status']);
        // B17: it came in by phone, and its sale says so — not "online".
        $this->assertSame('phone', Sale::withoutTenancy()->findOrFail($done['sale_id'])->channel->value ?? null);
    }

    public function test_the_order_never_shows_as_a_table_on_the_floor(): void
    {
        $this->shop->forceFill(['features' => Modules::normalize([
            'products' => true, 'pos' => true, 'kitchen' => true, 'dine_in' => true, 'marketplace' => true, 'delivery' => true,
        ])])->save();

        $order = $this->takeOrder([[$this->biryani, 1]]);
        $this->move($order, 'confirmed');
        $this->move($order, 'preparing');

        $tabs = $this->asOwner()->getJson('/api/v1/restaurant/tickets')->assertOk()->json('data');
        $this->assertSame([], array_values(array_filter($tabs, fn (array $t) => $t['ticket_number'] === $order['order_number'])), 'a phone order is being shown to the waiters as an open tab');
    }
}
