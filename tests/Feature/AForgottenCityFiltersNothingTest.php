<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * A CITY THE APP REMEMBERS BUT THE PLATFORM NO LONGER HAS FILTERS NOTHING.
 *
 * A phone kept the id of a Lahore row that had since been re-seeded; every
 * marketplace call filtered by it, and Home said "No shops around here yet"
 * in the middle of Gulberg.
 */
class AForgottenCityFiltersNothingTest extends TestCase
{
    use RefreshDatabase;

    private const HERE = ['lat' => 31.5204, 'lng' => 74.3587];

    private City $lahore;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Cache::flush();
        $this->lahore = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.5204, 'longitude' => 74.3587]);
        $karachi = City::query()->create(['name' => 'Karachi', 'is_active' => true]);

        $this->shop('Gulberg Grill', $this->lahore, 0.001);
        $this->shop('Clifton Cafe', $karachi, 0.002);
    }

    private function shop(string $name, City $city, float $dLat): void
    {
        $features = BusinessTypes::defaultFeatures('food');
        $features['marketplace'] = true;
        Tenant::factory()->create([
            'business_name' => $name, 'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'food', 'features' => $features, 'city_id' => $city->id,
            'latitude' => self::HERE['lat'] + $dLat, 'longitude' => self::HERE['lng'],
        ]);
    }

    /** @return list<string> */
    private function home(?string $cityId): array
    {
        return collect($this->getJson('/api/v1/marketplace/home?'.http_build_query(self::HERE + ($cityId ? ['city_id' => $cityId] : [])))
            ->assertOk()->json('data.nearby'))->pluck('business_name')->sort()->values()->all();
    }

    public function test_an_unknown_city_is_ignored_and_the_pin_decides(): void
    {
        $this->assertSame($this->home(null), $this->home((string) Str::uuid()));
        $this->assertContains('Gulberg Grill', $this->home((string) Str::uuid()));

        $shops = collect($this->getJson('/api/v1/marketplace/shops?'.http_build_query(self::HERE + ['city_id' => (string) Str::uuid()]))
            ->assertOk()->json('data'))->pluck('business_name')->all();
        $this->assertContains('Gulberg Grill', $shops);
    }

    public function test_a_switched_off_city_is_ignored_too_and_a_real_one_still_filters(): void
    {
        $this->assertSame(['Gulberg Grill'], $this->home($this->lahore->id), 'a real city still narrows');

        $this->lahore->update(['is_active' => false]);
        Cache::flush();
        $this->assertContains('Gulberg Grill', $this->home($this->lahore->id));
    }
}
