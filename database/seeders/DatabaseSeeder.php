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
        // ── What every server needs — and on a live box, ALL it gets ──────
        //
        //   CitySeeder + GeoSeeder   Pakistan: 7 provinces, 458 cities (the
        //                            same import as `php artisan shopos:geo PK`)
        //   PlanSeeder               Basic · Standard · Premium
        //   SuperAdminSeeder         the admins named in .env (config/platform.php)
        $this->call([
            CitySeeder::class,
            // Country → province → city, joining the eight above.
            GeoSeeder::class,
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
                // TEN SHOPS IN ONE CITY, so the customer app has content.
                //
                // `DemoDataSeeder` spreads its nine shops one per city, and the
                // marketplace fences by city AND by each shop's delivery
                // radius — so a tester standing in Lahore saw one shop and an
                // empty home screen. Correct behaviour on bad data; this is
                // the data. Runs before AppDemoSeeder so its shops get hours,
                // reviews and images like every other tenant.
                LahoreShopsSeeder::class,
                AppDemoSeeder::class,
                // `JoharTownSeeder` is DELIBERATELY not here.
                //
                // It writes KFC, McDonald's, Pizza Hut, Cheezious and Subway —
                // other people's trademarks — so that a demo looks like the
                // market it is aimed at. That is a reasonable thing to do on a
                // laptop and a decision about somebody else's brand on a public
                // marketplace, and a decision belongs to whoever runs the
                // platform rather than to a chain that runs on `migrate --seed`.
                //
                //     php artisan db:seed --class=JoharTownSeeder
                //
                // Every row it writes carries a `@johartown.demo` address so it
                // can be removed again in one line. See the class docblock.
            ]);
        } else {
            $this->command?->warn(
                'Skipped demo seeders on '.app()->environment().
                ' — set SEED_DEMO=true to force demo data.'
            );
        }

        // The nine shops that are handed to somebody for a walkthrough. Built
        // without Faker and off the public marketplace — but still made-up
        // shops with known logins, so a LIVE box gets none unless asked
        // (launch, 2026-11-01): `php artisan demo:shops` builds them on any
        // server, any time, when somebody is to be shown round.
        //
        // Not under test either: a suite that seeds the world would build nine
        // shops each time, and `DemoShopsCommandTest` builds them on purpose.
        if (! app()->environment(['testing', 'production']) || ($demoOptIn && ! app()->environment('testing'))) {
            $this->call(DemoShopsSeeder::class);
        }
    }
}
