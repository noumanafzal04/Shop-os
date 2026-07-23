<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Mobile prep: universal search, home feed aggregate, open-now enforcement.
 */
class MobileApiTest extends TestCase
{
    use RefreshDatabase;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->city = City::query()->create(['name' => 'Lahore', 'latitude' => 31.5204, 'longitude' => 74.3587, 'is_active' => true]);
    }

    private function makeShop(string $name, array $attrs = []): Tenant
    {
        return Tenant::factory()->create(array_merge([
            'business_name' => $name,
            'slug' => \Illuminate\Support\Str::slug($name),
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $this->city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'latitude' => 31.5204,
            'longitude' => 74.3587,
            // Pin to UTC so hour-window assertions built from now() are
            // deterministic (tz behaviour is covered explicitly elsewhere).
            'timezone' => 'UTC',
        ], $attrs));
    }

    private function makeProduct(Tenant $shop, string $name, array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => $name,
            'price' => 100, 'stock_quantity' => 10,
        ], $attrs));
    }

    // ── Universal search ─────────────────────────────────────────────

    public function test_search_returns_grouped_ranked_results(): void
    {
        $shop = $this->makeShop('Pizza Palace');
        $other = $this->makeShop('Book Barn');
        $this->makeProduct($shop, 'Pizza');                       // exact
        $this->makeProduct($shop, 'Pizza Fries');                 // prefix
        $this->makeProduct($other, 'Frozen Mini Pizza Pack');     // contains
        $this->makeProduct($other, 'Novel');                      // no match
        Category::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Pizza & Fast Food', 'is_active' => true]);

        $data = $this->getJson('/api/v1/marketplace/search?q=pizza')->assertOk()->json('data');

        // Ranking: exact first, then prefix, then contains.
        $names = array_column($data['products'], 'name');
        $this->assertSame(['Pizza', 'Pizza Fries', 'Frozen Mini Pizza Pack'], $names);
        // Product carries its shop for navigation.
        $this->assertSame('pizza-palace', $data['products'][0]['shop']['slug']);
        // Shop + category groups matched too.
        $this->assertSame('Pizza Palace', $data['shops'][0]['business_name']);
        $this->assertSame('Pizza & Fast Food', $data['categories'][0]['name']);
    }

    public function test_search_includes_distance_when_located(): void
    {
        $shop = $this->makeShop('Near Deals', ['latitude' => 31.5210, 'longitude' => 74.3590]);
        $this->makeProduct($shop, 'Deal Box');

        $data = $this->getJson('/api/v1/marketplace/search?q=deal&lat=31.5204&lng=74.3587')
            ->assertOk()->json('data');

        $this->assertNotNull($data['products'][0]['distance_km']);
        $this->assertLessThan(1, $data['products'][0]['distance_km']);
    }

    public function test_search_requires_a_real_query(): void
    {
        $this->getJson('/api/v1/marketplace/search?q=a')->assertStatus(422);
    }

    // ── Home feed ────────────────────────────────────────────────────

    public function test_home_returns_all_sections_in_one_call(): void
    {
        $near = $this->makeShop('Corner Store', ['latitude' => 31.5210, 'longitude' => 74.3590]);
        $this->makeShop('Distant Store', ['latitude' => 31.60, 'longitude' => 74.45]);

        // A published review makes it top-rated.
        $customer = User::factory()->create();
        \App\Models\Review::withoutTenancy()->create([
            'tenant_id' => $near->id, 'customer_id' => $customer->id, 'rating' => 5, 'is_published' => true,
        ]);

        \App\Models\Banner::query()->create([
            'tenant_id' => $near->id, 'image_path' => 'banners/x.jpg',
            'target_type' => 'shop', 'placement' => 'home', 'is_active' => true,
        ]);

        // A discounted product powers the deals carousel.
        $this->makeProduct($near, 'Deal Sneaker', ['price' => 1000, 'discount_price' => 750]);

        $data = $this->getJson('/api/v1/marketplace/home?lat=31.5204&lng=74.3587')->assertOk()->json('data');

        $this->assertCount(1, $data['banners']);
        $this->assertSame('corner-store', $data['banners'][0]['target']['shop_slug']);
        $this->assertSame('Corner Store', $data['nearby'][0]['business_name']); // nearest first
        $this->assertSame('Corner Store', $data['top_rated'][0]['business_name']);
        $this->assertSame('retail', $data['business_types'][0]['type']);
        $this->assertSame(2, $data['business_types'][0]['shops_count']);
        $this->assertSame('Deal Sneaker', $data['deals'][0]['name']);
        $this->assertSame(25, $data['deals'][0]['percent_off']);
        $this->assertSame('corner-store', $data['deals'][0]['shop']['slug']);
    }

    // ── Open now ─────────────────────────────────────────────────────

    public function test_closed_shop_rejects_orders_and_flags_lists(): void
    {
        // Configured hours that exclude "now": open only 03:00–03:05 today.
        $now = now();
        $shop = $this->makeShop('Strict Hours Mart', [
            'business_hours' => [[
                'day' => $now->dayOfWeek,
                'open' => '03:00',
                'close' => '03:01',
            ]],
        ]);
        // Guard against the test actually running at 03:00.
        if ($now->format('H:i') <= '03:01') {
            $shop->update(['business_hours' => [['day' => ($now->dayOfWeek + 1) % 7, 'open' => '09:00', 'close' => '17:00']]]);
        }
        $product = $this->makeProduct($shop, 'Thing');
        $customer = User::factory()->create();

        // Flagged on the public card…
        $rows = $this->getJson('/api/v1/marketplace/shops')->assertOk()->json('data');
        $this->assertFalse(collect($rows)->firstWhere('business_name', 'Strict Hours Mart')['is_open_now']);

        // …and ordering is blocked.
        $this->actingAs($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'SHOP_CLOSED');
    }

    public function test_shop_without_hours_is_always_orderable(): void
    {
        $shop = $this->makeShop('Always Open', ['business_hours' => null]);
        $product = $this->makeProduct($shop, 'Snack');
        $customer = User::factory()->create();
        $this->app['auth']->forgetGuards();

        $this->actingAs($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated();
    }
}
