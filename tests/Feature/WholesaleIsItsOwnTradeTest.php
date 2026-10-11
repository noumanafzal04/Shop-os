<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ModulePackages;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHOLESALE IS ITS OWN TRADE.
 *
 * It was a category of Retail, and a hidden older code that answered as
 * retail. A business whose whole trade is selling ON — a maker, an importer,
 * a distributor — was told to call itself a shop, and was then put on the
 * public marketplace and offered table reservations.
 *
 * What is held here:
 *
 *   it is offered when a business is set up, with its own kinds
 *   it starts with what a wholesaler has, and without what only the public needs
 *   it cannot open without stock or without its dealers' accounts, on any plan
 *   and a distributor's day works: a dealer's rate, a carton, a quantity break,
 *     an order agreed on a quotation, sold on account against a limit
 */
class WholesaleIsItsOwnTradeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_it_is_offered_when_a_business_is_set_up_and_is_no_longer_a_kind_of_retail(): void
    {
        $offered = collect($this->getJson('/api/v1/business-types')->assertOk()->json('data'))->keyBy('code');

        $this->assertArrayHasKey('wholesale', $offered, 'A wholesaler setting up is not offered its own trade.');
        $this->assertSame('Wholesale & Distribution', $offered['wholesale']['label']);
        $this->assertContains('distributor', array_column($offered['wholesale']['categories'], 'value'));
        $this->assertContains('manufacturer', array_column($offered['wholesale']['categories'], 'value'));

        // One place to choose it, not two.
        $this->assertNotContains('wholesale', array_column($offered['retail']['categories'], 'value'), 'Wholesale is still listed as a kind of Retail Store as well.');

        // It answers as itself everywhere a rule asks what kind of business this is.
        $this->assertSame('wholesale', BusinessTypes::primary('wholesale'));
        $this->assertContains('Carton', BusinessTypes::unitsFor('wholesale'));
    }

    public function test_it_starts_with_what_a_wholesaler_has_and_without_what_only_the_public_needs(): void
    {
        $starts = BusinessTypes::defaultFeatures('wholesale');

        foreach (['products', 'pos', 'inventory', 'purchasing', 'customers', 'documents', 'stocktake', 'expenses'] as $has) {
            $this->assertTrue($starts[$has] ?? false, "A wholesaler starts without {$has}.");
        }
        // Its customers are shops, and they ring up.
        foreach (['marketplace', 'delivery', 'reservations', 'services', 'dine_in', 'kitchen', 'fuel'] as $public) {
            $this->assertFalse($starts[$public] ?? false, "A wholesaler starts with {$public}.");
        }

        // …but selling online stays one tick away: it can be handed it.
        $this->assertContains('marketplace', ModulePackages::eligibleFor('wholesale'));
        $this->assertNotContains('reservations', ModulePackages::eligibleFor('wholesale'));
        $this->assertNotContains('dine_in', ModulePackages::eligibleFor('wholesale'));
    }

    public function test_it_cannot_open_without_stock_or_its_dealers_accounts_on_any_plan(): void
    {
        $this->assertSame(['products', 'pos', 'inventory', 'customers'], ModulePackages::essentialFor('wholesale'));

        // The smallest plan there is: products, a till and labels. A retailer
        // on it has no customer book. A wholesaler does, because selling on
        // account to people it will see again is the trade.
        $basic = Plan::query()->create([
            'name' => 'Basic', 'code' => 'basic', 'price' => 2499, 'billing_period_months' => 1, 'grace_period_days' => 7,
        ]);

        $onBasic = ModulePackages::propose('wholesale', $basic)['included'];
        $this->assertContains('customers', $onBasic, 'A wholesaler on the smallest plan has no dealer accounts.');
        $this->assertContains('inventory', $onBasic, 'A wholesaler on the smallest plan has no stock figure.');

        $this->assertNotContains('customers', ModulePackages::propose('retail', $basic)['included'], 'The essentials rule is giving every trade a customer book.');
    }

    /**
     * A distributor's day, in figures.
     *
     * The price on the product IS the dealer's rate. A carton is twelve
     * bottles at its own price; five cartons or more bring the bottle down.
     * A dealer buys on account against a limit — and is refused past it, with
     * what is owed left exactly as it was.
     */
    public function test_a_distributor_sells_by_the_carton_on_account_and_stops_at_the_dealers_limit(): void
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);
        $shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'timezone' => 'UTC',
            'business_type' => 'wholesale', 'business_category' => 'distributor',
            'features' => BusinessTypes::defaultFeatures('wholesale'),
        ]);
        $owner = User::factory()->shopOwner($shop)->create();

        $oil = $this->as($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Cooking Oil 1L',
            'price' => 575, 'cost' => 540, 'track_inventory' => true, 'stock_quantity' => 600,
            'units' => [['name' => 'Carton', 'factor' => 12, 'price' => 6600]],
            'price_tiers' => [['min_qty' => 60, 'price' => 560]],
            'description' => 'Bottle', 'tax_rate' => 0,
        ])->assertCreated()->json('data');
        $carton = $oil['units'][0]['id'];

        $dealer = $this->as($owner)->postJson('/api/v1/customers', [
            'name' => 'Madina General Store', 'phone' => '03001234567', 'credit_limit' => 50000,
        ])->assertCreated()->json('data');

        // The order is agreed on paper first…
        $quote = $this->as($owner)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_id' => $dealer['id'],
            'items' => [['product_id' => $oil['id'], 'product_unit_id' => $carton, 'quantity' => 3]],
        ])->assertCreated()->json('data');
        $this->assertEquals(19800, $quote['total'], 'Three cartons at the carton price is not what was quoted.');

        // …and invoiced on the dealer's account: the whole of it goes on the book.
        $this->as($owner)->postJson("/api/v1/sale-documents/{$quote['id']}/convert", ['payment_method' => 'credit', 'amount_paid' => 19800])
            ->assertCreated();
        $this->assertEquals(19800, Customer::withoutTenancy()->findOrFail($dealer['id'])->credit_balance);
        $this->assertEquals(600 - 36, Product::withoutTenancy()->findOrFail($oil['id'])->stock_quantity, 'Three cartons are thirty-six bottles off the shelf.');

        // Sixty bottles is the break: 560 each, 33,600 — and that would put
        // the dealer at 53,400 against a limit of 50,000.
        $sale = fn (int $bottles, int $onAccount) => $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'credit', 'amount_paid' => $onAccount,
            'customer_name' => $dealer['name'], 'customer_phone' => $dealer['phone'],
            'items' => [['product_id' => $oil['id'], 'quantity' => $bottles]],
        ]);

        $sale(60, 33600)->assertStatus(422)->assertJsonPath('meta.error_code', 'CREDIT_LIMIT_EXCEEDED');
        $this->assertEquals(19800, Customer::withoutTenancy()->findOrFail($dealer['id'])->credit_balance, 'A refused sale was still put on the account.');
        $this->assertEquals(564, Product::withoutTenancy()->findOrFail($oil['id'])->stock_quantity, 'A refused sale still took stock.');

        // Forty-eight is under the break — 575 each, 27,600 — and inside the limit.
        $rung = $sale(48, 27600)->assertCreated()->json('data');
        $this->assertEquals(27600, $rung['total']);
        $this->assertEquals(47400, Customer::withoutTenancy()->findOrFail($dealer['id'])->credit_balance);

        // And the break itself, paid in cash: sixty at 560.
        $bulk = $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 33600,
            'items' => [['product_id' => $oil['id'], 'quantity' => 60]],
        ])->assertCreated()->json('data');
        $this->assertEquals(33600, $bulk['total'], 'Sixty bottles did not get the quantity break.');

        $this->assertEquals(600 - 36 - 48 - 60, Product::withoutTenancy()->findOrFail($oil['id'])->stock_quantity);
        // It is not on the public marketplace.
        $this->assertFalse($shop->fresh()->featureEnabled('marketplace'));
    }
}
