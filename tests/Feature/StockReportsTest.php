<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * What the shelves are worth, what is not moving, and what actually pays.
 *
 * Three questions a shop could not previously ask:
 *
 *   "How much money am I standing in?" — the figure a bank meeting asks for,
 *   and the one that explains a busy till and an empty account.
 *
 *   "What have I been carrying for eight months?" — dead stock is the quietest
 *   way a shop loses cash; nothing prompts you to look at a shelf nobody buys
 *   from.
 *
 *   "Which line actually pays?" — the best SELLER and the best EARNER are
 *   frequently different items, and only one of those facts changes what you
 *   buy next.
 */
class StockReportsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Category $grains;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Faisalabad', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->grains = Category::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Grains']);
    }

    // ── Valuation ───────────────────────────────────────────────────

    public function test_the_shelves_are_valued_at_cost_and_at_retail(): void
    {
        $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200, category: $this->grains);
        $this->product('Cooking Oil 1L', stock: 5, cost: 480, price: 560);

        $report = $this->report('/api/v1/reports/valuation');

        $this->assertEquals(15, $report['totals']['units']);
        $this->assertEquals(11400, $report['totals']['cost_value']);   // 9000 + 2400
        $this->assertEquals(14800, $report['totals']['retail_value']); // 12000 + 2800
        $this->assertEquals(3400, $report['totals']['potential_profit']);
    }

    public function test_stock_nobody_costed_is_declared_rather_than_valued_at_nothing(): void
    {
        $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        // Bought cash off a van, cost never entered. Counting it as worthless
        // would understate the shelves; counting it at retail would overstate
        // the margin. So it is stated separately.
        $this->product('Loose sugar', stock: 20, cost: null, price: 150);

        $report = $this->report('/api/v1/reports/valuation');

        $this->assertEquals(9000, $report['totals']['cost_value']);
        $this->assertEquals(15000, $report['totals']['retail_value']);
        $this->assertSame(1, $report['totals']['uncosted_items']);
        $this->assertEquals(20, $report['totals']['uncosted_units']);
    }

    public function test_services_and_untracked_items_are_not_stock(): void
    {
        $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Home delivery', 'sku' => 'SVC', 'price' => 200,
            'track_inventory' => false, 'is_active' => true,
        ]);

        $this->assertSame(1, $this->report('/api/v1/reports/valuation')['totals']['lines']);
    }

    public function test_the_valuation_breaks_down_by_category(): void
    {
        $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200, category: $this->grains);
        $this->product('Cooking Oil 1L', stock: 5, cost: 480, price: 560);

        $byCategory = collect($this->report('/api/v1/reports/valuation')['by_category'])->keyBy('category');

        $this->assertEquals(9000, $byCategory['Grains']['cost_value']);
        // Everything else has to land somewhere nameable.
        $this->assertEquals(2400, $byCategory['Uncategorized']['cost_value']);
    }

    public function test_a_valuation_counts_only_the_branch_in_view(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        // Through the stock write-path, so Main's row is seeded from the legacy
        // rollup exactly as it would be in a real shop's first cross-branch move.
        app(InventoryService::class)->adjust([
            'product_id' => $rice->id, 'branch_id' => $gulberg->id,
            'type' => 'in', 'quantity' => 4, 'reason' => 'Opening stock',
        ]);
        $manager = User::factory()->tenantStaff($this->shop, ['reports.view'])
            ->create(['branch_id' => $gulberg->id]);

        // The owner's HQ view sums every site.
        $this->assertEquals(14, $this->report('/api/v1/reports/valuation')['totals']['units']);

        // The branch manager sees their own shelves only.
        $scoped = $this->actingAsUser($manager)
            ->getJson('/api/v1/reports/valuation')->assertOk()->json('data');
        $this->assertEquals(4, $scoped['totals']['units']);
    }

    // ── Dead stock ──────────────────────────────────────────────────

    public function test_stock_that_has_never_sold_is_named_as_such(): void
    {
        $this->product('Imported olives', stock: 12, cost: 700, price: 950);

        $report = $this->report('/api/v1/reports/dead-stock');

        $this->assertSame(1, $report['totals']['lines']);
        $this->assertSame(1, $report['totals']['never_sold']);
        $this->assertEquals(8400, $report['totals']['value']);
        // Never sold is a BUYING mistake, and a different problem from slow —
        // so it stays distinguishable rather than collapsing into "0 days".
        $this->assertNull($report['items'][0]['last_sold_at']);
        $this->assertNull($report['items'][0]['days_idle']);
    }

    public function test_something_that_sold_this_week_is_not_dead(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        $this->sell($rice, soldAt: now()->subDays(3));

        $this->assertSame(0, $this->report('/api/v1/reports/dead-stock')['totals']['lines']);
    }

    public function test_something_that_last_sold_months_ago_is(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        $this->sell($rice, soldAt: now()->subDays(200));

        $report = $this->report('/api/v1/reports/dead-stock');

        $this->assertSame(1, $report['totals']['lines']);
        $this->assertSame(0, $report['totals']['never_sold']);
        $this->assertSame(now()->subDays(200)->toDateString(), $report['items'][0]['last_sold_at']);
        $this->assertGreaterThanOrEqual(199, $report['items'][0]['days_idle']);
    }

    public function test_the_window_is_the_shops_to_choose(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        $this->sell($rice, soldAt: now()->subDays(45));

        // A grocery's "slow" is not a jeweller's.
        $this->assertSame(0, $this->report('/api/v1/reports/dead-stock?days=90')['totals']['lines']);
        $this->assertSame(1, $this->report('/api/v1/reports/dead-stock?days=30')['totals']['lines']);
    }

    public function test_an_empty_shelf_is_not_dead_stock(): void
    {
        // Nothing is tied up in it. It is a restocking question, not a
        // write-off one, and mixing the two makes the report useless.
        $this->product('Sold out item', stock: 0, cost: 500, price: 700);

        $this->assertSame(0, $this->report('/api/v1/reports/dead-stock')['totals']['lines']);
    }

    public function test_dead_stock_is_ranked_by_the_cash_it_is_holding(): void
    {
        $this->product('Cheap trinket', stock: 100, cost: 3, price: 10);
        $this->product('Imported olives', stock: 12, cost: 700, price: 950);

        $items = $this->report('/api/v1/reports/dead-stock')['items'];

        // Rs 8,400 on one shelf beats Rs 300 spread across a hundred trinkets,
        // however long both have sat.
        $this->assertSame('Imported olives', $items[0]['name']);
    }

    // ── Margins ─────────────────────────────────────────────────────

    public function test_the_best_seller_and_the_best_earner_are_not_the_same_question(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 100, cost: 1100, price: 1200);   // Rs 100 a bag
        $spice = $this->product('Masala sachet', stock: 100, cost: 20, price: 100);   // Rs 80 a sachet

        $this->sell($rice, qty: 10, soldAt: now()->subDay());    // Rs 12,000 revenue, Rs 1,000 profit
        $this->sell($spice, qty: 40, soldAt: now()->subDay());   // Rs  4,000 revenue, Rs 3,200 profit

        $report = $this->report('/api/v1/reports/margins?period=monthly');

        $this->assertEquals(16000, $report['totals']['revenue']);
        $this->assertEquals(4200, $report['totals']['profit']);

        // Ranked by what it PAYS, not by what it rings.
        $this->assertSame('Masala sachet', $report['best'][0]['name']);
        $this->assertEquals(3200, $report['best'][0]['profit']);
        $this->assertEquals(80.0, $report['best'][0]['margin_pct']);
    }

    public function test_anything_sold_below_cost_is_called_out(): void
    {
        // Almost always a costing mistake rather than a decision — and it is
        // invisible in any report ranked by revenue.
        $loss = $this->product('Mispriced flour', stock: 50, cost: 200, price: 150);
        $this->sell($loss, qty: 10, soldAt: now()->subDay());

        $report = $this->report('/api/v1/reports/margins?period=monthly');

        $this->assertCount(1, $report['losing']);
        $this->assertEquals(-500, $report['losing'][0]['profit']);
    }

    public function test_margin_uses_the_cost_the_line_was_sold_at_not_todays(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 100, cost: 900, price: 1200);
        $this->sell($rice, qty: 5, soldAt: now()->subDay());

        // The supplier put their price up this morning. Last month's margin is
        // not theirs to rewrite.
        $rice->forceFill(['cost' => 1150])->save();

        $report = $this->report('/api/v1/reports/margins?period=monthly');

        $this->assertEquals(1500, $report['best'][0]['profit']);   // (1200 − 900) × 5
    }

    public function test_margins_roll_up_by_category(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 100, cost: 900, price: 1200, category: $this->grains);
        $this->sell($rice, qty: 5, soldAt: now()->subDay());

        $byCategory = collect($this->report('/api/v1/reports/margins?period=monthly')['by_category'])->keyBy('category');

        $this->assertEquals(1500, $byCategory['Grains']['profit']);
        $this->assertEquals(25.0, $byCategory['Grains']['margin_pct']);
    }

    // ── Exports ─────────────────────────────────────────────────────

    public function test_every_new_report_can_be_taken_to_an_accountant(): void
    {
        $rice = $this->product('Basmati 5kg', stock: 10, cost: 900, price: 1200);
        $this->sell($rice, qty: 2, soldAt: now()->subDay());
        $this->product('Imported olives', stock: 12, cost: 700, price: 950);

        foreach ([
            '/api/v1/reports/valuation/export',
            '/api/v1/reports/dead-stock/export',
            '/api/v1/reports/margins/export?period=monthly',
        ] as $url) {
            $this->actingAsUser($this->owner)->get($url)
                ->assertOk()
                ->assertHeader('content-type', 'text/csv; charset=UTF-8');
        }
    }

    public function test_a_dead_stock_export_says_never_rather_than_leaving_a_blank(): void
    {
        $this->product('Imported olives', stock: 12, cost: 700, price: 950);

        $csv = $this->actingAsUser($this->owner)
            ->get('/api/v1/reports/dead-stock/export')
            ->assertOk()
            ->streamedContent();

        $this->assertStringContainsString('never', $csv);
    }

    // ── Gates ───────────────────────────────────────────────────────

    public function test_a_shop_that_carries_no_stock_gets_no_stock_reports(): void
    {
        $this->shop->forceFill(['features' => ['pos' => true, 'products' => true, 'inventory' => false]])->save();

        foreach (['/api/v1/reports/valuation', '/api/v1/reports/dead-stock'] as $url) {
            $this->actingAsUser($this->owner)->getJson($url)
                ->assertStatus(403)
                ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        }

        // Margins read sales, not shelves — a services shop still earns them.
        $this->actingAsUser($this->owner)->getJson('/api/v1/reports/margins')->assertOk();
    }

    public function test_reports_need_the_reporting_permission(): void
    {
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->actingAsUser($cashier)->getJson('/api/v1/reports/valuation')->assertForbidden();
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function report(string $url): array
    {
        return $this->actingAsUser($this->owner)->getJson($url)->assertOk()->json('data');
    }

    private function product(
        string $name,
        float $stock,
        ?float $cost,
        float $price,
        ?Category $category = null,
    ): Product {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'type' => 'product',
            'item_type' => 'physical',
            'name' => $name,
            'sku' => strtoupper(substr(md5($name), 0, 8)),
            'price' => $price,
            'cost' => $cost,
            'track_inventory' => true,
            'stock_quantity' => $stock,
            'category_id' => $category?->id,
            'is_active' => true,
        ]);
    }

    /** A completed sale of this product, dated. */
    private function sell(Product $product, float $qty = 1, ?Carbon $soldAt = null): void
    {
        $soldAt ??= now();

        $sale = Sale::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'invoice_number' => 'INV-'.random_int(100000, 999999),
            'channel' => 'pos',
            'status' => 'completed',
            'subtotal' => $qty * (float) $product->price,
            'total' => $qty * (float) $product->price,
            'payment_method' => 'cash',
            'amount_paid' => $qty * (float) $product->price,
            'sold_at' => $soldAt,
        ]);

        SaleItem::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'sale_id' => $sale->id,
            'product_id' => $product->id,
            'item_type' => 'physical',
            'product_name' => $product->name,
            'quantity' => $qty,
            'unit_price' => $product->price,
            'unit_cost' => $product->cost ?? 0,
            'line_total' => $qty * (float) $product->price,
        ]);

        app(InventoryService::class)->adjust([
            'product_id' => $product->id,
            'type' => 'out',
            'quantity' => $qty,
            'reason' => 'Test sale',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
