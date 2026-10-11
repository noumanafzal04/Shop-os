<?php

namespace Tests\Feature;

use App\Models\KitchenTicket;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A TAKEAWAY ORDER RUNG AT THE TILL, AND THE KITCHEN THAT HAS TO MAKE IT.
 *
 * ── The gap ────────────────────────────────────────────────────────────
 *
 * A kitchen ticket could only ever be created by a dine-in tab's Fire. So a
 * café that rings a takeaway at the counter — what a small café does all day —
 * printed a receipt for the customer and told the kitchen nothing. The only way
 * to get a slip to the pass was to run every order as a tab on a table that
 * does not exist.
 *
 * Splitting `kitchen` out of `dine_in` made that visible rather than causing
 * it: a shop can now have the pass without the floor, and a pass nothing
 * reaches is a screen with nothing on it.
 */
class CounterOrderReachesTheKitchenTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $biryani;

    private Product $water;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->create([
            'business_type' => 'food',
            'setup_completed' => true,
            // A takeaway counter: the till and the pass, and NO floor.
            'features' => Modules::normalize([
                'products' => true, 'pos' => true, 'kitchen' => true, 'expenses' => true,
            ]),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->biryani = $this->product('Chicken Biryani', ItemTypes::FOOD, 450);
        $this->water = $this->product('Water 1.5L', ItemTypes::PHYSICAL, 80);
    }

    private function product(string $name, string $type, float $price): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'type' => 'product',
            'item_type' => $type,
            'name' => $name,
            'price' => $price,
            'stock_quantity' => 500,
            'track_inventory' => $type === ItemTypes::PHYSICAL,
        ]);
    }

    private function asOwner(?User $user = null): static
    {
        $token = ($user ?? $this->owner)->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  list<array{0: Product, 1: float}>  $lines */
    private function ring(array $lines, string $orderType = 'takeaway', ?string $sessionId = null): array
    {
        return $this->asOwner()->postJson('/api/v1/sales', array_filter([
            'channel' => 'walk_in',
            'payment_method' => 'cash',
            'amount_paid' => 100000,
            'order_type' => $orderType,
            // A sale is PRACTICE because the shift it was rung on is, and the
            // till says which shift. Without it the sale is a real one.
            'cash_session_id' => $sessionId,
            'items' => array_map(fn (array $l): array => [
                'product_id' => $l[0]->id,
                'quantity' => $l[1],
            ], $lines),
        ], fn ($v) => $v !== null))->assertCreated()->json('data');
    }

    /** The dockets on the pass. The endpoint wraps them beside the stations. */
    private function board(): array
    {
        return $this->asOwner()->getJson('/api/v1/restaurant/kitchen')
            ->assertOk()->json('data.kots');
    }

    // ── The order arriving ──────────────────────────────────────────

    public function test_a_takeaway_rung_at_the_till_appears_on_the_pass(): void
    {
        $this->ring([[$this->biryani, 2]]);

        $board = $this->board();

        $this->assertCount(1, $board, 'the kitchen was told nothing about an order it has to cook');
        $this->assertSame('takeaway', $board[0]['order_type']);
        $this->assertSame('Chicken Biryani', $board[0]['items'][0]['name']);
        $this->assertEqualsWithDelta(2.0, (float) $board[0]['items'][0]['quantity'], 0.001);
    }

    public function test_the_docket_wears_the_number_the_customer_is_holding(): void
    {
        // A cook calling "TAB-00042" is reading a number nobody in the shop has
        // seen. The counter matches a bag to a receipt, so the sale's own
        // number is what the docket wears.
        $sale = $this->ring([[$this->biryani, 1]]);

        $this->assertSame($sale['invoice_number'], $this->board()[0]['ticket_number']);
        // Nobody gave a name, and the card is TOLD so — the word "Takeaway"
        // in `table_name` is a fallback, not somebody called Takeaway. The
        // screen heads such a card with the receipt number instead.
        $this->assertNull($this->board()[0]['customer_name']);
    }

    public function test_the_docket_carries_only_what_a_kitchen_makes(): void
    {
        // A bottle off the chiller is not work for the pass, and a board full of
        // things nobody cooks is a board the kitchen stops reading.
        $this->ring([[$this->biryani, 1], [$this->water, 2]]);

        $board = $this->board();

        $names = collect($board[0]['items'])->pluck('name')->all();
        $this->assertSame(['Chicken Biryani'], $names);
    }

    public function test_a_sale_with_nothing_to_cook_makes_no_ticket_at_all(): void
    {
        // Otherwise a mart that switched the module on would quietly grow a
        // floor full of tabs for bottles of water.
        $this->ring([[$this->water, 3]]);

        $this->assertSame([], $this->board());
        $this->assertSame(0, RestaurantTicket::query()->count());
    }

    public function test_an_order_rung_for_here_reaches_the_pass_and_says_which_table(): void
    {
        /*
         * This test used to say the opposite: a counter sale rung "dine-in"
         * left the board EMPTY, and that was asserted — on the grounds that a
         * dine-in tab has already fired its food. True of a tab. But this shop
         * has no floor and no tabs; here "dine-in" is the till's own button,
         * offered to exactly this kind of shop, with a box for the table
         * number. A customer who said "for here" paid, sat down, and waited
         * for a cup the bar had never been told about.
         */
        $sale = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'order_type' => 'dine_in', 'table_no' => '2',
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $board = $this->board();
        $this->assertCount(1, $board, 'an order rung for here never reached the pass');
        $this->assertSame('dine_in', $board[0]['order_type']);
        // Where it is carried to — not a bag, and not the word "Takeaway".
        $this->assertSame('Table 2', $board[0]['table_name']);
        $this->assertSame($sale['invoice_number'], $board[0]['ticket_number']);

        // It is still a COUNTER order: paid, no tab, nothing for a floor to hold.
        $ticket = RestaurantTicket::query()->sole();
        $this->assertTrue((bool) $ticket->from_counter);
        $this->assertSame($sale['id'], $ticket->sale_id);

        // And the paper says the table too — the kitchen that works off slips
        // is the one with no screen to read it from.
        $named = $sale['kitchen_ticket'];
        $slip = $this->asOwner()
            ->get("/api/v1/restaurant/tickets/{$named['ticket_id']}/kot/{$named['kots'][0]['id']}")
            ->assertOk()->getContent();
        $this->assertStringContainsString('Table 2', $slip);
        $this->assertStringNotContainsString('TAKEAWAY', $slip);
    }

    public function test_a_table_typed_as_the_shop_calls_it_is_left_as_typed_and_none_is_none(): void
    {
        $ring = fn (?string $table): array => $this->asOwner()->postJson('/api/v1/sales', array_filter([
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'order_type' => 'dine_in', 'table_no' => $table,
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 1]],
        ], fn ($v) => $v !== null))->assertCreated()->json('data');

        $garden = $ring('Garden');
        $nowhere = $ring(null);

        $by = collect($this->board())->keyBy('ticket_number');
        // "Garden" is already what the shop calls it. "Table Garden" is not.
        $this->assertSame('Garden', $by[$garden['invoice_number']]['table_name']);
        // No table was said: the card is headed by the receipt in the
        // customer's hand, as an unnamed takeaway's is. Never an invented one.
        $this->assertNull($by[$nowhere['invoice_number']]['table_name']);
    }

    public function test_a_tab_that_is_settled_is_not_fired_a_second_time(): void
    {
        // What the old rule was really for, asked of the thing it is about: a
        // shop WITH a floor. The tab fires as it is ordered; paying the bill
        // must not put the table's food back on the pass.
        $this->shop->forceFill(['features' => Modules::normalize([
            'products' => true, 'pos' => true, 'kitchen' => true, 'dine_in' => true, 'expenses' => true,
        ])])->save();

        $table = $this->asOwner()->postJson('/api/v1/restaurant/tables', ['name' => 'T1', 'seats' => 2])->assertCreated()->json('data.id');
        $tab = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table, 'guest_count' => 2,
        ])->assertCreated()->json('data.id');
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab}/items", [
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 2]],
        ])->assertOk();
        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab}/fire")->assertCreated();
        $this->assertCount(1, $this->board());

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 900,
        ])->assertCreated();

        // One tab, one docket — before the bill and after it.
        $this->assertSame(1, RestaurantTicket::query()->count(), 'paying the bill opened a second ticket');
        $this->assertSame(1, KitchenTicket::query()->count(), 'paying the bill fired the food again');
    }

    public function test_a_sale_the_till_did_not_ring_as_an_order_is_nobodys_order(): void
    {
        // No order type at all: a counter that sold a dish the way a mart
        // sells a packet. The pass is for orders somebody is waiting on.
        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $this->biryani->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertSame([], $this->board());
    }

    public function test_a_shop_without_the_module_is_given_no_ticket(): void
    {
        $this->shop->applyModules(['kitchen' => false]);

        $this->ring([[$this->biryani, 1]]);

        $this->assertSame(0, RestaurantTicket::query()->count());
    }

    // ── What the order is, and is not ───────────────────────────────

    public function test_the_order_is_the_kitchens_work_and_not_the_floors(): void
    {
        // It is PAID before the kitchen sees it, so it is not a tab anybody can
        // add to or settle. A shop with the floor as well must not find its
        // takeaway orders piled up there as tables nobody is sitting at.
        $this->shop->applyModules(['dine_in' => true]);

        $sale = $this->ring([[$this->biryani, 1]]);

        $floor = $this->asOwner()->getJson('/api/v1/restaurant/tickets')
            ->assertOk()->json('data');

        $this->assertSame([], $floor, 'a paid counter order was offered to the floor as an open tab');

        // And it knows which sale paid for it.
        $ticket = RestaurantTicket::query()->first();
        $this->assertSame($sale['id'], $ticket->sale_id);
    }

    public function test_it_stays_open_until_the_kitchen_has_served_it(): void
    {
        // The board only shows dockets whose ticket is open. Closing it when the
        // sale was rung would drop the docket the instant it was fired.
        $this->ring([[$this->biryani, 1]]);

        $ticket = RestaurantTicket::query()->first();
        $this->assertTrue($ticket->isOpen());
        $this->assertCount(1, $this->board());
    }

    public function test_serving_the_last_docket_closes_it(): void
    {
        // A tab closes when it is settled; this was paid before the kitchen saw
        // it, so the last docket being served is the only moment that can close
        // it. Without this, every takeaway a café ever sold would sit open for
        // ever and the kitchen's own backlog figure would climb by one an order.
        $this->ring([[$this->biryani, 1]]);

        $kot = $this->board()[0];

        $this->asOwner()->postJson("/api/v1/restaurant/kitchen/kot/{$kot['id']}/bump", [
            'status' => 'served',
        ])->assertOk();

        $this->assertFalse(RestaurantTicket::query()->first()->isOpen());
        $this->assertSame([], $this->board(), 'a served order stayed on the pass');
    }

    public function test_a_practice_sale_never_reaches_a_real_kitchen(): void
    {
        // Nothing in a training drawer is real, and a cook handed a practice
        // order cooks real food for nobody.
        $shift = $this->asOwner()->postJson('/api/v1/pos/session/open', [
            'opening_float' => 0,
            'is_training' => true,
        ])->assertCreated()->json('data');

        $this->assertTrue((bool) $shift['is_training']);

        $sale = $this->ring([[$this->biryani, 1]], 'takeaway', $shift['id']);
        $this->assertTrue((bool) $sale['is_training'], 'the fixture did not actually ring a practice sale');

        $this->assertSame(0, RestaurantTicket::query()->count());
    }

    // ── Who it belongs to ───────────────────────────────────────────

    public function test_one_shops_order_never_reaches_anothers_kitchen(): void
    {
        $other = Tenant::factory()->create([
            'business_type' => 'food',
            'setup_completed' => true,
            'features' => BusinessTypes::defaultFeatures('food'),
        ]);
        $theirOwner = User::factory()->shopOwner($other)->create();

        $this->ring([[$this->biryani, 1]]);

        $this->assertSame([], $this->asOwner($theirOwner)
            ->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots'));
    }

    // ── The slip the counter has to hand over ───────────────────────
    //
    // The docket reaching the BOARD is only half of "sent to the kitchen". A
    // café working off paper — most of them, and the case the shop described —
    // needs it out of the printer, and `kot_auto_print` is the shop's answer to
    // which it is. That switch was read in exactly one place: the dine-in tab's
    // Fire button. So a counter with no floor obeyed a setting nobody asked it
    // about, and the ticket the server made was one the till never heard of.

    public function test_the_sale_names_the_docket_so_the_till_can_print_it(): void
    {
        $sale = $this->ring([[$this->biryani, 1]]);

        $this->assertNotNull(
            $sale['kitchen_ticket'] ?? null,
            'the till cannot print a slip it was never told exists',
        );
        $this->assertNotEmpty($sale['kitchen_ticket']['kots'], 'named a ticket with no KOT on it');

        $ticket = RestaurantTicket::query()->firstOrFail();
        $this->assertSame($ticket->id, $sale['kitchen_ticket']['ticket_id']);
        $this->assertSame($sale['invoice_number'], $sale['kitchen_ticket']['ticket_number']);

        foreach ($sale['kitchen_ticket']['kots'] as $kot) {
            $this->assertArrayHasKey('id', $kot);
            $this->assertArrayHasKey('kot_number', $kot);
            $this->assertArrayHasKey('station', $kot);
        }
    }

    public function test_a_sale_with_nothing_to_cook_names_no_docket(): void
    {
        // The denominator for the test above: if `kitchen_ticket` were always
        // filled, asserting it is present would prove nothing.
        $sale = $this->ring([[$this->water, 1]]);

        $this->assertNull($sale['kitchen_ticket'] ?? null);
    }

    public function test_a_counter_with_no_floor_can_still_print_its_own_slip(): void
    {
        // The KOT renderer lived inside the dine-in route group, which was true
        // while a KOT could only come from a tab. This shop HAS a kitchen and
        // no `dine_in`, so the endpoint that draws the slip was refused to the
        // one kind of shop the whole split exists for.
        $sale = $this->ring([[$this->biryani, 1]]);
        $named = $sale['kitchen_ticket'];

        $this->assertFalse(
            $this->shop->fresh()->featureEnabled('dine_in'),
            'this shop must NOT have a floor, or the test proves nothing',
        );

        $this->asOwner()
            ->get("/api/v1/restaurant/tickets/{$named['ticket_id']}/kot/{$named['kots'][0]['id']}")
            ->assertOk();
    }

    public function test_the_slip_says_whose_it_is_what_to_cook_and_when_it_was_fired(): void
    {
        /*
         * The test above asked only whether the slip could be OPENED. It could,
         * and it had never once printed the shop's name: the controller read
         * `$tenant->name`, a shop has `business_name`, and a missing attribute
         * is null without a murmur. The time on it was UTC, five hours early.
         */
        $this->shop->forceFill(['business_name' => 'Gulberg Biryani House', 'timezone' => 'Asia/Karachi'])->save();
        Carbon::setTestNow(Carbon::parse('2026-10-06 15:20:00', 'UTC')); // 20:20 in Lahore

        try {
            $sale = $this->ring([[$this->biryani, 2]]);
            $named = $sale['kitchen_ticket'];

            $slip = (string) $this->asOwner()
                ->get("/api/v1/restaurant/tickets/{$named['ticket_id']}/kot/{$named['kots'][0]['id']}")
                ->assertOk()->getContent();
        } finally {
            Carbon::setTestNow();
        }

        $this->assertStringContainsString('Gulberg Biryani House', $slip, 'the kitchen slip does not say whose kitchen it is');
        $this->assertStringContainsString('Chicken Biryani', $slip);
        $this->assertStringContainsString('06 Oct, 20:20', $slip);
        $this->assertStringNotContainsString('15:20', $slip, 'the kitchen slip printed the time in UTC');
    }

    public function test_a_shop_without_the_kitchen_module_cannot_reach_the_slip(): void
    {
        // The gate moved; it did not disappear.
        $sale = $this->ring([[$this->biryani, 1]]);
        $named = $sale['kitchen_ticket'];

        $this->shop->update(['features' => Modules::normalize([
            'products' => true, 'pos' => true, 'expenses' => true,
        ])]);

        $this->asOwner()
            ->get("/api/v1/restaurant/tickets/{$named['ticket_id']}/kot/{$named['kots'][0]['id']}")
            ->assertForbidden();
    }
}
