<?php

namespace Tests\Feature;

use App\Actions\Demo\CreateDemoShopAction;
use App\Models\City;
use App\Models\Tenant;
use Database\Seeders\CitySeeder;
use Database\Seeders\DemoDataSeeder;
use Database\Seeders\DemoTenantSeeder;
use Database\Seeders\GeoSeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * With 458 cities on file, demo shops still open in the launch cities — not
 * in whichever towns sort first, where the marketplace would show nothing.
 */
class DemoShopsStayInLaunchCitiesTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_demo_world_is_spread_over_the_launch_cities_only(): void
    {
        $this->seed([CitySeeder::class, GeoSeeder::class, PlanSeeder::class, DemoTenantSeeder::class, DemoDataSeeder::class]);

        $where = Tenant::query()->whereNotNull('city_id')->with('city')->get()->pluck('city.name')->unique();

        $this->assertNotEmpty($where);
        $this->assertSame([], $where->diff(City::MAJOR)->values()->all());
    }

    public function test_a_demo_shop_opens_in_a_launch_city(): void
    {
        // A town on file before any launch city — the first row a bare
        // "any active city" would hand back.
        City::query()->create(['name' => 'Aabpara Town', 'is_active' => true]);
        $this->seed([CitySeeder::class, GeoSeeder::class, PlanSeeder::class]);

        $made = app(CreateDemoShopAction::class)->execute('retail');

        $this->assertContains($made['tenant']->city?->name, City::MAJOR);
    }
}
