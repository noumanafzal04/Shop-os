<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
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

    public function test_a_dine_in_sale_does_not_fire_a_second_time(): void
    {
        // Dine-in has its own path: a tab fires as each course is sent, and by
        // the time it becomes a Sale the food was cooked long ago. Firing again
        // here would put every settled table back on the pass.
        $this->ring([[$this->biryani, 1]], 'dine_in');

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
}
