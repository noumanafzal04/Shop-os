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
 * Location-based marketplace: GPS → city resolution, nearest-first shop
 * discovery, saved addresses, and delivery-radius enforcement.
 */
class GeoLocationTest extends TestCase
{
    use RefreshDatabase;

    private City $lahore;

    private City $karachi;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->lahore = City::query()->create(['name' => 'Lahore', 'latitude' => 31.5204, 'longitude' => 74.3587, 'is_active' => true]);
        $this->karachi = City::query()->create(['name' => 'Karachi', 'latitude' => 24.8607, 'longitude' => 67.0011, 'is_active' => true]);
    }

    private function makeShop(string $name, City $city, ?float $lat, ?float $lng, array $settings = []): Tenant
    {
        return Tenant::factory()->create([
            'business_name' => $name,
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'latitude' => $lat,
            'longitude' => $lng,
            'settings' => $settings,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_locate_resolves_gps_to_nearest_city(): void
    {
        // A point in Gulberg, Lahore.
        $data = $this->getJson('/api/v1/marketplace/locate?lat=31.52&lng=74.35')
            ->assertOk()->json('data');

        $this->assertSame('Lahore', $data['city']['name']);
        $this->assertTrue($data['in_service_area']);
    }

    public function test_locate_flags_out_of_service_area(): void
    {
        // Middle of the Arabian Sea — far from every seeded city.
        $data = $this->getJson('/api/v1/marketplace/locate?lat=20.0&lng=63.0')
            ->assertOk()->json('data');

        $this->assertFalse($data['in_service_area']);
    }

    public function test_shops_sorted_by_distance_with_distance_km(): void
    {
        $near = $this->makeShop('Near Mart', $this->lahore, 31.5210, 74.3590, []);
        $far = $this->makeShop('Far Mart', $this->lahore, 31.5800, 74.4400, []);
        $this->makeShop('No-Pin Mart', $this->lahore, null, null, []);

        $rows = $this->getJson('/api/v1/marketplace/shops?lat=31.5204&lng=74.3587')
            ->assertOk()->json('data');

        $this->assertSame('Near Mart', $rows[0]['business_name']);
        $this->assertSame('Far Mart', $rows[1]['business_name']);
        $this->assertNotNull($rows[0]['distance_km']);
        $this->assertLessThan($rows[1]['distance_km'], $rows[0]['distance_km']);
        // Un-pinned shops appear last, without a distance.
        $this->assertSame('No-Pin Mart', $rows[2]['business_name']);
        $this->assertNull($rows[2]['distance_km']);
    }

    public function test_shop_detail_answers_delivers_to_me(): void
    {
        $shop = $this->makeShop('Radius Mart', $this->lahore, 31.5204, 74.3587, ['delivery_radius_km' => 5]);

        // ~1 km away → inside.
        $in = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}?lat=31.5290&lng=74.3600")->json('data');
        $this->assertTrue($in['delivers_to_me']);

        // ~12 km away → outside.
        $out = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}?lat=31.6300&lng=74.3600")->json('data');
        $this->assertFalse($out['delivers_to_me']);
    }

    public function test_delivery_order_outside_radius_is_rejected(): void
    {
        $shop = $this->makeShop('Strict Mart', $this->lahore, 31.5204, 74.3587, ['delivery_radius_km' => 3]);
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Thing', 'price' => 100, 'stock_quantity' => 10,
        ]);
        $product = Product::withoutTenancy()->where('tenant_id', $shop->id)->first();
        $customer = User::factory()->create();

        // ~12 km away → rejected.
        $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug, 'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 1, Somewhere far', 'latitude' => 31.63, 'longitude' => 74.36,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'OUT_OF_DELIVERY_AREA');

        // ~1 km away → accepted, pin stored on the order.
        $order = $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug, 'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 2, Gulberg', 'latitude' => 31.529, 'longitude' => 74.36,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(31.529, $order['latitude'] ?? 31.529); // stored (serializer may omit)
        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'latitude' => 31.529]);
    }

    public function test_address_book_crud_with_single_default(): void
    {
        $customer = User::factory()->create();

        // First address auto-defaults.
        $home = $this->actingAsUser($customer)->postJson('/api/v1/customer/addresses', [
            'label' => 'Home', 'address' => 'House 12, DHA, Lahore', 'latitude' => 31.47, 'longitude' => 74.41, 'city_id' => $this->lahore->id,
        ])->assertCreated()->json('data');
        $this->assertTrue($home['is_default']);

        // Second set as default → first loses it.
        $work = $this->actingAsUser($customer)->postJson('/api/v1/customer/addresses', [
            'label' => 'Work', 'address' => 'Office 4, Gulberg', 'is_default' => true,
        ])->assertCreated()->json('data');
        $this->assertTrue($work['is_default']);

        $list = $this->actingAsUser($customer)->getJson('/api/v1/customer/addresses')->json('data');
        $this->assertCount(2, $list);
        $this->assertSame('Work', $list[0]['label']); // default sorts first
        $this->assertFalse(collect($list)->firstWhere('label', 'Home')['is_default']);

        // Deleting the default promotes the survivor.
        $this->actingAsUser($customer)->deleteJson("/api/v1/customer/addresses/{$work['id']}")->assertOk();
        $left = $this->actingAsUser($customer)->getJson('/api/v1/customer/addresses')->json('data');
        $this->assertCount(1, $left);
        $this->assertTrue($left[0]['is_default']);
    }

    public function test_addresses_are_private_per_customer(): void
    {
        $a = User::factory()->create();
        $b = User::factory()->create();
        $addr = $this->actingAsUser($a)->postJson('/api/v1/customer/addresses', [
            'address' => 'Secret place 1',
        ])->json('data');

        $this->actingAsUser($b)->putJson("/api/v1/customer/addresses/{$addr['id']}", ['label' => 'Hax'])
            ->assertNotFound();
        $this->assertCount(0, $this->actingAsUser($b)->getJson('/api/v1/customer/addresses')->json('data'));
    }
}
