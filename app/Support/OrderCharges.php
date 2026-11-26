<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Tenant;

/**
 * WHAT AN ORDER COSTS BESIDES ITS GOODS — asked in one place.
 *
 * Placing an order and asking what it will come to (`worth`) both call this,
 * and the marketplace's shop card reads the same settings it reads, so the
 * screen, the quote and the order can never price a delivery three ways.
 *
 *   delivery_fee     the shop's flat fee, plus kilometres past the distance it
 *                    covers, plus the rush fee while the admin has it on;
 *                    free above the shop's threshold (the rush fee is not —
 *                    it is the rain, not the shop)
 *   small_order_fee  below the minimum: the difference, or a refusal
 *   service_fee      the platform's, on every online order
 *
 * A COUNTER order (the shop took it on the phone) is priced as it always was:
 * the flat fee (free above the shop's line) and nothing else. The shopkeeper
 * agreed the price out loud.
 */
final class OrderCharges
{
    /**
     * @return array{delivery_fee: float, distance_fee: float, rush_fee: float, small_order_fee: float, service_fee: float, minimum: ?float}
     */
    public static function for(Tenant $shop, float $subtotal, bool $delivery, bool $counter, ?float $distanceKm): array
    {
        $none = ['delivery_fee' => 0.0, 'distance_fee' => 0.0, 'rush_fee' => 0.0, 'small_order_fee' => 0.0, 'service_fee' => 0.0, 'minimum' => null];

        $freeAbove = $shop->setting('free_delivery_threshold');
        $earnedFree = $freeAbove !== null && $subtotal >= (float) $freeAbove;

        if ($counter) {
            return ['delivery_fee' => $delivery && ! $earnedFree ? round((float) $shop->delivery_fee, 2) : 0.0] + $none;
        }

        $service = round(max(0.0, (float) PlatformSettings::get('service_fee', 0)), 2);
        if (! $delivery) {
            return ['service_fee' => $service] + $none;
        }

        // ── Below the minimum ───────────────────────────────────────────
        $minimum = self::minimumFor($shop);
        $small = 0.0;
        if ($minimum !== null && $subtotal < $minimum) {
            if (self::belowMinimumFor($shop) === 'refuse') {
                throw DomainException::unprocessable(
                    'Minimum order for delivery is '.$shop->money($minimum)
                        .' — add '.$shop->money($minimum - $subtotal).' more, or collect it.',
                    'MIN_ORDER_AMOUNT',
                );
            }
            $small = round($minimum - $subtotal, 2);
        }

        // ── The delivery itself ─────────────────────────────────────────
        $flat = (float) $shop->delivery_fee;
        $distance = 0.0;
        $perKm = self::perKmFor($shop);
        if ($perKm !== null && $perKm > 0 && $distanceKm !== null) {
            $past = max(0.0, $distanceKm - self::baseKmFor($shop));
            // Every started kilometre — 3.2 km past is four, as a meter counts.
            $distance = round(ceil(round($past, 3)) * $perKm, 2);
        }

        if ($earnedFree) {
            $flat = 0.0; // earned free delivery
            $distance = 0.0;
        }

        $rush = (bool) PlatformSettings::get('rush_fee_on', false)
            ? round(max(0.0, (float) PlatformSettings::get('rush_fee', 0)), 2)
            : 0.0;

        return [
            'delivery_fee' => round($flat + $distance + $rush, 2),
            'distance_fee' => $distance,
            'rush_fee' => $rush,
            'small_order_fee' => $small,
            'service_fee' => $service,
            'minimum' => $minimum,
        ];
    }

    /** The least a delivery basket may be — the shop's own, else the platform's. Null = none. */
    public static function minimumFor(Tenant $shop): ?float
    {
        $own = $shop->setting('min_order_amount');
        if ($own !== null) {
            return (float) $own > 0 ? (float) $own : null;
        }
        $platform = PlatformSettings::get('default_min_order');

        return $platform !== null && (float) $platform > 0 ? (float) $platform : null;
    }

    /** `fee` or `refuse` — the shop's choice, else the platform's. */
    public static function belowMinimumFor(Tenant $shop): string
    {
        $own = $shop->setting('below_minimum');

        return in_array($own, ['fee', 'refuse'], true)
            ? $own
            : (PlatformSettings::get('below_minimum') === 'refuse' ? 'refuse' : 'fee');
    }

    public static function perKmFor(Tenant $shop): ?float
    {
        $own = $shop->setting('delivery_fee_per_km');
        if ($own !== null) {
            return (float) $own;
        }
        $platform = PlatformSettings::get('delivery_fee_per_km');

        return $platform !== null ? (float) $platform : null;
    }

    public static function baseKmFor(Tenant $shop): float
    {
        return (float) ($shop->setting('delivery_fee_base_km') ?? PlatformSettings::get('delivery_fee_base_km', 3) ?? 3);
    }

    /**
     * The rules a customer should read BEFORE ordering — for the shop page and
     * the checkout. The same numbers `for()` charges by.
     *
     * @return array{min_order_amount: ?float, below_minimum: string, delivery_fee_per_km: ?float, delivery_fee_base_km: float, service_fee: float, rush_fee: float}
     */
    public static function terms(Tenant $shop): array
    {
        $perKm = self::perKmFor($shop);

        return [
            'min_order_amount' => self::minimumFor($shop),
            'below_minimum' => self::belowMinimumFor($shop),
            'delivery_fee_per_km' => $perKm !== null && $perKm > 0 ? $perKm : null,
            'delivery_fee_base_km' => self::baseKmFor($shop),
            'service_fee' => round(max(0.0, (float) PlatformSettings::get('service_fee', 0)), 2),
            'rush_fee' => (bool) PlatformSettings::get('rush_fee_on', false)
                ? round(max(0.0, (float) PlatformSettings::get('rush_fee', 0)), 2)
                : 0.0,
        ];
    }
}
