<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHOLESALE #W1, THE SHOPS ALREADY MADE.
 *
 * New wholesale shops stopped being switched onto the marketplace; the
 * re-test found the ones made before still listed, dealer breaks and all.
 */
class ADistributorIsNotOnTheMarketTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    public function test_a_distributor_listed_before_the_fix_comes_off_and_a_shop_of_another_trade_does_not(): void
    {
        $distributor = $this->listed('wholesale', 'hisaab-qa-wholesale');
        $mart = $this->listed('mart', 'qa-mart');
        $this->assertTrue(Tenant::query()->marketplaceVisible()->whereKey($distributor->id)->exists());

        (require database_path('migrations/2026_10_27_000001_a_distributor_already_listed_comes_off_the_market.php'))->up();

        $distributor->refresh();
        $this->assertFalse($distributor->features['marketplace']);
        $this->assertFalse($distributor->features['delivery']);
        $this->assertFalse((bool) $distributor->online_shop_enabled);
        $this->assertNotContains('hisaab-qa-wholesale', array_column($this->getJson('/api/v1/marketplace/shops')->json('data'), 'slug'));

        // Everybody else is left exactly as they were.
        $this->assertTrue(Tenant::query()->marketplaceVisible()->whereKey($mart->id)->exists());
    }

    public function test_a_distributor_that_does_sell_online_never_shows_its_dealer_breaks(): void
    {
        // An admin may tick the marketplace back on for a distributor that
        // really sells online. Its breaks are still its dealers' terms.
        $distributor = $this->listed('wholesale', 'hisaab-qa-wholesale');
        $mart = $this->listed('mart', 'qa-mart');
        $tiers = [['min_qty' => 10, 'price' => 8600], ['min_qty' => 50, 'price' => 8450]];
        $this->product($distributor, 'Sugar Bag 50kg', $tiers);
        $this->product($mart, 'Sugar 1kg', [['min_qty' => 10, 'price' => 170]]);

        $whl = $this->getJson('/api/v1/marketplace/shops/hisaab-qa-wholesale/products')->assertOk()->json('data.0');
        $this->assertSame(9000.0, (float) $whl['price']);
        $this->assertNull($whl['price_tiers']);

        // A mart's "buy more, pay less" stays on show.
        $this->assertNotEmpty($this->getJson('/api/v1/marketplace/shops/qa-mart/products')->assertOk()->json('data.0.price_tiers'));
    }

    private function listed(string $trade, string $slug): Tenant
    {
        $tenant = Tenant::factory()->create([
            'business_name' => $slug, 'slug' => $slug, 'business_type' => $trade,
            'setup_completed' => true, 'city_id' => $this->city->id,
            'features' => BusinessTypes::defaultFeatures($trade),
        ]);

        // Listed the way the plan used to list it.
        return $tenant->applyModules(['marketplace' => true, 'delivery' => true])->refresh();
    }

    /** @param array<int, array{min_qty: int, price: int}> $tiers */
    private function product(Tenant $tenant, string $name, array $tiers): void
    {
        Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $name === 'Sugar 1kg' ? 180 : 9000, 'price_tiers' => $tiers,
            'is_active' => true, 'visible_in_marketplace' => true, 'track_inventory' => false,
        ]);
    }
}
