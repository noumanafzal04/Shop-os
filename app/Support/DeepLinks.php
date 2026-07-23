<?php

namespace App\Support;

/**
 * Maps a notification type + data to a logical route string that BOTH the web
 * app and the mobile app resolve to their own screens (e.g. web owner →
 * /tenant/orders/{id}, mobile customer → order-tracking). Kept role-agnostic:
 * clients map the resource prefix to the right destination.
 *
 * The route rides along in the notification's `data.link`, so a push-tap can
 * deep-link straight to the relevant screen.
 */
class DeepLinks
{
    public static function routeFor(string $type, array $data): ?string
    {
        return match (true) {
            str_starts_with($type, 'order.') && isset($data['order_id']) => "orders/{$data['order_id']}",
            str_starts_with($type, 'reservation.') && isset($data['reservation_id']) => "reservations/{$data['reservation_id']}",
            str_starts_with($type, 'review.') => 'reviews',
            $type === 'stock.low' => 'inventory',
            str_starts_with($type, 'subscription.') => 'subscription',
            $type === 'announcement' && isset($data['announcement_id']) => "announcements/{$data['announcement_id']}",
            default => null,
        };
    }
}
