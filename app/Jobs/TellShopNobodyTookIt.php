<?php

namespace App\Jobs;

use App\Enums\FulfillmentType;
use App\Models\Order;
use App\Services\NotificationService;
use App\Services\RiderService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * NOBODY CAME. TELL THE SHOP.
 *
 * ── Why this is not a failure path ───────────────────────────────────
 *
 * Three minutes with no rider is not a broken system, it is a busy evening.
 * What makes it a problem is silence: a shop that finds out at three minutes
 * can ring its own rider, put it in a cousin's hands, or call the customer and
 * say it will be twenty minutes. A shop that finds out when the customer
 * complains has already lost that customer, and the app looked fine the whole
 * time.
 *
 * ── Why its own job, rather than the tail of the widening chain ──────
 *
 * The widening chain can end early and legitimately — a shop whose ceiling is
 * below the next stage stops widening because there is nowhere further to
 * look, not because it has given up. Hanging the give-up notice off the end of
 * that chain would fire it at ninety seconds for a food shop and at three
 * minutes for a tyre shop, which is the clock measuring the wrong thing.
 *
 * So it is dispatched once, at the start, with its own timer. It runs whatever
 * the chain did.
 */
class TellShopNobodyTookIt implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public function __construct(public readonly string $orderId) {}

    public function handle(NotificationService $notifications): void
    {
        /** @var Order|null $order */
        $order = Order::withoutTenancy()->find($this->orderId);

        // Somebody took it, the shop cancelled it, or the offer was closed.
        // All three mean this notice would be about something that is no
        // longer true, and a false alarm costs more than the notice is worth.
        if ($order === null
            || $order->fulfillment_type !== FulfillmentType::Delivery
            || ! $order->status->isOpen()
            || $order->rider_accepted_at !== null
            || $order->offer_radius_km === null) {
            return;
        }

        $minutes = (int) round(RiderService::OFFER_GIVE_UP_SECONDS / 60);

        $notifications->notifyWhoCanAct(
            $order->tenant_id,
            'orders.manage',
            'order.no_rider',
            'No rider yet',
            "Order {$order->order_number} has been waiting {$minutes} minutes with no rider. "
                .'It is still on offer — assign one of your own if you have somebody free.',
            ['order_id' => $order->id],
            // Keyed on the ORDER, not on the clock: this job runs once, and a
            // second copy of the same warning is a shop learning to ignore it.
            "order.no_rider-{$order->id}",
        );
    }
}
