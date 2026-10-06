<?php

namespace App\Support;

use App\Models\Tenant;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * A moment, as the clock on the shop's wall reads it.
 *
 * ── What was printed ─────────────────────────────────────────────────
 *
 * A sale rung at 12:47 in the afternoon in Lahore printed a receipt that said
 * "07:47 AM". So did the quotation, the Z-read ("Opened 04:02") and the
 * kitchen ticket. Every one of them called `->format()` on a timestamp the
 * database holds in UTC, and the application's zone is UTC, so every paper
 * the shop handed over was five hours early.
 *
 * It is worse than cosmetic after midnight: a sale at two in the morning on
 * the 7th printed "06 Oct · 09:00 PM" — the wrong DAY, on the document a
 * customer brings back to return goods or claim a warranty.
 *
 * No test noticed, because every test that reads a receipt reads what is on
 * it and none reads when.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * Anything a PERSON reads with a clock time in it goes through here. Stored
 * and sent values stay in UTC, which is correct; only the paper is local.
 *
 * A calendar date with no time (a quotation's "valid until", a warranty's
 * last day) is NOT a moment and must not be moved: midnight UTC on the 13th
 * is still the 13th in Karachi, but is the 12th in New York, and a date that
 * changes with the reader is no longer the date that was promised.
 */
final class ShopTime
{
    /** The shop's own zone. Pakistan when it has not said, as the column defaults. */
    public static function zone(?Tenant $tenant = null): string
    {
        $tenant ??= app(TenantContext::class)->get();

        return $tenant?->timezone ?: 'Asia/Karachi';
    }

    /** Empty for a moment that never happened — a shift not yet closed has no closing time. */
    public static function show(?DateTimeInterface $moment, string $format, ?Tenant $tenant = null): string
    {
        if ($moment === null) {
            return '';
        }

        return Carbon::instance($moment)->setTimezone(self::zone($tenant))->format($format);
    }
}
