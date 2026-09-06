<?php

namespace App\Jobs;

use App\Enums\FulfillmentType;
use App\Models\Order;
use App\Services\RiderService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * LOOK FURTHER, once nobody nearby has taken it.
 *
 * ── What this is one link of ─────────────────────────────────────────
 *
 * `RiderService::beginOffering()` writes the first radius and offers it
 * synchronously — a rider three hundred metres away should hear about a job
 * before the queue worker has finished waking up. Everything after that is
 * this job, dispatched once per stage, each one dispatching the next.
 *
 * A chain rather than a loop with sleeps: the queue is `database`, and a
 * worker holding a job for ninety seconds is a worker doing nothing while the
 * other work backs up behind it.
 *
 * ── Why the stage is a parameter and the radius is not ───────────────
 *
 * The radius for a stage depends on the SHOP — food stops at five kilometres,
 * a tyre shop at twelve — and the shop is on the order. Passing a number
 * computed at dispatch time would freeze the answer at the moment the previous
 * stage ran, which is the sort of thing that survives a shop changing its
 * trade and starts quietly offering a fifty-kilometre delivery.
 *
 * ── Every reason to stop is checked HERE ─────────────────────────────
 *
 * A delayed job is a statement about the past. By the time it runs the order
 * may have been taken, cancelled, collected by the shop's own rider or closed
 * — so nothing is assumed from the fact that it was dispatched, and the
 * conditions are re-read rather than trusted.
 */
class WidenDeliveryOffer implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Once. A widening that fails is a widening that has already been
     * overtaken by the clock — retrying it three minutes later would offer a
     * job at three kilometres that should by then be open to the whole city,
     * and the give-up notice has its own job and its own timer.
     */
    public int $tries = 1;

    public function __construct(
        public readonly string $orderId,
        /** Index into `RiderService::OFFER_STAGES`. */
        public readonly int $stage,
    ) {}

    public function handle(RiderService $riders): void
    {
        $stages = RiderService::OFFER_STAGES;
        if (! isset($stages[$this->stage])) {
            return; // the chain ran off its own end; nothing left to widen to
        }

        /** @var Order|null $order */
        $order = Order::withoutTenancy()->with('tenant:id,business_type')->find($this->orderId);

        if (! $this->stillWorthOffering($order)) {
            return;
        }

        /** @var Order $order */
        $previous = (float) $order->offer_radius_km;

        // `null` in the table means "as far as this trade ever goes", which is
        // a question only the shop can answer.
        $target = $stages[$this->stage][1] ?? RiderService::maxRadiusFor($order->tenant);

        // Never inwards. A shop whose ceiling is BELOW a stage — food stops at
        // five, and the third stage is "open it up" — would otherwise have its
        // offer narrowed from six kilometres back to five, un-offering it to
        // riders who have already been told.
        if ($target <= $previous) {
            $this->queueNext($order);

            return;
        }

        $order->forceFill(['offer_radius_km' => $target])->save();
        $riders->offerToPool($order, $previous);

        $this->queueNext($order);
    }

    /**
     * The next stage, if the clock has one left.
     *
     * Delayed by the DIFFERENCE between the two stages' offsets, because the
     * offsets in `OFFER_STAGES` are measured from the moment the shop
     * accepted — chaining them at their face value would make ninety seconds
     * arrive at a hundred and twenty.
     */
    private function queueNext(Order $order): void
    {
        $stages = RiderService::OFFER_STAGES;
        $next = $this->stage + 1;
        if (! isset($stages[$next])) {
            return;
        }

        self::dispatch($order->id, $next)
            ->delay(now()->addSeconds($stages[$next][0] - $stages[$this->stage][0]));
    }

    /**
     * Is there still a delivery here for somebody to take?
     *
     * Six ways there is not, and the last one is the load-bearing one: a null
     * radius means the offer was CLOSED — somebody accepted it, or a shop
     * pulled it back — and re-widening a closed offer would put a job that is
     * already being carried back onto every board in the city.
     */
    private function stillWorthOffering(?Order $order): bool
    {
        return $order !== null
            && $order->fulfillment_type === FulfillmentType::Delivery
            && $order->status->isOpen()
            && $order->rider_accepted_at === null
            && $order->picked_up_at === null
            && $order->offer_radius_km !== null;
    }
}
