<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Country;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SHOP KEEPS THE CLOCK OF ITS CITY.
 *
 * Every shop was born on Asia/Karachi, the column's default, wherever it was:
 * a shop in Dubai turned its day and read its offers an hour wrong, and no
 * screen could change it. Now a new shop takes the clock of its city, and the
 * owner may choose another until the business has traded — after that the
 * clock is fixed, like the currency, because moving it would move sales from
 * one counted day into another.
 */
class AShopKeepsTheClockOfItsCityTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function city(int $countryId, string $iso2, string $name, ?float $lat = null, ?float $lng = null): City
    {
        Country::query()->firstOrCreate(['id' => $countryId], ['name' => $iso2, 'iso2' => $iso2, 'is_active' => true]);

        return City::query()->create([
            'name' => $name, 'country_id' => $countryId, 'latitude' => $lat, 'longitude' => $lng, 'is_active' => true,
        ]);
    }

    private function created(?City $city): Tenant
    {
        $id = $this->as($this->admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Clock Test '.uniqid(),
            'business_type' => 'mart',
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'city_id' => $city?->id,
            'owner' => ['name' => 'Owner', 'email' => uniqid().'@test.com', 'password' => 'password123'],
        ])->assertCreated()->json('data.id');

        return Tenant::query()->findOrFail($id);
    }

    public function test_a_new_shop_keeps_the_clock_of_its_city(): void
    {
        $this->assertSame('Asia/Karachi', $this->created($this->city(167, 'PK', 'Lahore', 31.5204, 74.3587))->timezone);
        $this->assertSame('Asia/Dubai', $this->created($this->city(229, 'AE', 'Dubai', 25.2048, 55.2708))->timezone);
        // A country with several clocks: the one nearest the city.
        $this->assertSame('America/Chicago', $this->created($this->city(233, 'US', 'Houston', 29.7604, -95.3698))->timezone);
        $this->assertSame('America/Los_Angeles', $this->created($this->city(233, 'US', 'San Diego', 32.7157, -117.1611))->timezone);
        // No city: the product's default, exactly as before.
        $this->assertSame('Asia/Karachi', $this->created(null)->timezone);
    }

    private function shop(): array
    {
        $shop = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'Asia/Karachi',
            'city_id' => $this->city(229, 'AE', 'Dubai', 25.2048, 55.2708)->id,
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    public function test_the_owner_chooses_the_clock_until_the_business_trades(): void
    {
        [$shop, $owner] = $this->shop();

        $said = $this->as($owner)->getJson('/api/v1/shop/timezones')->assertOk()->json('data');
        $this->assertSame('Asia/Karachi', $said['current']);
        $this->assertFalse($said['locked']);
        $this->assertSame(['Asia/Dubai'], $said['suggested'], "the shop's own country first");
        $this->assertContains('(UTC+04:00) Asia/Dubai', array_column($said['options'], 'label'));

        $this->as($owner)->putJson('/api/v1/shop', ['timezone' => 'Asia/Dubai'])->assertOk();
        $this->assertSame('Asia/Dubai', $shop->fresh()->timezone);

        // A name the server does not keep is refused.
        $this->as($owner)->putJson('/api/v1/shop', ['timezone' => 'Mars/Olympus'])->assertUnprocessable();
    }

    public function test_setup_takes_the_clock_chosen_or_follows_the_city_confirmed(): void
    {
        [$shop, $owner] = $this->shop(); // made in Dubai, still on Karachi's clock
        $lahore = $this->city(167, 'PK', 'Lahore', 31.5204, 74.3587);
        $shop->forceFill(['setup_completed' => false])->save();

        // The owner confirms Lahore and chooses no clock: it follows Lahore.
        $this->as($owner)->putJson('/api/v1/shop/setup', ['city_id' => $lahore->id])->assertOk();
        $this->assertSame('Asia/Karachi', $shop->fresh()->timezone);

        // Back to Dubai at setup: Dubai's clock.
        $dubai = City::query()->where('name', 'Dubai')->firstOrFail();
        $shop->forceFill(['setup_completed' => false])->save();
        $this->as($owner)->putJson('/api/v1/shop/setup', ['city_id' => $dubai->id])->assertOk();
        $this->assertSame('Asia/Dubai', $shop->fresh()->timezone);

        // A clock chosen on the steps wins over the city's.
        $shop->forceFill(['setup_completed' => false])->save();
        $this->as($owner)->putJson('/api/v1/shop/setup', ['city_id' => $lahore->id, 'timezone' => 'Asia/Dubai'])->assertOk();
        $this->assertSame('Asia/Dubai', $shop->fresh()->timezone);

        // The setup steps also carry the receipt's phone and the delivery
        // charge; what is not sent keeps what the shop had.
        $shop->forceFill(['setup_completed' => false, 'delivery_fee' => 80])->save();
        $this->as($owner)->putJson('/api/v1/shop/setup', ['city_id' => $lahore->id, 'phone' => '042 3577 0000'])->assertOk();
        $this->assertSame('042 3577 0000', $shop->fresh()->phone);
        $this->assertEquals(80, (float) $shop->fresh()->delivery_fee);
        $shop->forceFill(['setup_completed' => false])->save();
        $this->as($owner)->putJson('/api/v1/shop/setup', ['city_id' => $lahore->id, 'delivery_fee' => 150])->assertOk();
        $this->assertEquals(150, (float) $shop->fresh()->delivery_fee);
        $this->assertSame('042 3577 0000', $shop->fresh()->phone);
    }

    public function test_once_it_has_traded_the_clock_is_fixed_and_says_why(): void
    {
        [$shop, $owner] = $this->shop();
        $soap = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Soap', 'price' => 100, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
        $this->as($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $soap->id, 'quantity' => 1]],
        ])->assertCreated();
        $this->assertSame(1, Sale::withoutTenancy()->where('tenant_id', $shop->id)->count());

        $said = $this->as($owner)->getJson('/api/v1/shop/timezones')->assertOk()->json('data');
        $this->assertTrue($said['locked']);
        $this->assertStringContainsString('fixed once trading has begun', $said['why']);

        $this->as($owner)->putJson('/api/v1/shop', ['timezone' => 'Asia/Dubai'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TIMEZONE_LOCKED');
        $this->assertSame('Asia/Karachi', $shop->fresh()->timezone);

        // The settings screen saves all it holds: the same clock sent again is no change.
        $this->as($owner)->putJson('/api/v1/shop', ['timezone' => 'Asia/Karachi', 'phone' => '0300 1234567'])->assertOk();
    }
}
