<?php

namespace App\Support;

/**
 * Great-circle distance helpers. Haversine is exact enough for delivery
 * radii (< 0.5% error) and runs fine as a SQL expression on a few thousand
 * rows — swap for a spatial index only if shop counts demand it.
 */
class Geo
{
    public const EARTH_RADIUS_KM = 6371.0;

    public static function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2
            + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return round(self::EARTH_RADIUS_KM * 2 * atan2(sqrt($a), sqrt(1 - $a)), 2);
    }

    /**
     * SQL Haversine over a table's latitude/longitude columns — bindings-safe
     * (lat/lng are cast to float before interpolation).
     */
    public static function sqlDistanceKm(float $lat, float $lng, string $latColumn = 'latitude', string $lngColumn = 'longitude'): string
    {
        $lat = (float) $lat;
        $lng = (float) $lng;
        $r = self::EARTH_RADIUS_KM;

        return "({$r} * 2 * ASIN(SQRT("
            ."POWER(SIN(RADIANS(({$latColumn} - {$lat}) / 2)), 2) + "
            ."COS(RADIANS({$lat})) * COS(RADIANS({$latColumn})) * "
            ."POWER(SIN(RADIANS(({$lngColumn} - {$lng}) / 2)), 2)"
            .')))';
    }
}
