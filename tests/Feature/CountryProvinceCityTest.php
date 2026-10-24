<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Country;
use App\Models\Province;
use App\Support\GeoImport;
use Database\Seeders\CitySeeder;
use Database\Seeders\GeoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * COUNTRY → PROVINCE → CITY.
 *
 * The app knew eight cities and nothing above them; a shop in Sialkot could
 * not say where it was. Pakistan now comes from the open
 * countries-states-cities dataset — 7 provinces, 458 cities, each with its
 * coordinates — under the dataset's own ids, so a country added later is the
 * same import with its code.
 *
 * What this file guards most is what the import must NOT do: double a city,
 * move a shop off the city it already had, or undo what a person set.
 */
class CountryProvinceCityTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    // ── The import ──────────────────────────────────────────────────

    public function test_pakistan_arrives_with_its_provinces_and_cities_under_the_datasets_ids(): void
    {
        $tally = GeoImport::country('PK');

        $this->assertSame(['provinces' => 7, 'cities' => 458, 'joined' => 0, 'added' => 458], $tally);
        $this->assertSame('Pakistan', Country::query()->findOrFail(167)->name);
        $this->assertSame('92', Country::query()->findOrFail(167)->phone_code);

        $lahore = City::query()->where('geo_id', 85572)->firstOrFail();
        $this->assertSame('Lahore', $lahore->name);
        $this->assertSame('Punjab', Province::query()->findOrFail($lahore->province_id)->name);
        $this->assertSame(167, $lahore->country_id);
        $this->assertNotNull($lahore->latitude);
        $this->assertNotNull($lahore->longitude);
    }

    public function test_the_launch_cities_keep_their_ids_so_no_shop_loses_its_city(): void
    {
        $this->seed(CitySeeder::class);
        $before = City::query()->pluck('id', 'name');

        $tally = GeoImport::country('PK');

        // The eight are joined, not doubled.
        $this->assertSame(8, $tally['joined']);
        $this->assertSame(458, City::query()->count());
        foreach ($before as $name => $id) {
            $this->assertSame(1, City::query()->where('name', $name)->count(), "{$name} appears twice");
            $this->assertSame($id, City::query()->where('name', $name)->value('id'), "{$name} changed its id");
        }
        $this->assertSame(85572, City::query()->find($before['Lahore'])->geo_id);
    }

    public function test_running_it_again_doubles_nothing(): void
    {
        GeoImport::country('PK');
        $tally = GeoImport::country('PK');

        $this->assertSame(0, $tally['added']);
        $this->assertSame(458, City::query()->count());
        $this->assertSame(7, Province::query()->count());
        $this->assertSame(1, Country::query()->count());
    }

    public function test_what_a_person_set_is_not_undone(): void
    {
        // A coordinate somebody entered, and a city switched off.
        $this->seed(CitySeeder::class);
        City::query()->where('name', 'Quetta')->update(['is_active' => false]);
        GeoImport::country('PK');

        $this->assertSame(31.5204, City::query()->where('name', 'Lahore')->value('latitude'));
        $this->assertFalse((bool) City::query()->where('name', 'Quetta')->value('is_active'));
    }

    public function test_a_name_is_unique_in_its_province_not_across_the_country(): void
    {
        GeoImport::country('PK');

        // Two real places: one in Sindh, one in Balochistan.
        $this->assertEqualsCanonicalizing(
            ['Sindh', 'Balochistan'],
            Province::query()->whereIn('id', City::query()->where('name', 'Nasirabad')->pluck('province_id'))->pluck('name')->all(),
        );
    }

    public function test_names_are_written_in_plain_letters(): void
    {
        GeoImport::country('PK');

        // "Muzaffarābād" in the dataset; a counter types plain letters.
        $this->assertTrue(City::query()->where('name', 'Muzaffarabad')->exists());
        $this->assertTrue(City::query()->where('name', "Khairpur Mir's")->exists());
        $this->assertSame(0, City::query()->get()->filter(fn (City $c): bool => ! mb_check_encoding($c->name, 'ASCII'))->count());
    }

    public function test_the_command_imports_every_country_there_is_a_file_for_and_refuses_one_there_is_not(): void
    {
        $this->artisan('shopos:geo')->assertSuccessful();
        $this->assertSame(458, City::query()->count());

        $this->expectException(\RuntimeException::class);
        $this->artisan('shopos:geo', ['countries' => ['ZZ']]);
    }

    public function test_the_production_seed_carries_it(): void
    {
        $this->seed([CitySeeder::class, GeoSeeder::class]);

        $this->assertSame(458, City::query()->count());
    }

    // ── The lookups ─────────────────────────────────────────────────

    public function test_the_countries_and_provinces_a_picker_asks_for(): void
    {
        GeoImport::country('PK');

        $this->getJson('/api/v1/countries')->assertOk()
            ->assertJsonPath('data.0.id', 167)
            ->assertJsonPath('data.0.iso2', 'PK')
            ->assertJsonPath('data.0.phone_code', '92');

        $provinces = $this->getJson('/api/v1/provinces?country_id=167')->assertOk()->json('data');
        $this->assertCount(7, $provinces);
        $this->assertContains('Punjab', array_column($provinces, 'name'));
    }

    public function test_a_provinces_cities_with_their_coordinates(): void
    {
        GeoImport::country('PK');

        $cities = $this->getJson('/api/v1/cities?province_id=3176')->assertOk()->json('data');

        $this->assertCount(207, $cities);
        $lahore = collect($cities)->firstWhere('name', 'Lahore');
        $this->assertSame(3176, $lahore['province_id']);
        $this->assertNotNull($lahore['latitude']);
        $this->assertSame(458, count($this->getJson('/api/v1/cities?country_id=167')->json('data')));
    }

    public function test_the_city_list_still_answers_as_it_always_did(): void
    {
        // Every active city, with an id and a name — what every screen read
        // before provinces existed.
        $this->seed(CitySeeder::class);
        City::query()->where('name', 'Quetta')->update(['is_active' => false]);

        $cities = $this->getJson('/api/v1/cities')->assertOk()->json('data');

        $this->assertCount(7, $cities);
        $this->assertArrayHasKey('id', $cities[0]);
        $this->assertArrayHasKey('name', $cities[0]);
    }

    public function test_the_browser_may_keep_them_for_a_day(): void
    {
        foreach (['/api/v1/cities', '/api/v1/countries', '/api/v1/provinces'] as $url) {
            $cache = (string) $this->getJson($url)->assertOk()->headers->get('Cache-Control');
            $this->assertStringContainsString('max-age=86400', $cache, $url);
            $this->assertStringContainsString('public', $cache, $url);
        }
    }

    public function test_a_switched_off_country_is_not_offered(): void
    {
        GeoImport::country('PK');
        Country::query()->whereKey(167)->update(['is_active' => false]);

        $this->assertSame([], $this->getJson('/api/v1/countries')->json('data'));
    }
}
