<?php

namespace App\Console\Commands;

use App\Support\GeoImport;
use Illuminate\Console\Command;

/**
 * Countries, provinces and cities from database/data/geo/<ISO2>.json.
 * Safe to run again: nothing doubles, and nothing a person set is undone.
 */
class ImportGeo extends Command
{
    protected $signature = 'shopos:geo {countries?* : ISO2 codes, e.g. PK — every file there is, when none is named}';

    protected $description = 'Import countries, provinces and cities (with their coordinates) from database/data/geo';

    public function handle(): int
    {
        $codes = $this->argument('countries') ?: GeoImport::available();

        foreach ($codes as $code) {
            $t = GeoImport::country((string) $code);
            $this->info(strtoupper((string) $code).": {$t['provinces']} provinces, {$t['cities']} cities ({$t['added']} added, {$t['joined']} already here)");
        }

        return self::SUCCESS;
    }
}
