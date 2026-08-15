<?php

namespace App\Services;

use App\Models\BankCardOffer;
use App\Support\OfferWindow;
use Illuminate\Support\Carbon;

/**
 * What a bank takes off, and off what.
 *
 * ── The number this produces belongs to somebody else ───────────────────
 *
 * A promotion is the shop spending its own margin to sell more. A bank card
 * offer is HBL spending HBL's money to get its card tapped, and reimbursing the
 * shop afterwards. The shop is a channel.
 *
 * That single fact decides every rule below, and it is why the figure is never
 * folded into `discount` or `promo_discount`. A shop that cannot separate the
 * three cannot invoice the bank for the third — and a discount you cannot claim
 * back is not a marketing win, it is a straight loss.
 *
 * ── It applies to the CARD SLICE, not the bill ──────────────────────────
 *
 * Rs 10,000 sale, settled Rs 3,000 cash and Rs 7,000 card. The bank is
 * discounting its own transaction, so it funds a share of 7,000. Applying it to
 * the whole bill would have the bank paying for the cash the customer handed
 * over — which the bank will notice at claim time, not before.
 *
 * ── It STACKS with a shop promotion, and the order matters ──────────────
 *
 * Both apply, because they are two people's money and neither should silently
 * eat the other. The order is: the shop prices the cart (its own discounts and
 * promotion), and the bank then discounts the card slice of what is left.
 *
 * The alternative — largest wins — is the wrong shape here. It would let a bank
 * campaign the shop is PAID for cancel a campaign the shop is paying for, or
 * the reverse, and neither party agreed to that.
 *
 * ── Everything about "is it running" is borrowed ────────────────────────
 *
 * Date range, weekday, time window: `OfferWindow`, the same code a promotion
 * uses. Nothing here restates it.
 */
class BankOfferService
{
    /**
     * The best live offer for this bank at this moment, or null.
     *
     * Best means the largest discount on the given card amount; a tie goes to
     * the higher `priority`. The 0.001 tolerance is the same one the promotion
     * engine uses, so two offers worth the same money to the paisa cannot be
     * ordered differently by the two engines because of a floating-point tail.
     *
     * @return array{offer: BankCardOffer, discount: float}|null
     */
    public function best(string $bankId, float $cardAmount, Carbon $now, ?string $cardType = null): ?array
    {
        $best = null;

        foreach (BankCardOffer::query()->live()->where('bank_id', $bankId)->get() as $offer) {
            if (! $this->liveNow($offer, $now)) {
                continue;
            }

            if (! $offer->coversCardType($cardType)) {
                continue;
            }

            $discount = $this->discountFor($offer, $cardAmount);
            if ($discount <= 0) {
                continue;
            }

            if ($best === null || $discount > $best['discount'] + 0.001) {
                $best = ['offer' => $offer, 'discount' => $discount];
            } elseif (abs($discount - $best['discount']) <= 0.001 && $offer->priority > $best['offer']->priority) {
                $best = ['offer' => $offer, 'discount' => $discount];
            }
        }

        return $best;
    }

    /** Is this offer running at $now? $now MUST be in the shop's timezone. */
    public function liveNow(BankCardOffer $offer, Carbon $now): bool
    {
        return OfferWindow::isLive(
            $now,
            $offer->starts_on,
            $offer->ends_on,
            $offer->days_of_week,
            $offer->start_time === null ? null : (string) $offer->start_time,
            $offer->end_time === null ? null : (string) $offer->end_time,
        );
    }

    /**
     * What this offer is worth on this card amount. Zero when it does not apply.
     *
     * `min_spend` is measured against the CARD amount, not the bill, for the
     * same reason the discount is: the bank's condition is about its own
     * transaction. A shop reading it the other way would promise "Rs 5,000 and
     * above" to a customer paying Rs 5,000 in cash and Rs 200 by card.
     */
    public function discountFor(BankCardOffer $offer, float $cardAmount): float
    {
        if ($cardAmount <= 0) {
            return 0.0;
        }

        if ($offer->min_spend !== null && $cardAmount < (float) $offer->min_spend) {
            return 0.0;
        }

        $discount = $offer->type === BankCardOffer::TYPE_PERCENT
            ? $cardAmount * ((float) $offer->value / 100)
            : (float) $offer->value;

        if ($offer->max_discount !== null) {
            $discount = min($discount, (float) $offer->max_discount);
        }

        // Never more than the card was going to pay. A fixed Rs 500 off on a
        // Rs 300 card slice would otherwise hand back money nobody tendered.
        return round(max(0.0, min($discount, $cardAmount)), 2);
    }
}
