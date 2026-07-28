<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * Two clearly separated tiers:
     *  - PRODUCTION bootstrap (always runs): the reference + login data a live
     *    install genuinely needs — cities, the starter plans and the Super
     *    Admin account. Safe to run on prod with `migrate --seed`.
     *  - DEMO fixtures (local/dev only): the "Demo Mart" tenant and its fake
     *    catalog/sales. Gated on the environment so a production seed can NEVER
     *    inject a demo tenant into a live database. Force with `--force-demo`
     *    (or SEED_DEMO=true) if you deliberately want demo data elsewhere.
     */
    public function run(): void
    {
        // ── Production bootstrap ─────────────────────────────────────────
        $this->call([
            CitySeeder::class,
            PlanSeeder::class,
            SuperAdminSeeder::class,
        ]);

        // ── Demo fixtures (never on production) ──────────────────────────
        $demoOptIn = (bool) env('SEED_DEMO', false)
            || in_array('--force-demo', $_SERVER['argv'] ?? [], true);

        if (app()->environment(['local', 'testing']) || $demoOptIn) {
            $this->call([
                DemoTenantSeeder::class,
                DemoDataSeeder::class,
                AppDemoSeeder::class,
            ]);
        } else {
            $this->command?->warn(
                'Skipped demo seeders on '.app()->environment().
                ' — set SEED_DEMO=true to force demo data.'
            );
        }
    }
}
