<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\ReportService;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use App\Support\OfflinePolicy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Every trade's first day, end to end.
 *
 * ── Why this exists when each trade already has its own tests ───────────
 *
 * The trade-specific suites prove that a trade's SPECIAL thing works: FEFO for
 * a chemist, a serving window for a kitchen, a serial for an electronics shop.
 * None of them proves the ordinary thing — that a shop of this type can open,
 * ring a sale and have the money arrive in every place a shopkeeper will look
 * for it that evening.
 *
 * That gap is exactly where this codebase's recurring bug lives. Twice now the
 * fault has been "capability built, one link missing": a reorder list that
 * nothing linked to, a trade gate that existed only in the panel. Both were
 * green in every unit test they had. What catches that class is not a deeper
 * test of one feature, it is a SHALLOW test of the whole chain, repeated for
 * every trade — because the missing link is never in the same place twice.
 *
 * ── The chain, and why each link is in it ───────────────────────────────
 *
 *   the sale exists          the till said it worked
 *   the drawer expects it    what the cashier will be asked to count
 *   the cashbook has it      the owner's day, on the right date
 *   the staff report has it  whose day it was
 *   the cost never left      the one figure a customer must never see
 *
 * A trade can fail any one of these while passing its own feature tests, and a
 * shopkeeper meets the failure at nine in the evening with a drawer that does
 * not add up.
 *
 * ── Finance is not here, and that is the point ──────────────────────────
 *
 * A books-only shop sells nothing at all, so a chain that starts at the till
 * cannot describe it. It gets its own test at the bottom, asserting the
 * opposite: that money still moves, and that the catalog stays shut.
 */
class EveryTradeSellsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * What each trade puts on the counter on its first day.
     *
     * The item type matters: `itemTypesFor` decides what a trade may create at
     * all, and a trade selling the wrong shape of thing is a gate that has
     * drifted from the trade it gates.
     *
     * @return array<string, array{0: string, 1: string, 2: float}>
     */
    public static function trades(): array
    {
        return [
            'a restaurant sells a plate of food' => ['food', 'food_item', 450.0],
            'a grocery sells a packet' => ['mart', 'physical_product', 260.0],
            'a chemist sells a strip' => ['pharmacy', 'medicine', 180.0],
            'a retailer sells a handset' => ['retail', 'physical_product', 3500.0],
            'a salon sells an hour' => ['services', 'service', 1200.0],
            'a tyre shop sells a tyre' => ['automotive', 'physical_product', 9800.0],
            'a pump sells a litre' => ['petroleum', 'physical_product', 272.0],
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array{0: Tenant, 1: User} */
    private function shop(string $type): array
    {
        $tenant = Tenant::factory()->create([
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
        ]);

        return [$tenant, User::factory()->shopOwner($tenant)->create()];
    }

    // ── The chain ───────────────────────────────────────────────────

    #[DataProvider('trades')]
    public function test_a_shop_of_this_trade_can_be_created_and_sell_what_it_sells(string $type, string $itemType, float $price): void
    {
        [, $owner] = $this->shop($type);

        // Through the API, not the model. A trade allowed to hold an item type
        // it is not allowed to CREATE is a catalog editor that refuses on save,
        // discovered by a shopkeeper filling in their first product.
        $created = $this->actingAsUser($owner)->postJson('/api/v1/products', array_filter([
            'item_type' => $itemType,
            'name' => 'Day one',
            'price' => $price,
            'stock_quantity' => $itemType === 'service' ? null : 40,
            // A chemist's opening stock has to be dated — the lot behind it
            // cannot exist without an expiry.
            'expiry_date' => $itemType === 'medicine' ? now()->addYear()->toDateString() : null,
        ], fn ($v): bool => $v !== null))->assertCreated()->json('data');

        $this->assertSame($itemType, Product::withoutTenancy()->find($created['id'])->item_type);
    }

    #[DataProvider('trades')]
    public function test_the_money_from_that_sale_reaches_every_place_it_is_looked_for(string $type, string $itemType, float $price): void
    {
        [$tenant, $owner] = $this->shop($type);
        $product = $this->product($tenant, $itemType, $price);

        $session = $this->actingAsUser($owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertCreated()->json('data');

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => $price,
            'cash_session_id' => $session['id'],
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta($price, (float) $sale['total'], 0.001, "{$type}: the till's own answer");

        // 1. The drawer. What the cashier will be asked to count tonight, and
        //    the figure their variance is measured against.
        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));
        $this->assertEqualsWithDelta(
            1000 + $price,
            $drawer['expected_cash'],
            0.001,
            "{$type}: the drawer must expect the float plus what was taken",
        );

        // 2. The owner's day. Read from `sold_at`, so a trade whose sale is
        //    stamped elsewhere would silently drop out of the cashbook.
        $book = app(ReportService::class)->cashbook(
            $tenant->id,
            null,
            now()->subDay()->toDateString(),
            now()->toDateString(),
        );
        $today = collect($book['days'])->firstWhere('date', now()->toDateString());
        $this->assertEqualsWithDelta($price, (float) $today['money_in'], 0.001, "{$type}: the cashbook");

        // 3. Whose day it was. `created_by` is stamped by an audit trait rather
        //    than by the sale path, which is precisely the kind of link that
        //    goes missing without anything failing.
        $staff = $this->actingAsUser($owner)
            ->getJson('/api/v1/reports/staff?from='.now()->subDay()->toDateString().'&to='.now()->toDateString())
            ->assertOk()->json('data.staff');
        $row = collect($staff)->firstWhere('staff_id', $owner->id);
        $this->assertNotNull($row, "{$type}: the person who rang it must appear in the staff report");
        $this->assertEqualsWithDelta($price, $row['revenue'], 0.001, "{$type}: the staff report");
    }

    #[DataProvider('trades')]
    public function test_what_the_shop_paid_for_it_never_leaves_the_server(string $type, string $itemType, float $price): void
    {
        // The one figure that must never reach a customer's browser, on every
        // trade, through the endpoint a customer's browser actually calls. A
        // margin is the shopkeeper's business and nobody else's — and a trade
        // added later inherits this test rather than needing somebody to
        // remember it.
        [$tenant, $owner] = $this->shop($type);
        $product = $this->product($tenant, $itemType, $price, cost: $price / 2);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => $price,
        ])->assertCreated()->json('data');

        // The lines have to BE there before their absence can prove anything.
        // A response that stopped returning items would otherwise pass this
        // for ever — an empty loop asserts nothing at all.
        $this->assertNotEmpty($sale['items'], "{$type}: the sale must return its lines");

        foreach ($sale['items'] as $item) {
            // Every field, not just `cost_price`. A cost leaked under a renamed
            // key is the same leak, and a named assertion would miss it — which
            // is exactly how one nearly shipped before.
            foreach ($item as $key => $value) {
                if (is_numeric($value) && abs((float) $value - $price / 2) < 0.001) {
                    $this->fail("{$type}: the buying price leaked to the client as `{$key}`");
                }
            }
        }
    }

    #[DataProvider('trades')]
    public function test_a_cashier_of_this_trade_can_reach_the_till_at_all(string $type): void
    {
        // The POS module is on for every one of these trades. A shop whose
        // cashier meets a 403 at the counter has no way to trade, and it is a
        // one-line default away at all times.
        [, $owner] = $this->shop($type);

        // "Not found" is a PASS here. The question is whether the request got
        // past the module gate at all, and an empty catalog answering 422 has
        // — a shop that is locked out answers 403 MODULE_DISABLED and never
        // reaches the lookup.
        $this->actingAsUser($owner)->getJson('/api/v1/pos/lookup?code=NOTHING')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    // ── The trade that sells nothing ────────────────────────────────

    public function test_a_books_only_shop_still_moves_money_and_still_has_no_catalog(): void
    {
        // The opposite chain, and it has to be asserted from both ends. A
        // finance tenant with a working catalog would be offering a screen it
        // can never sell from; one whose expenses do not reach the cashbook has
        // no product at all, because the books ARE the product.
        [$tenant, $owner] = $this->shop('finance');

        $this->assertSame([], BusinessTypes::itemTypesFor('finance', $tenant->features));

        // The MODULE gate, specifically — not a permission denial. The owner
        // holds every permission this shop has, so a 403 for any other reason
        // would be this test proving something it did not mean to.
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Nope', 'price' => 100,
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        $category = $this->actingAsUser($owner)
            ->postJson('/api/v1/expense-categories', ['name' => 'Rent'])
            ->assertCreated()->json('data');

        $this->actingAsUser($owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $category['id'],
            'amount' => 45000,
            'expense_date' => now()->toDateString(),
            'description' => 'Shop rent',
        ])->assertCreated();

        $book = app(ReportService::class)->cashbook(
            $tenant->id,
            null,
            now()->subDay()->toDateString(),
            now()->toDateString(),
        );
        $today = collect($book['days'])->firstWhere('date', now()->toDateString());

        $this->assertEqualsWithDelta(45000.0, (float) $today['money_out'], 0.001);
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private function product(Tenant $tenant, string $itemType, float $price, ?float $cost = null): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'type' => $itemType === 'service' ? 'service' : 'product',
            'item_type' => $itemType,
            'name' => 'Day one',
            'price' => $price,
            'cost_price' => $cost,
            'stock_quantity' => $itemType === 'service' ? 0 : 40,
            'track_inventory' => $itemType !== 'service',
            'is_active' => true,
        ]);
    }

    // ── What each trade may sell when the line is down ──────────────
    //
    // The offline rule is one sentence — *a till may do only what it can decide
    // correctly, alone* — and it lands DIFFERENTLY on each trade. A chemist is
    // almost entirely fenced out; a grocery is barely touched. Neither of those
    // is a policy decision anybody made per trade; both fall out of the rule.
    //
    // Which is exactly why it is worth pinning per trade: the day someone adds
    // a fourth refusal to `OfflinePolicy`, the question that matters is not
    // "does the refusal work" but "which shops just lost the ability to trade
    // through a power cut, and did we mean to do that to them?"

    #[DataProvider('trades')]
    public function test_this_trades_everyday_item_can_be_rung_with_no_server(string $type, string $itemType, float $price): void
    {
        // The default has to be YES. Offline selling that refuses a trade's
        // ordinary item is not a safety feature, it is a shop that cannot trade
        // through a power cut — which in Pakistan is most weeks.
        [$tenant] = $this->shop($type);
        $product = $this->product($tenant, $itemType, $price);

        $expected = $itemType === 'medicine';

        $this->assertSame(
            ! $expected,
            OfflinePolicy::sellable($product),
            "{$type}: an ordinary item of this trade",
        );
    }

    public function test_a_chemist_is_fenced_out_and_told_why(): void
    {
        // The one trade whose ordinary item cannot be sold offline at all, and
        // the reason is not caution: a medicine needs live batch quantities,
        // FEFO order and the expiry fence. Selling expired stock is a
        // regulatory event, not a variance.
        [$tenant] = $this->shop('pharmacy');
        $med = $this->product($tenant, 'medicine', 180.0);

        $this->assertFalse(OfflinePolicy::sellable($med));
        $this->assertStringContainsString('expiry', (string) OfflinePolicy::refusalFor($med));
    }

    public function test_a_retailer_can_sell_a_shirt_offline_but_not_a_handset_with_an_imei(): void
    {
        // Within ONE trade the answer differs per item, which is why the fence
        // is drawn on the item and not on the shop. A garments retailer would
        // otherwise be locked out for something an electronics shop does.
        [$tenant] = $this->shop('retail');

        $shirt = $this->product($tenant, 'physical_product', 1500.0);
        $handset = $this->product($tenant, 'physical_product', 90000.0);
        $handset->forceFill(['tracks_serial' => true])->save();

        $this->assertTrue(OfflinePolicy::sellable($shirt));
        $this->assertFalse(OfflinePolicy::sellable($handset->fresh()));
    }

    public function test_a_restaurant_may_ring_a_takeaway_offline_but_never_a_table(): void
    {
        // A plate of food is a plate of food. A TABLE is a shared object — two
        // tills would seat the same one, and the tab is settled against a bill
        // the server is holding open.
        $this->assertSame([], OfflinePolicy::violations([
            'payment_method' => 'cash',
            'order_type' => 'takeaway',
        ]));

        $this->assertNotEmpty(OfflinePolicy::violations([
            'payment_method' => 'cash',
            'order_type' => 'dine_in',
        ]));
    }

    public function test_a_tyre_shop_cannot_take_the_old_tyre_in_part_payment_offline(): void
    {
        // The automotive trade's own edge, and it is a TENDER rather than a
        // discount — a trade-in values goods coming BACK IN, which needs the
        // catalog the server holds. The part and the labour are fine; only the
        // way of paying is not.
        $reasons = OfflinePolicy::violations(['payment_method' => 'trade_in']);

        $this->assertNotEmpty($reasons);
        $this->assertStringContainsString('trade-in', strtolower($reasons[0]));
    }

    public function test_no_trade_may_put_a_sale_on_the_khata_with_the_line_down(): void
    {
        // The one refusal that applies to every trade equally, and the most
        // commercially painful — a Pakistani shop runs on khata. It is still
        // right: a customer's balance is shared, and two tills adding to it
        // without seeing each other is how a shop discovers in March that it is
        // owed money nobody recorded.
        $reasons = OfflinePolicy::violations(['payment_method' => 'credit']);

        $this->assertNotEmpty($reasons);
        $this->assertStringContainsString('shared', strtolower($reasons[0]));
    }

    // ── Foreign keys named by the client ────────────────────────────
    //
    // A sale payload carries ids: which product, which customer, which car.
    // Every one is a chance to name a row belonging to somebody else, and the
    // rule set is the only place that says no — the write path takes what it is
    // given.

    public function test_a_workshop_cannot_hang_a_sale_on_another_shops_car(): void
    {
        // Not an exposure: every read of a vehicle's history runs through the
        // tenant scope, so this car could never show anyone else's work. What
        // it WAS is a sale storing a pointer that resolves to nothing for ever
        // — a blank where a car should be, debugged by somebody a year later.
        [$tenant, $owner] = $this->shop('automotive');
        $product = $this->product($tenant, 'physical_product', 9800.0);

        [$otherShop] = $this->shop('automotive');
        $theirCar = CustomerVehicle::withoutTenancy()->create([
            'tenant_id' => $otherShop->id,
            'registration' => 'LEA-1234',
            'make' => 'Toyota',
        ]);

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 9800,
            'vehicle_id' => $theirCar->id,
        ])->assertStatus(422)->assertJsonValidationErrors('vehicle_id');
    }

    public function test_a_workshop_can_still_hang_a_sale_on_its_ow_n_car(): void
    {
        // The half that keeps the rule honest. A scope that refuses everything
        // passes the test above and breaks every tyre shop in the country.
        [$tenant, $owner] = $this->shop('automotive');
        $product = $this->product($tenant, 'physical_product', 9800.0);

        $car = CustomerVehicle::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'registration' => 'LEB-5678',
            'make' => 'Suzuki',
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
            'payment_method' => 'cash',
            'amount_paid' => 9800,
            'vehicle_id' => $car->id,
            'odometer' => 84000,
        ])->assertCreated()->json('data');

        $this->assertSame($car->id, $sale['vehicle_id']);
    }
}
