<?php

namespace App\Console\Commands;

use App\Support\UnitsBackOnTheShelf;
use Illuminate\Console\Command;

/**
 * Mend numbered units that came back before the returns desk said which.
 *
 * Run once by its migration on deploy. Kept as a command because it is safe
 * to run again — it only moves a unit to where the sales say it is.
 */
class UnitsBackOnTheShelfCommand extends Command
{
    protected $signature = 'shopos:units-back-on-the-shelf';

    protected $description = 'Put back on the shelf numbered units that were refunded but still read as sold';

    public function handle(): int
    {
        $done = UnitsBackOnTheShelf::repair();
        $this->info("{$done['units_back']} unit(s) marked as come back; {$done['back_on_shelf']} back on the shelf.");

        return self::SUCCESS;
    }
}
