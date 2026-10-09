<?php

namespace Database\Seeders;

use App\Console\Commands\SeedDemoShops;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Artisan;

/**
 * The demo shops, as a step of `db:seed`.
 *
 * `php artisan migrate:fresh --seed` on a new server leaves a platform with
 * nothing in it to show anybody. This runs `demo:shops` at the end of the seed
 * so the nine logins are there from the first minute.
 *
 * It is safe wherever the seed is: the command needs no development package,
 * writes only its own shops, and leaves alone any that already exist — so a
 * second `db:seed` is not a reset of a shop somebody has been shown round.
 *
 * @see SeedDemoShops
 */
class DemoShopsSeeder extends Seeder
{
    public function run(): void
    {
        // Through the seed's own console where there is one, so the build is
        // watched as it happens; it takes a few minutes and says nothing else.
        if ($this->command !== null) {
            $this->command->call('demo:shops');

            return;
        }

        Artisan::call('demo:shops');
    }
}
