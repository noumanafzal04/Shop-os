<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The cities a shopper may choose.
 *
 * Street-level search needs a geocoding key and there is not one configured,
 * so without this endpoint the delivery-location screen's only control
 * returned nothing: a person whose GPS guessed the wrong city had no way to
 * correct it.
 */
class MarketplaceCitiesTest extends TestCase
{
    use RefreshDatabase;

    /** A shop the marketplace will actually show — see `scopeMarketplaceVisible`. */
    private function visibleShopIn(City $city): Tenant
    {
        return Tenant::factory()->create([
            'city_id' => $city->id,
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
    }

    private function city(array $attrs): City
    {
        return City::query()->create(['is_active' => true, ...$attrs]);
    }

    public function test_it_lists_only_cities_with_a_visible_shop(): void
    {
        $withShop = $this->city(['name' => 'Lahore']);
        $this->city(['name' => 'Quetta']);

        $this->visibleShopIn($withShop);

        $names = collect($this->getJson('/api/v1/marketplace/cities')->assertOk()->json('data'))
            ->pluck('name');

        // Offering a city with nothing in it is the same fault as a filter
        // rail counting from a hardcoded list.
        $this->assertTrue($names->contains('Lahore'));
        $this->assertFalse($names->contains('Quetta'), 'a city with no shop was offered');
    }

    public function test_it_narrows_by_name(): void
    {
        $lahore = $this->city(['name' => 'Lahore']);
        $karachi = $this->city(['name' => 'Karachi']);
        $this->visibleShopIn($lahore);
        $this->visibleShopIn($karachi);

        $names = collect($this->getJson('/api/v1/marketplace/cities?q=lah')->assertOk()->json('data'))
            ->pluck('name');

        $this->assertSame(['Lahore'], $names->all());
    }

    public function test_it_carries_the_coordinates_the_picker_needs(): void
    {
        $city = $this->city([
            'name' => 'Lahore',
            'latitude' => 31.5204,
            'longitude' => 74.3587,
        ]);
        $this->visibleShopIn($city);

        // A row with no pin cannot be chosen — the picker sets a lat/lng.
        $this->getJson('/api/v1/marketplace/cities')
            ->assertOk()
            ->assertJsonPath('data.0.latitude', 31.5204)
            ->assertJsonPath('data.0.longitude', 74.3587);
    }

    public function test_a_signed_out_visitor_can_read_it(): void
    {
        // The location picker opens before anybody signs in.
        $this->getJson('/api/v1/marketplace/cities')->assertOk();
    }
}
