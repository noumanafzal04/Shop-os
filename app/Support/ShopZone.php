<?php

namespace App\Support;

use App\Models\City;
use App\Models\Country;
use DateTimeZone;

/**
 * WHICH CLOCK A SHOP KEEPS.
 *
 * Every shop was created on `Asia/Karachi`, the column's default, wherever it
 * was — a phone shop in Dubai turned its day an hour late and read its lunch
 * offers an hour wrong. No library is needed: PHP ships the IANA time-zone
 * database (DateTimeZone / Carbon) and the browser ships the same through
 * Intl, and both already work from `tenants.timezone`. What was missing is
 * setting it.
 *
 * So a new shop takes the clock of the city it is in — its country's zone,
 * or for a country that spans several (the US, Australia) the zone whose
 * city is nearest — and the owner can choose another until the business has
 * traded (see Tenant::mayKeepTimeIn).
 */
final class ShopZone
{
    public const FALLBACK = 'Asia/Karachi';

    /** The zone a shop in this city keeps, or null when nothing says. */
    public static function forCity(?City $city): ?string
    {
        if ($city === null || $city->country_id === null) {
            return null;
        }

        $iso2 = Country::query()->whereKey($city->country_id)->value('iso2');
        if (! is_string($iso2) || $iso2 === '') {
            return null;
        }

        $zones = DateTimeZone::listIdentifiers(DateTimeZone::PER_COUNTRY, strtoupper($iso2));
        if ($zones === []) {
            return null;
        }
        if (count($zones) === 1 || $city->latitude === null || $city->longitude === null) {
            return $zones[0];
        }

        // Several clocks in one country: the one kept nearest this city.
        $nearest = null;
        $best = INF;
        foreach ($zones as $zone) {
            $at = (new DateTimeZone($zone))->getLocation();
            if ($at === false) {
                continue;
            }
            $km = Geo::distanceKm((float) $city->latitude, (float) $city->longitude, (float) $at['latitude'], (float) $at['longitude']);
            if ($km < $best) {
                $best = $km;
                $nearest = $zone;
            }
        }

        if ($nearest === null) {
            return $zones[0];
        }

        // The nearest REFERENCE city can be a small one — Houston's is Tell
        // City, Indiana. Same clock, but a name nobody in Houston knows: so
        // the country's principal zone with the same clock ("Central (most
        // areas)" → America/Chicago) is kept when there is one.
        foreach ($zones as $zone) {
            $at = (new DateTimeZone($zone))->getLocation();
            if ($at !== false && str_contains(strtolower((string) $at['comments']), 'most')
                && self::sameClock($zone, $nearest)) {
                return $zone;
            }
        }

        return $nearest;
    }

    /** Do two zones read the same in winter and in summer? */
    private static function sameClock(string $a, string $b): bool
    {
        $year = (int) gmdate('Y');
        foreach (["{$year}-01-15", "{$year}-07-15"] as $day) {
            $at = new \DateTimeImmutable($day, new DateTimeZone('UTC'));
            if ((new DateTimeZone($a))->getOffset($at) !== (new DateTimeZone($b))->getOffset($at)) {
                return false;
            }
        }

        return true;
    }

    /** The zones of the country this shop's city is in — offered first. */
    public static function ofCountryOf(?City $city): array
    {
        if ($city === null || $city->country_id === null) {
            return [];
        }
        $iso2 = Country::query()->whereKey($city->country_id)->value('iso2');

        return is_string($iso2) && $iso2 !== ''
            ? DateTimeZone::listIdentifiers(DateTimeZone::PER_COUNTRY, strtoupper($iso2))
            : [];
    }

    /**
     * Every zone a shop may keep, with what its clock reads against UTC now —
     * the list the server validates against (`timezone:all`), so the screen
     * can never offer a name the server refuses.
     *
     * @return list<array{id: string, label: string}>
     */
    public static function options(): array
    {
        $now = new \DateTimeImmutable('now', new DateTimeZone('UTC'));

        return array_map(function (string $zone) use ($now): array {
            $offset = (new DateTimeZone($zone))->getOffset($now);
            $sign = $offset < 0 ? '−' : '+';
            $offset = abs($offset);

            return [
                'id' => $zone,
                'label' => sprintf('(UTC%s%02d:%02d) %s', $sign, intdiv($offset, 3600), intdiv($offset % 3600, 60), str_replace('_', ' ', $zone)),
            ];
        }, DateTimeZone::listIdentifiers());
    }
}
