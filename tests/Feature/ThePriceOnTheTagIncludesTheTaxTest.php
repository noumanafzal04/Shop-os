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
 * A SHOP WHOSE TAG PRICE INCLUDES THE TAX.
 *
 * Most retail prices this way: the tag says 5,490 and that is what the
 * customer pays, with the sales tax somewhere inside it. Two reports read
 * that tag price as if it were the shop's to keep.
 *
 *   Margins   struck each item's profit from its line total. Where tax is
 *             added on top the line total never had tax in it; where the tag
 *             includes it, the line total IS the tag. A suit sold at 5,490,
 *             cost 3,200, "made 2,290 — a 41.7% margin". 837.46 of that is
 *             the government's. It made 1,452.54, at 31.2%.
 *
 *   Tax       reported "net sales" as subtotal less discount — which for
 *             these shops is the gross. Net 30,060, gross 30,060, tax
 *             collected 4,186.73: three figures that cannot all be true.
 *
 * The Overview tab had been cured of the same fault (`ProfitIsNotTheTaxTest`).
 * Found by ringing a morning's sales in a clothing shop made by hand, and
 * adding the day up twice.
 */
class ThePriceOnTheTagIncludesTheTaxTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function aShop(bool $tagIncludesTax): void
    {
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
            'settings' => ['tax_inclusive' => $tagIncludesTax],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function item(string $name, float $price, float $cost, float $taxRate): Product
    {
        return Product::query()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'cost' => $cost, 'tax_rate' => $taxRate,
            'track_inventory' => false, 'is_active' => true,
        ]);
    }

    /** @return array<string, mixed> */
    private function sell(Product $product, float $quantity = 1, float $discount = 0): array
    {
        return $this->asOwner()->postJson('/api/v1/sales', array_filter([
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1_000_000,
            'items' => [['product_id' => $product->id, 'quantity' => $quantity]],
            'discount' => $discount ?: null,
        ]))->assertCreated()->json('data');
    }

    /** @return array<string, mixed> */
    private function report(string $which): array
    {
        $today = now()->toDateString();

        return $this->asOwner()->getJson("/api/v1/reports/{$which}?from={$today}&to={$today}")->assertOk()->json('data');
    }

    // ── margins ─────────────────────────────────────────────────────────

    public function test_the_tax_inside_the_tag_is_not_the_items_profit(): void
    {
        $this->aShop(tagIncludesTax: true);
        $sale = $this->sell($this->item('Lawn Suit', 5490, 3200, 18));
        // The till took the tax out of the tag, as it should: 5,490 × 18/118.
        $this->assertEqualsWithDelta(837.46, (float) $sale['tax'], 0.005);
        $this->assertEqualsWithDelta(5490.0, (float) $sale['total'], 0.005);

        $suit = $this->report('margins')['best'][0];

        $this->assertEqualsWithDelta(4652.54, $suit['revenue'], 0.01, 'the item is credited with the tax in its price');
        $this->assertEqualsWithDelta(3200.0, $suit['cogs'], 0.01);
        // It read 2,290 — the 1,452.54 it made, plus the government's 837.46.
        $this->assertEqualsWithDelta(1452.54, $suit['profit'], 0.01);
        $this->assertEqualsWithDelta(31.2, $suit['margin_pct'], 0.05);
    }

    public function test_each_line_gives_back_the_tax_at_its_own_rate(): void
    {
        $this->aShop(tagIncludesTax: true);
        $this->sell($this->item('Kurta', 2950, 1600, 18));          // 2,950 / 1.18 = 2,500.00
        $this->sell($this->item('Kids Suit', 1950, 950, 5));         // 1,950 / 1.05 = 1,857.14
        $this->sell($this->item('Stitching', 1500, 0, 0));           // nothing in it to give back

        $margins = $this->report('margins');
        $by = collect($margins['best'])->keyBy('name');

        $this->assertEqualsWithDelta(2500.00, $by['Kurta']['revenue'], 0.01);
        $this->assertEqualsWithDelta(900.00, $by['Kurta']['profit'], 0.01);
        $this->assertEqualsWithDelta(1857.14, $by['Kids Suit']['revenue'], 0.01);
        $this->assertEqualsWithDelta(907.14, $by['Kids Suit']['profit'], 0.01);
        $this->assertEqualsWithDelta(1500.00, $by['Stitching']['revenue'], 0.01);
        $this->assertEqualsWithDelta(5857.14, $margins['totals']['revenue'], 0.02);
        $this->assertEqualsWithDelta(3307.14, $margins['totals']['profit'], 0.02);
    }

    public function test_margins_and_the_overview_agree_about_the_days_profit(): void
    {
        // The two tabs sit side by side and answered the same question
        // differently by exactly the tax collected.
        $this->aShop(tagIncludesTax: true);
        $this->sell($this->item('Kurta', 2950, 1600, 18), 2);
        $this->sell($this->item('Lawn Suit', 5490, 3200, 18));

        $margins = $this->report('margins')['totals'];
        $overview = $this->report('summary')['totals'];

        $this->assertEqualsWithDelta($overview['gross_profit'], $margins['profit'], 0.02, 'Margins and Overview disagree about what the shop made today');
    }

    public function test_a_shop_that_adds_tax_on_top_reads_what_it_always_did(): void
    {
        $this->aShop(tagIncludesTax: false);
        $sale = $this->sell($this->item('Oil', 1000, 800, 18));
        $this->assertEqualsWithDelta(1180.0, (float) $sale['total'], 0.005);

        $oil = $this->report('margins')['best'][0];

        $this->assertEqualsWithDelta(1000.0, $oil['revenue'], 0.01, 'tax was taken off a price that never had it in');
        $this->assertEqualsWithDelta(200.0, $oil['profit'], 0.01);
        $this->assertEqualsWithDelta(20.0, $oil['margin_pct'], 0.05);
    }

    public function test_what_came_back_still_comes_off_and_its_tax_with_it(): void
    {
        $this->aShop(tagIncludesTax: true);
        $sale = $this->sell($this->item('Kurta', 2950, 1600, 18), 2);
        $this->asOwner()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertSuccessful();

        $kurta = $this->report('margins')['best'][0];

        // Two sold, one came back: one kurta's price before tax, one kurta's profit.
        $this->assertEqualsWithDelta(1.0, $kurta['units'], 0.001);
        $this->assertEqualsWithDelta(2500.0, $kurta['revenue'], 0.01);
        $this->assertEqualsWithDelta(900.0, $kurta['profit'], 0.01);
    }

    // ── the tax report ──────────────────────────────────────────────────

    public function test_net_sales_is_before_tax_when_the_tag_includes_it(): void
    {
        $this->aShop(tagIncludesTax: true);
        $this->sell($this->item('Kurta', 2950, 1600, 18), 2);        // 5,900 · tax 900.00
        $this->sell($this->item('Kids Suit', 1950, 950, 5));          // 1,950 · tax 92.86

        $tax = $this->report('tax')['totals'];

        $this->assertEqualsWithDelta(7850.0, $tax['gross_sales'], 0.01);
        $this->assertEqualsWithDelta(992.86, $tax['tax_collected'], 0.01);
        // It read 7,850 — the same as gross.
        $this->assertEqualsWithDelta(6857.14, $tax['net_sales'], 0.01);
        $this->assertEqualsWithDelta($tax['gross_sales'], $tax['net_sales'] + $tax['tax_collected'], 0.01, 'net + tax is not the gross a customer paid');
    }

    public function test_a_discount_comes_off_before_the_tax_is_taken_out(): void
    {
        $this->aShop(tagIncludesTax: true);
        $sale = $this->sell($this->item('Kurta', 2950, 1600, 18), 1, discount: 500);
        // 2,450 paid, 2,450 × 18/118 = 373.73 of it tax.
        $this->assertEqualsWithDelta(2450.0, (float) $sale['total'], 0.005);
        $this->assertEqualsWithDelta(373.73, (float) $sale['tax'], 0.005);

        $tax = $this->report('tax')['totals'];

        $this->assertEqualsWithDelta(2076.27, $tax['net_sales'], 0.01);
        $this->assertEqualsWithDelta($tax['gross_sales'], $tax['net_sales'] + $tax['tax_collected'], 0.01);
    }

    public function test_net_sales_where_tax_goes_on_top_is_what_it_always_was(): void
    {
        $this->aShop(tagIncludesTax: false);
        $this->sell($this->item('Oil', 1000, 800, 18), 2);

        $tax = $this->report('tax')['totals'];

        $this->assertEqualsWithDelta(2000.0, $tax['net_sales'], 0.01);
        $this->assertEqualsWithDelta(360.0, $tax['tax_collected'], 0.01);
        $this->assertEqualsWithDelta(2360.0, $tax['gross_sales'], 0.01);
    }
}
