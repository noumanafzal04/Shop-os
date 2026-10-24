<?php

namespace App\Support;

use App\Models\City;
use App\Models\Country;
use App\Models\Province;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * One country's provinces and cities, from `database/data/geo/<ISO2>.json`
 * (cut from the open countries-states-cities dataset by
 * scripts/geo-extract.py).
 *
 * ── Run it twice and nothing doubles ─────────────────────────────────────
 *
 * Countries and provinces are written by the dataset's own ids; a city is
 * found by its `geo_id`. A city that came before the dataset — the eight the
 * platform launched with, which shops already point at — is found by its
 * name and JOINED, keeping its UUID, so no shop loses its city and no city
 * appears twice.
 *
 * What a person set is left alone: a city switched off stays off, and a
 * coordinate somebody entered is not overwritten — the dataset only fills a
 * blank.
 */
final class GeoImport
{
    public static function path(string $iso2): string
    {
        return database_path('data/geo/'.strtoupper($iso2).'.json');
    }

    /** @return list<string> the countries there is a file for, e.g. ['PK'] */
    public static function available(): array
    {
        return collect(glob(database_path('data/geo/*.json')) ?: [])
            ->map(fn (string $file): string => strtoupper(pathinfo($file, PATHINFO_FILENAME)))
            ->sort()->values()->all();
    }

    /** @return array{provinces: int, cities: int, joined: int, added: int} */
    public static function country(string $iso2): array
    {
        $file = self::path($iso2);
        if (! is_file($file)) {
            throw new RuntimeException("No geo file for {$iso2} — run scripts/geo-extract.py first.");
        }

        $data = json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);

        return DB::transaction(function () use ($data): array {
            $c = $data['country'];
            Country::query()->updateOrCreate(['id' => $c['id']], [
                'name' => $c['name'], 'iso2' => $c['iso2'], 'iso3' => $c['iso3'] ?? null,
                'phone_code' => $c['phone_code'] ?? null, 'currency' => $c['currency'] ?? null,
                'latitude' => $c['latitude'] ?? null, 'longitude' => $c['longitude'] ?? null,
            ]);

            $tally = ['provinces' => 0, 'cities' => 0, 'joined' => 0, 'added' => 0];

            foreach ($data['provinces'] as $p) {
                Province::query()->updateOrCreate(['id' => $p['id']], [
                    'country_id' => $c['id'], 'name' => $p['name'], 'type' => $p['type'] ?? null,
                    'latitude' => $p['latitude'] ?? null, 'longitude' => $p['longitude'] ?? null,
                ]);
                $tally['provinces']++;

                foreach ($p['cities'] as $row) {
                    $tally['cities']++;
                    $tally[self::city($row, (int) $p['id'], (int) $c['id'])]++;
                }
            }

            return $tally;
        });
    }

    /**
     * @param  array{id: int, name: string, latitude: ?float, longitude: ?float}  $row
     * @return 'joined'|'added'
     */
    private static function city(array $row, int $provinceId, int $countryId): string
    {
        $city = City::query()->where('geo_id', $row['id'])->first()
            // A city made before the dataset, by its name.
            ?? City::query()->whereNull('geo_id')->whereRaw('LOWER(name) = ?', [mb_strtolower($row['name'])])->first();

        if ($city === null) {
            City::query()->create([
                'geo_id' => $row['id'], 'province_id' => $provinceId, 'country_id' => $countryId,
                'name' => $row['name'], 'latitude' => $row['latitude'], 'longitude' => $row['longitude'],
                'is_active' => true,
            ]);

            return 'added';
        }

        $city->forceFill([
            'geo_id' => $row['id'], 'province_id' => $provinceId, 'country_id' => $countryId,
            'latitude' => $city->latitude ?? $row['latitude'],
            'longitude' => $city->longitude ?? $row['longitude'],
        ])->save();

        return 'joined';
    }
}
