<?php

namespace Database\Seeders;

use App\Support\GeoImport;
use Illuminate\Database\Seeder;

/**
 * Every country there is a geo file for (today: Pakistan — 7 provinces, 458
 * cities). Runs after CitySeeder and joins its eight cities rather than
 * doubling them. Production bootstrap: reference data a live install needs.
 */
class GeoSeeder extends Seeder
{
    public function run(): void
    {
        foreach (GeoImport::available() as $code) {
            GeoImport::country($code);
        }
    }
}
