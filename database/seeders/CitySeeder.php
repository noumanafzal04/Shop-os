<?php

namespace Database\Seeders;

use App\Models\City;
use Illuminate\Database\Seeder;

class CitySeeder extends Seeder
{
    public function run(): void
    {
        // Managed by Super Admin; starter list — adjust to launch market.
        // Centre coordinates let the app resolve GPS → nearest city.
        $cities = [
            'Karachi' => [24.8607, 67.0011],
            'Lahore' => [31.5204, 74.3587],
            'Islamabad' => [33.6844, 73.0479],
            'Rawalpindi' => [33.5651, 73.0169],
            'Faisalabad' => [31.4504, 73.1350],
            'Multan' => [30.1575, 71.5249],
            'Peshawar' => [34.0151, 71.5249],
            'Quetta' => [30.1798, 66.9750],
        ];

        foreach ($cities as $name => [$lat, $lng]) {
            City::query()->updateOrCreate(
                ['name' => $name],
                ['latitude' => $lat, 'longitude' => $lng, 'is_active' => true],
            );
        }
    }
}
