<?php

namespace App\Support;

use App\Models\ServiceZone;
use App\Models\Tenant;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * IS THIS PIN SOMEWHERE THE PLATFORM SERVES?
 *
 * One answer for a shop's pin (may it trade online) and a delivery pin (may
 * an order go there). The zones are few and change rarely, so the active
 * ones are held in the cache and tested in PHP: a circle by great-circle
 * distance, a polygon by ray casting — at city scale a degree of latitude and
 * of longitude are near enough to straight lines.
 *
 * No active zone at all means nothing is fenced: the platform has not drawn
 * its map yet, and every pin is served.
 *
 * ── A zone fences ITS city (2026-11-20) ─────────────────────────────
 *
 * "Pehle city choose kry, uska map sy geo fence add kry ya circle." The admin
 * draws a city's zones after choosing the city, and they answer for that city
 * only: Lahore's zones do not hide Abbottabad's shops, and a city with no
 * zone of its own is not fenced. An older zone saved without a city fences
 * every city, as it always did; a pin whose city is unknown is asked of every
 * zone — the strict answer, as before cities were asked.
 */
final class ServiceZones
{
    private const CACHE_KEY = 'service_zones:active:v2';

    private const EARTH_RADIUS_M = 6_371_000.0;

    /** @return list<array{id: string, city_id: ?string, name: string, kind: string, lat: ?float, lng: ?float, radius: ?int, points: ?array}> */
    public static function active(): array
    {
        return Cache::remember(self::CACHE_KEY, 300, fn () => ServiceZone::query()->active()->get()
            ->map(fn (ServiceZone $z) => [
                'id' => $z->id,
                'city_id' => $z->city_id,
                'name' => $z->name,
                'kind' => $z->kind,
                'lat' => $z->center_lat,
                'lng' => $z->center_lng,
                'radius' => $z->radius_m,
                'points' => $z->points,
            ])->values()->all());
    }

    /**
     * The zones that answer for a city: its own and the city-less ones. With
     * no city known, every zone.
     *
     * @return list<array>
     */
    public static function forCity(?string $cityId): array
    {
        $all = self::active();
        if ($cityId === null) {
            return $all;
        }

        return array_values(array_filter($all, fn (array $z) => $z['city_id'] === null || $z['city_id'] === $cityId));
    }

    public static function anyActive(?string $cityId = null): bool
    {
        return self::forCity($cityId) !== [];
    }

    /** The zone that holds this pin, or null. With no zones drawn, null too — ask `serves()`. */
    public static function zoneAt(?float $lat, ?float $lng, ?string $cityId = null): ?array
    {
        if ($lat === null || $lng === null) {
            return null;
        }
        foreach (self::forCity($cityId) as $zone) {
            if (self::holds($zone, $lat, $lng)) {
                return $zone;
            }
        }

        return null;
    }

    /** Served: no zone drawn for this city, or a pin inside one of its zones. A missing pin is served only while nothing is drawn. */
    public static function serves(?float $lat, ?float $lng, ?string $cityId = null): bool
    {
        return ! self::anyActive($cityId) || self::zoneAt($lat, $lng, $cityId) !== null;
    }

    /** @param  array{kind: string, lat: ?float, lng: ?float, radius: ?int, points: ?array}  $zone */
    public static function holds(array $zone, float $lat, float $lng): bool
    {
        if ($zone['kind'] === ServiceZone::CIRCLE) {
            return $zone['lat'] !== null && $zone['lng'] !== null && $zone['radius'] !== null
                && self::metresBetween($lat, $lng, $zone['lat'], $zone['lng']) <= $zone['radius'];
        }

        return self::insidePolygon($lat, $lng, $zone['points'] ?? []);
    }

    public static function metresBetween(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return self::EARTH_RADIUS_M * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }

    /**
     * Ray casting: count the edges a ray east from the pin crosses. Odd is
     * inside. Works for any simple polygon, concave ones included.
     *
     * @param  list<array{0: float, 1: float}>  $points  [lat, lng] corners
     */
    public static function insidePolygon(float $lat, float $lng, array $points): bool
    {
        $n = count($points);
        if ($n < 3) {
            return false;
        }
        $inside = false;
        for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
            [$latI, $lngI] = [(float) $points[$i][0], (float) $points[$i][1]];
            [$latJ, $lngJ] = [(float) $points[$j][0], (float) $points[$j][1]];
            if ((($latI > $lat) !== ($latJ > $lat))
                && ($lng < ($lngJ - $lngI) * ($lat - $latI) / ($latJ - $latI) + $lngI)) {
                $inside = ! $inside;
            }
        }

        return $inside;
    }

    /**
     * A zone was drawn, moved or switched: every shop's answer is asked again.
     * The answer is "served" — with no active zone every shop is, so a map
     * wiped clean leaves no shop marked outside a fence that is not there.
     */
    public static function changed(): void
    {
        Cache::forget(self::CACHE_KEY);

        Tenant::query()->select(['id', 'city_id', 'latitude', 'longitude', 'in_service_zone'])->lazyById(500)
            ->each(function (Tenant $t): void {
                $in = self::serves(self::f($t->latitude), self::f($t->longitude), $t->city_id);
                if ($t->in_service_zone !== $in) {
                    DB::table('tenants')->where('id', $t->id)->update(['in_service_zone' => $in]);
                }
            });
    }

    /** One shop's answer, for its own pin and its own city's zones. */
    public static function shopInZone(Tenant $tenant): bool
    {
        return self::serves(self::f($tenant->latitude), self::f($tenant->longitude), $tenant->city_id);
    }

    private static function f(mixed $v): ?float
    {
        return $v === null || $v === '' ? null : (float) $v;
    }
}
