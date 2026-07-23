<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $this->call([
            CitySeeder::class,
            PlanSeeder::class,
            SuperAdminSeeder::class,
            DemoTenantSeeder::class,
            DemoDataSeeder::class,
            AppDemoSeeder::class,
        ]);
    }
}
