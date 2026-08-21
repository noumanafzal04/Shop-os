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
            // `stock.` is a FAMILY, and this used to be one exact-equality test
            // against one member of it. The two expiry alerts —
            // `stock.expiry.approaching` and `stock.expiry.expired` — matched
            // nothing here and shipped with `data.link` null, so the push a
            // chemist gets about an expired lot opened the app to wherever it
            // already was.
            //
            // What makes it worth spelling out: NotifyExpiringStock's own
            // docblock already stated the destination — "Links to Disposals,
            // which knows the difference between binned and returned-to-
            // supplier." The requirement was written down, in the file that
            // raises the alert, and never implemented. That is the third time
            // this month a comment has been found standing in for the code, and
            // a comment reads as done, which is worse than nothing written at
            // all.
            //
            // Approaching goes to Disposals too: the decision it asks for —
            // sell it down, or agree a return — is the same screen's business,
            // and Disposals is where a return to the supplier is recorded.
            str_starts_with($type, 'stock.expiry.') => 'disposals',
            str_starts_with($type, 'subscription.') => 'subscription',
            $type === 'announcement' && isset($data['announcement_id']) => "announcements/{$data['announcement_id']}",
            default => null,
        };
    }
}
