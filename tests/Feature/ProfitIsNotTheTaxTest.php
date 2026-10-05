<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * PROFIT IS NOT THE TAX.
 *
 * Found by adding a trading day up by hand and comparing it with the Reports
 * screen: ten sales, Rs 43,543.96 taken, Rs 3,599.96 of it sales tax — and a
 * "Gross Profit" that was high by exactly the tax.
 *
 * Revenue is what customers paid, tax and all, and both profits were struck
 * straight from it. Sales tax is held for the government. A shop on an 18%
 * group selling at a 15% margin was shown a healthy business while running at
 * a loss.
 *
 * Every existing report test rang untaxed goods, so tax-in-profit was zero in
 * all of them and nothing could see it.
 */
class ProfitIsNotTheTaxTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(string $name, float $price, float $cost, float $taxRate, string $soldBy = 'unit'): Product
    {
        return Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'cost' => $cost, 'tax_rate' => $taxRate,
            'sold_by' => $soldBy, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    /** @return array<string, mixed> */
    private function sell(Product $product, float $quantity): array
    {
        return $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1_000_000,
            'items' => [['product_id' => $product->id, 'quantity' => $quantity]],
        ])->assertCreated()->json('data');
    }

    /** @return array<string, mixed> */
    private function summary(): array
    {
        $today = now()->toDateString();

        return $this->asOwner()->getJson("/api/v1/reports/summary?from={$today}&to={$today}")->assertOk()->json('data.totals');
    }

    public function test_the_tax_a_shop_collects_is_not_counted_as_its_profit(): void
    {
        // Sells at 1,000, costs 800, taxed at 18%. The shop makes 200 on it.
        $this->sell($this->product('Oil', 1000, 800, 18), 1);

        $totals = $this->summary();

        $this->assertEqualsWithDelta(1180.0, $totals['revenue'], 0.001);  // what the customer paid
        $this->assertEqualsWithDelta(180.0, $totals['tax'], 0.001);        // not the shop's
        $this->assertEqualsWithDelta(800.0, $totals['cogs'], 0.001);
        // It read 380 — the 200 it made, plus the government's 180.
        $this->assertEqualsWithDelta(200.0, $totals['gross_profit'], 0.001);
        $this->assertEqualsWithDelta(200.0, $totals['net_profit'], 0.001);
    }

    public function test_the_row_adds_up_on_screen(): void
    {
        $this->sell($this->product('Oil', 1000, 800, 18), 3);
        $this->sell($this->product('Rice', 500, 420, 0), 2);

        $t = $this->summary();

        $this->assertEqualsWithDelta(
            $t['gross_profit'],
            $t['revenue'] - $t['refunds'] - $t['tax'] - $t['cogs'],
            0.005,
            'revenue − refunds − tax − cost of goods must BE the gross profit shown',
        );
    }

    public function test_a_return_hands_the_tax_back_and_the_books_say_so(): void
    {
        $sale = $this->sell($this->product('Oil', 1000, 800, 18), 2);

        $this->asOwner()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertSuccessful();

        // Two sold, one came back: one bottle's profit, one bottle's tax.
        $totals = $this->summary();
        $this->assertEqualsWithDelta(180.0, $totals['tax'], 0.001);
        $this->assertEqualsWithDelta(200.0, $totals['gross_profit'], 0.001);

        // And the report a shop FILES from nets it too. It showed 360 "collected"
        // with no word that 180 of it had gone back across the counter.
        $today = now()->toDateString();
        $tax = $this->asOwner()->getJson("/api/v1/reports/tax?from={$today}&to={$today}")->assertOk()->json('data.totals');
        $this->assertEqualsWithDelta(360.0, $tax['tax_collected'], 0.001);
        $this->assertEqualsWithDelta(180.0, $tax['tax_refunded'], 0.001);
        $this->assertEqualsWithDelta(180.0, $tax['tax_payable'], 0.001);
    }

    public function test_a_shop_that_charges_no_tax_sees_the_figures_it_always_did(): void
    {
        $this->sell($this->product('Rice', 500, 420, 0), 4);

        $totals = $this->summary();

        $this->assertEqualsWithDelta(0.0, $totals['tax'], 0.001);
        $this->assertEqualsWithDelta(320.0, $totals['gross_profit'], 0.001);
    }

    public function test_goods_sold_by_weight_are_counted_in_the_weight_sold(): void
    {
        // 3.5 kg read "3" in Top Items, beside a revenue that was plainly 3.5 of them.
        $sugar = $this->product('Sugar', 160, 140, 0, 'weight');
        $this->sell($sugar, 2.5);
        $this->sell($sugar, 1);

        $today = now()->toDateString();
        $top = $this->asOwner()->getJson("/api/v1/reports/summary?from={$today}&to={$today}")->assertOk()->json('data.top_products');

        $this->assertEqualsWithDelta(3.5, $top[0]['units'], 0.0001);
        $this->assertEqualsWithDelta(560.0, $top[0]['revenue'], 0.001);
    }

    public function test_the_dashboard_profit_tile_leaves_the_tax_out_too(): void
    {
        // The same sum, written a second time in DashboardService, with the
        // same fault. Two screens that must agree were both wrong together.
        $this->sell($this->product('Oil', 1000, 800, 18), 1);

        $dashboard = $this->asOwner()->getJson('/api/v1/dashboard')->assertOk()->json('data');

        $this->assertEqualsWithDelta(1180.0, $dashboard['today']['revenue'], 0.001);
        $this->assertEqualsWithDelta(200.0, $dashboard['today']['profit'], 0.001);
        // …and the chart's last point is the tile, as it always promised.
        $last = end($dashboard['sales_series']);
        $this->assertEqualsWithDelta(200.0, $last['profit'], 0.001);
    }
}
