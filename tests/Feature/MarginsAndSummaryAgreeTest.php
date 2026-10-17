<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * ONE SHOP, ONE GROSS PROFIT — on every tab of Reports.
 *
 * Money pass 2026-10-16 ($5): a manual discount, a coupon and a promotion
 * (Rs 425 in all) came off the bills, and Summary said gross profit
 * 16,834.82 while Margins said 17,259.82 — out by exactly the 425. Margins
 * took each line's value net of returns and never took off its share of a
 * discount given on the whole bill. The refund engine already shares it out
 * by value; this holds Margins to the same, in both tax modes.
 */
class MarginsAndSummaryAgreeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $rice;

    private Product $besan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'timezone' => 'UTC',
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $item = fn (string $name, float $price, float $cost) => Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'cost' => $cost, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
        // Awkward on purpose, as the pass priced them.
        $this->rice = $item('Rice Bag 5kg', 2999.99, 2300);
        $this->besan = $item('Besan Pack 1kg', 333.33, 240.50);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array<string, mixed> */
    private function report(string $what, string $day): array
    {
        return $this->as()->getJson("/api/v1/reports/{$what}?period=custom&from={$day}&to={$day}")->assertOk()->json('data');
    }

    public function test_a_discount_on_the_bill_comes_off_margins_as_it_comes_off_the_summary(): void
    {
        foreach (['2026-06-15' => false, '2026-06-16' => true] as $day => $inclusive) {
            $this->travelTo("{$day} 10:00:00");
            $this->as()->putJson('/api/v1/shop/settings', ['default_tax_rate' => 17, 'tax_inclusive' => $inclusive])->assertOk();

            // Two lines and 200 off the bill; a bill with nothing off; one rice back.
            $discounted = $this->as()->postJson('/api/v1/sales', [
                'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 99999, 'discount' => 200,
                'items' => [['product_id' => $this->rice->id, 'quantity' => 2], ['product_id' => $this->besan->id, 'quantity' => 3]],
            ])->assertCreated()->json('data');
            $this->as()->postJson('/api/v1/sales', [
                'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 99999,
                'items' => [['product_id' => $this->besan->id, 'quantity' => 1]],
            ])->assertCreated();
            $riceLine = collect($discounted['items'])->firstWhere('product_id', $this->rice->id);
            $this->as()->postJson("/api/v1/sales/{$discounted['id']}/returns", [
                'items' => [['sale_item_id' => $riceLine['id'], 'quantity' => 1]],
            ])->assertCreated();

            $summary = $this->report('summary', $day)['totals'];
            $margins = $this->report('margins', $day)['totals'];
            $mode = $inclusive ? 'inclusive' : 'exclusive';

            $this->assertEqualsWithDelta(
                round($summary['revenue'] - $summary['refunds'] - $summary['tax'], 2),
                $margins['revenue'],
                0.011,
                "tax {$mode}: Margins counted the goods at another figure than Summary",
            );
            $this->assertEquals($summary['cogs'], $margins['cogs'], "tax {$mode}: cost of goods");
            $this->assertEqualsWithDelta($summary['gross_profit'], $margins['profit'], 0.011, "tax {$mode}: two gross profits for one shop");
        }
    }
}
