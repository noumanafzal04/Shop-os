<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\Sale;
use App\Models\Tenant;

/**
 * A SALE MAY BE UNDONE ONLY WHILE ITS OWN DAY IS STILL GOING.
 *
 * The owner (Q18, 2026-10-17): a sale rung in error is voided the same day or
 * not at all — after that the goods come back through Return / Refund. A day
 * that is over has been counted: its drawers were closed, its figures were
 * signed and banked. Voiding a sale in it would change a total somebody has
 * already put their name to, and would let yesterday's cash sale be "voided"
 * today with the notes going into a pocket.
 *
 * The day is over when, at the sale's place, either comes first:
 *  - the trading day has turned (the shop's own hour — ShopDay — and a day
 *    already closed off hands the small hours to the next one, exactly as
 *    BusinessDay::tradingDateAt decides for a sale arriving now);
 *  - the day the sale belongs to was closed off ("Close day"). Reopening the
 *    day reopens this.
 *
 * One rule, asked by the void itself and by the sale's sheet before it offers
 * the button, so the button is never a promise the server then refuses.
 */
final class StillItsDay
{
    /** Why this sale can no longer be undone — or null while its day is still going. */
    public static function overFor(Sale $sale, ?Tenant $tenant = null): ?string
    {
        $tenant ??= app(TenantContext::class)->get();
        // Sales written before places existed carry none, which is Main's.
        $place = $sale->branch_id ?? Branch::query()->where('is_default', true)->value('id');
        $soldAt = $sale->sold_at ?? $sale->created_at;

        $itsDay = BusinessDay::tradingDateAt($place, $soldAt, $tenant);
        if ($itsDay !== BusinessDay::tradingDateAt($place, now(), $tenant)) {
            return "{$sale->invoice_number} was rung on ".ShopTime::day($itsDay, $tenant)
                .' — that day is over. Take the goods back with Return / Refund.';
        }

        $closed = BusinessDay::query()
            ->where('status', BusinessDay::STATUS_CLOSED)
            ->where('branch_id', $place)
            ->whereDate('trading_date', $itsDay)
            ->exists();

        return $closed
            ? 'The day '.$sale->invoice_number.' belongs to has been closed off. Reopen the day, or take the goods back with Return / Refund.'
            : null;
    }

    /** Refuse the undoing of a sale whose day is over. */
    public static function refuseIfOver(Sale $sale, ?Tenant $tenant = null): void
    {
        $over = self::overFor($sale, $tenant);
        if ($over !== null) {
            throw DomainException::conflict($over, 'SALE_DAY_OVER');
        }
    }
}
