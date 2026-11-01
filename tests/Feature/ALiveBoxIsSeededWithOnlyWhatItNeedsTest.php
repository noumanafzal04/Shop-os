<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * THE LAUNCH SEED (2026-11-01).
 *
 * `php artisan db:seed --force` on a live box makes what the platform needs to
 * run and nothing made up: Pakistan's provinces and cities, the three plans,
 * and the super admins named in .env. No demo shop, no demo login, no account
 * with a password written in this public repository.
 */
class ALiveBoxIsSeededWithOnlyWhatItNeedsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_live_seed_makes_the_places_the_plans_and_the_named_admins_and_nothing_else(): void
    {
        $this->app['env'] = 'production';
        config(['platform.super_admins' => [
            ['name' => 'Owner One', 'email' => 'one@platform.test', 'password' => 'a-long-first-password'],
            ['name' => 'Platform Admin', 'email' => 'two@platform.test', 'password' => 'another-long-password'],
        ]]);

        (new DatabaseSeeder)->run();

        $this->assertGreaterThan(400, City::query()->count(), "Pakistan's cities");
        $this->assertSame(['Basic', 'Standard', 'Premium'], Plan::query()->where('is_active', true)->orderBy('price')->pluck('name')->all());
        $this->assertSame(0, Tenant::query()->count(), 'a live box was given shops nobody asked for');
        $this->assertSame(['one@platform.test', 'two@platform.test'], User::query()->orderBy('email')->pluck('email')->all());
    }

    public function test_seeding_a_live_box_twice_changes_nothing(): void
    {
        $this->app['env'] = 'production';
        config(['platform.super_admins' => [['name' => 'Owner One', 'email' => 'one@platform.test', 'password' => 'a-long-first-password']]]);

        (new DatabaseSeeder)->run();
        $counts = [City::query()->count(), Plan::query()->count(), User::query()->count()];
        (new DatabaseSeeder)->run();

        $this->assertSame($counts, [City::query()->count(), Plan::query()->count(), User::query()->count()]);
    }
}
