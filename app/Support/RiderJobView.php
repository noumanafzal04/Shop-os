<?php

namespace App\Support;

use App\Models\Order;
use App\Models\RiderProfile;
use App\Services\RiderService;

/**
 * WHAT A RIDER IS ALLOWED TO SEE, AND WHEN.
 *
 * Two shapes, and the difference between them is the point of the file.
 *
 *   offer()  before they have taken it. Where to collect, roughly where it is
 *            going, what it pays. NO customer name, NO phone, NO street
 *            address — a job board is readable by every online rider in the
 *            city, and a stranger's address is not a listing.
 *
 *   job()    after they have accepted it. Everything they need to knock on the
 *            door, because now they are going there.
 *
 * Both ALLOW-LIST. Neither is `$order->toArray()` minus a few keys, because
 * that shape leaks every column added after it was written — and this payload
 * carries a home address.
 */
class RiderJobView
{
    /** The public board: enough to decide, not enough to find anyone. */
    public static function offer(Order $o, ?RiderProfile $rider = null): array
    {
        return [
            'id' => $o->id,
            'order_number' => $o->order_number,
            'status' => $o->status,
            'shop' => [
                'name' => $o->tenant?->business_name,
                'branch' => $o->branch?->name,
                'address' => $o->branch?->address,
                // The branch that fills it, falling back to the shop — the
                // same point the pool measures reach against, from the same
                // function, so the map and the radius can never disagree.
                'latitude' => RiderService::pickupPoint($o)[0],
                'longitude' => RiderService::pickupPoint($o)[1],
            ],
            // Where it is going, to the nearest area — never the house.
            'drop_area' => self::area($o->delivery_address),
            'items_count' => $o->items_count ?? $o->items?->count(),
            'order_total' => (float) $o->total,
            'delivery_fee' => (float) $o->delivery_fee,
            'payment_method' => $o->payment_method,
            'cash_to_collect' => $o->payment_method === 'cod' ? (float) $o->total : 0.0,
            'pickup_distance_km' => self::km(
                $rider?->latitude, $rider?->longitude,
                RiderService::pickupPoint($o)[0], RiderService::pickupPoint($o)[1],
            ),
            'drop_distance_km' => self::km(
                RiderService::pickupPoint($o)[0], RiderService::pickupPoint($o)[1],
                $o->latitude, $o->longitude,
            ),
            'placed_at' => $o->placed_at?->toIso8601String(),
            'self_claimed' => (bool) $o->rider_self_claimed,
        ];
    }

    /** Theirs now: the door, the phone, the bag. */
    public static function job(Order $o, ?RiderProfile $rider = null): array
    {
        return self::offer($o, $rider) + [
            'customer_name' => $o->customer_name,
            'customer_phone' => $o->customer_phone,
            'delivery_address' => $o->delivery_address,
            'latitude' => $o->latitude !== null ? (float) $o->latitude : null,
            'longitude' => $o->longitude !== null ? (float) $o->longitude : null,
            'notes' => $o->notes,
            'shop_phone' => $o->branch?->phone ?? $o->tenant?->phone,
            'stage' => self::stage($o),
            'accepted_at' => $o->rider_accepted_at?->toIso8601String(),
            'picked_up_at' => $o->picked_up_at?->toIso8601String(),
            'delivered_at' => $o->delivered_at?->toIso8601String(),
            'items' => $o->items?->map(fn ($i) => [
                'product_name' => $i->product_name,
                'variant_name' => $i->variant_name,
                'unit_name' => $i->unit_name,
                'quantity' => (float) $i->quantity,
            ])->all() ?? [],
        ];
    }

    /**
     * The rider's own word for where they are in this job.
     *
     * Derived from the timestamps, never stored: a second status column is a
     * second thing that can be wrong, and it would be the one nobody updates.
     */
    public static function stage(Order $o): string
    {
        return match (true) {
            $o->delivered_at !== null => 'delivered',
            $o->picked_up_at !== null => 'on_the_way',
            $o->rider_accepted_at !== null => 'to_pickup',
            default => 'offered',
        };
    }

    /**
     * The tail of an address — "Johar Town, Lahore" out of a full one.
     *
     * Addresses in this app are free text a customer typed, so this takes the
     * last two comma-separated parts and nothing else. When there is only one
     * part it returns null rather than the whole line: a single-line address
     * IS the house, and half of it is still the house.
     */
    private static function area(?string $address): ?string
    {
        if (blank($address)) {
            return null;
        }
        $parts = array_values(array_filter(array_map('trim', explode(',', $address)), fn ($p) => $p !== ''));

        return count($parts) < 2 ? null : implode(', ', array_slice($parts, -2));
    }

    private static function km(mixed $lat1, mixed $lng1, mixed $lat2, mixed $lng2): ?float
    {
        if ($lat1 === null || $lng1 === null || $lat2 === null || $lng2 === null) {
            return null;
        }

        return Geo::distanceKm((float) $lat1, (float) $lng1, (float) $lat2, (float) $lng2);
    }
}
