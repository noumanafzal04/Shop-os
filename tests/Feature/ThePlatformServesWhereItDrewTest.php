<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ServiceZone;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\ServiceZones;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

/**
 * THE PLATFORM SERVES WHERE IT DREW.
 *
 * The admin draws service zones — a circle, or a polygon traced along the
 * roads of a small town — and one set of zones answers two questions: may
 * this shop trade online (its own pin), and may an order be delivered here
 * (the customer's pin). While nothing is drawn nothing is fenced, so launching
 * before the map is drawn hides no shop.
 */
class ThePlatformServesWhereItDrewTest extends TestCase
{
    use RefreshDatabase;

    // Gulberg, Lahore — the zone's centre, and a shop inside it.
    private const CENTRE = [31.5204, 74.3587];

    private const INSIDE = [31.5220, 74.3600];   // ~220 m from the centre

    private const OUTSIDE = [31.4700, 74.2700];  // ~10 km away

    private Tenant $near;

    private Tenant $far;

    private User $admin;

    private User $customer;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Cache::flush();

        $city = $this->city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->near = $this->shop('Gulberg Grill', self::INSIDE, $city);
        $this->far = $this->shop('Far Away Foods', self::OUTSIDE, $city);
        $this->admin = User::factory()->superAdmin()->create();
        $this->customer = User::factory()->create();
    }

    private function shop(string $name, array $at, City $city): Tenant
    {
        $features = BusinessTypes::defaultFeatures('food');
        $features['marketplace'] = true;
        $features['delivery'] = true;
        $shop = Tenant::factory()->create([
            'business_name' => $name, 'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'food', 'features' => $features, 'city_id' => $city->id,
            'latitude' => $at[0], 'longitude' => $at[1], 'delivery_fee' => 100,
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'food_item', 'name' => 'Daal',
            'price' => 500, 'track_inventory' => false, 'visible_in_marketplace' => true, 'is_active' => true,
        ]);

        return $shop;
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return list<string> */
    private function listed(): array
    {
        return collect($this->getJson('/api/v1/marketplace/shops')->assertOk()->json('data'))
            ->pluck('business_name')->sort()->values()->all();
    }

    private function circle(int $radius = 800): array
    {
        return $this->as($this->admin)->postJson('/api/v1/admin/service-zones', [
            'name' => 'Gulberg', 'city_id' => $this->city->id, 'kind' => 'circle', 'center_lat' => self::CENTRE[0], 'center_lng' => self::CENTRE[1], 'radius_m' => $radius,
        ])->assertCreated()->json('data');
    }

    private function order(Tenant $shop, array $pin, string $how = 'delivery')
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => $how,
            'delivery_address' => '12 Main Boulevard',
            ...($how === 'delivery' ? ['latitude' => $pin[0], 'longitude' => $pin[1]] : []),
            'items' => [['product_id' => Product::withoutTenancy()->where('tenant_id', $shop->id)->value('id'), 'quantity' => 1]],
        ]);
    }

    public function test_a_circle_holds_what_is_within_its_radius_and_a_polygon_what_is_inside_its_corners(): void
    {
        $circle = ['kind' => 'circle', 'lat' => 31.5204, 'lng' => 74.3587, 'radius' => 762, 'points' => null];
        $this->assertTrue(ServiceZones::holds($circle, 31.5220, 74.3600));
        $this->assertFalse(ServiceZones::holds($circle, 31.5304, 74.3587)); // ~1.1 km north

        // An L along two roads: the notch between the arms is OUTSIDE.
        $l = ['kind' => 'polygon', 'lat' => null, 'lng' => null, 'radius' => null, 'points' => [
            [31.50, 74.30], [31.52, 74.30], [31.52, 74.31], [31.51, 74.31], [31.51, 74.33], [31.50, 74.33],
        ]];
        $this->assertTrue(ServiceZones::holds($l, 31.515, 74.305));  // up the first road
        $this->assertTrue(ServiceZones::holds($l, 31.505, 74.325));  // along the second
        $this->assertFalse(ServiceZones::holds($l, 31.515, 74.325)); // the notch
        $this->assertFalse(ServiceZones::holds($l, 31.53, 74.305));  // beyond the arm
        // West of the shape, level with the first arm: a ray east from here
        // crosses TWO edges — an even count, so outside. A test that counts
        // "any crossing" as inside fails on exactly this pin.
        $this->assertFalse(ServiceZones::holds($l, 31.515, 74.295));
    }

    public function test_with_nothing_drawn_every_shop_is_listed_and_every_pin_served(): void
    {
        $this->assertSame(['Far Away Foods', 'Gulberg Grill'], $this->listed());
        $this->getJson('/api/v1/marketplace/service-area?lat='.self::OUTSIDE[0].'&lng='.self::OUTSIDE[1])
            ->assertOk()->assertJsonPath('data.served', true)->assertJsonPath('data.zones_drawn', false);
        $this->order($this->near, self::OUTSIDE)->assertCreated();
    }

    public function test_a_zone_lists_only_the_shops_inside_it_and_says_how_many_it_left_out(): void
    {
        $saved = $this->circle();
        $this->assertSame(1, $saved['summary']['online_shops_outside'], 'the admin sees what the zone left out');
        $pins = collect($this->as($this->admin)->getJson('/api/v1/admin/service-zones')->assertOk()->json('data.shops'))
            ->pluck('in_service_zone', 'business_name')->all();
        $this->assertSame(['Far Away Foods' => false, 'Gulberg Grill' => true], $pins, 'the map shows each shop in or out');
        $this->assertSame(['Gulberg Grill'], $this->listed());

        $this->getJson('/api/v1/marketplace/service-area?lat='.self::INSIDE[0].'&lng='.self::INSIDE[1])
            ->assertJsonPath('data.served', true)->assertJsonPath('data.zone.name', 'Gulberg');
        $this->getJson('/api/v1/marketplace/service-area?lat='.self::OUTSIDE[0].'&lng='.self::OUTSIDE[1])
            ->assertJsonPath('data.served', false)->assertJsonPath('data.zone', null);
    }

    public function test_a_shop_that_moves_into_a_zone_is_listed_and_one_that_moves_out_is_not(): void
    {
        $this->circle();
        $this->far->forceFill(['latitude' => self::INSIDE[0], 'longitude' => self::INSIDE[1] + 0.0005])->save();
        $this->near->forceFill(['latitude' => self::OUTSIDE[0], 'longitude' => self::OUTSIDE[1]])->save();

        $this->assertSame(['Far Away Foods'], $this->listed());
    }

    public function test_a_delivery_goes_only_inside_a_zone_and_a_pickup_is_not_asked(): void
    {
        $this->circle(5000);
        $this->order($this->near, self::OUTSIDE)->assertUnprocessable()->assertJsonPath('meta.error_code', 'OUTSIDE_SERVICE_AREA');
        $this->order($this->near, self::INSIDE)->assertCreated();
        $this->order($this->near, self::OUTSIDE, 'pickup')->assertCreated();
    }

    public function test_a_shape_traced_along_a_road_serves_the_road_and_not_beside_it(): void
    {
        // A thin strip along a main road, 200 m either side.
        $this->as($this->admin)->postJson('/api/v1/admin/service-zones', [
            'name' => 'Main Bazaar road', 'city_id' => $this->city->id, 'kind' => 'polygon',
            'points' => [[31.5200, 74.3550], [31.5240, 74.3550], [31.5240, 74.3650], [31.5200, 74.3650]],
        ])->assertCreated();

        $this->assertSame(['Gulberg Grill'], $this->listed());
        $this->order($this->near, [31.5230, 74.3620])->assertCreated();
        $this->order($this->near, [31.5300, 74.3620])->assertUnprocessable()->assertJsonPath('meta.error_code', 'OUTSIDE_SERVICE_AREA');
    }

    public function test_switching_off_or_removing_the_last_zone_unfences_everything(): void
    {
        $zone = $this->circle();
        $this->as($this->admin)->putJson("/api/v1/admin/service-zones/{$zone['zone']['id']}", ['is_active' => false])->assertOk();
        $this->assertSame(['Far Away Foods', 'Gulberg Grill'], $this->listed());

        $this->as($this->admin)->putJson("/api/v1/admin/service-zones/{$zone['zone']['id']}", ['is_active' => true])->assertOk();
        $this->assertSame(['Gulberg Grill'], $this->listed());

        $this->as($this->admin)->deleteJson("/api/v1/admin/service-zones/{$zone['zone']['id']}")
            ->assertOk()->assertJsonPath('data.summary.online_shops_outside', 0);
        $this->assertSame(['Far Away Foods', 'Gulberg Grill'], $this->listed());
        // …and no shop is left MARKED outside a fence that is no longer
        // there: the console warned "outside every zone" with none drawn.
        $this->assertTrue($this->far->fresh()->in_service_zone);
    }

    public function test_only_staff_given_the_permission_draw_and_a_shape_must_be_a_shape(): void
    {
        $banners = User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();
        $this->as($banners)->getJson('/api/v1/admin/service-zones')->assertForbidden();

        $zones = User::factory()->adminStaff([Permissions::SERVICE_ZONES_MANAGE])->create();
        $this->as($zones)->getJson('/api/v1/admin/service-zones')->assertOk();

        $this->as($zones)->postJson('/api/v1/admin/service-zones', [
            'name' => 'Two corners', 'city_id' => $this->city->id, 'kind' => 'polygon', 'points' => [[31.5, 74.3], [31.6, 74.4]],
        ])->assertUnprocessable()->assertJsonValidationErrors('points');
        $this->as($zones)->postJson('/api/v1/admin/service-zones', [
            'name' => 'A dot', 'city_id' => $this->city->id, 'kind' => 'circle', 'center_lat' => 31.5, 'center_lng' => 74.3, 'radius_m' => 20,
        ])->assertUnprocessable()->assertJsonValidationErrors('radius_m');
        $this->assertSame(0, ServiceZone::query()->count());
    }

    public function test_a_circle_redrawn_as_a_polygon_keeps_no_half_of_the_circle(): void
    {
        $zone = $this->circle();
        $this->as($this->admin)->putJson("/api/v1/admin/service-zones/{$zone['zone']['id']}", [
            'kind' => 'polygon', 'points' => [[31.51, 74.35], [31.53, 74.35], [31.53, 74.37], [31.51, 74.37]],
        ])->assertOk();

        $row = ServiceZone::query()->findOrFail($zone['zone']['id']);
        $this->assertSame('polygon', $row->kind);
        $this->assertNull($row->radius_m);
        $this->assertNull($row->center_lat);
        $this->assertCount(4, $row->points);
    }

    /**
     * "PEHLE CITY CHOOSE KRY, USKA MAP SY GEO FENCE ADD KRY YA CIRCLE." A zone
     * is drawn for one city and fences that city only: Lahore's circle does not
     * hide a shop in Abbottabad, whose city has drawn nothing.
     */
    public function test_a_zone_fences_its_own_city_and_no_other(): void
    {
        $abbottabad = City::query()->create(['name' => 'Abbottabad', 'is_active' => true, 'latitude' => 34.1463, 'longitude' => 73.2117]);
        $hill = $this->shop('Hill Tea House', [34.1500, 73.2200], $abbottabad);

        $this->circle();

        // Lahore is fenced (Far Away Foods is outside Lahore's circle);
        // Abbottabad drew nothing, so its shop is listed.
        $this->assertSame(['Gulberg Grill', 'Hill Tea House'], $this->listed());
        $this->assertTrue($hill->fresh()->in_service_zone);

        // A delivery from the Abbottabad shop is not asked about Lahore's map…
        $this->order($hill, [34.1600, 73.2300])->assertCreated();
        // …and a Lahore shop still delivers only inside Lahore's zone.
        $this->order($this->near, self::OUTSIDE)->assertUnprocessable()->assertJsonPath('meta.error_code', 'OUTSIDE_SERVICE_AREA');

        // The customer's pin is asked of ITS city's zones.
        $this->getJson('/api/v1/marketplace/service-area?lat=34.16&lng=73.23&city_id='.$abbottabad->id)
            ->assertOk()->assertJsonPath('data.served', true)->assertJsonPath('data.zones_drawn', false);
        $this->getJson('/api/v1/marketplace/service-area?lat='.self::OUTSIDE[0].'&lng='.self::OUTSIDE[1].'&city_id='.$this->city->id)
            ->assertOk()->assertJsonPath('data.served', false)->assertJsonPath('data.zones_drawn', true);

        // Once Abbottabad draws its own zone away from the shop, the shop goes.
        $this->as($this->admin)->postJson('/api/v1/admin/service-zones', [
            'name' => 'Mall Road', 'city_id' => $abbottabad->id, 'kind' => 'circle',
            'center_lat' => 34.30, 'center_lng' => 73.40, 'radius_m' => 500,
        ])->assertCreated();
        $this->assertSame(['Gulberg Grill'], $this->listed());
    }

    public function test_a_new_zone_must_name_its_city_and_the_map_knows_each_shops_city(): void
    {
        $this->as($this->admin)->postJson('/api/v1/admin/service-zones', [
            'name' => 'Nowhere', 'kind' => 'circle', 'center_lat' => 31.5, 'center_lng' => 74.3, 'radius_m' => 800,
        ])->assertUnprocessable()->assertJsonValidationErrors('city_id');
        $this->assertSame(0, ServiceZone::query()->count());

        $shops = collect($this->as($this->admin)->getJson('/api/v1/admin/service-zones')->assertOk()->json('data.shops'));
        $this->assertSame([$this->city->id], $shops->pluck('city_id')->unique()->values()->all());
    }

    public function test_an_older_zone_without_a_city_still_fences_every_city(): void
    {
        $abbottabad = City::query()->create(['name' => 'Abbottabad', 'is_active' => true]);
        $this->shop('Hill Tea House', [34.1500, 73.2200], $abbottabad);

        ServiceZone::query()->create([
            'name' => 'Old Gulberg', 'kind' => 'circle', 'center_lat' => self::CENTRE[0], 'center_lng' => self::CENTRE[1],
            'radius_m' => 800, 'is_active' => true,
        ]);
        \App\Support\ServiceZones::changed();

        $this->assertSame(['Gulberg Grill'], $this->listed());
    }
}
