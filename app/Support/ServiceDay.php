<?php

namespace App\Support;

use App\Models\Tenant;
use Illuminate\Support\Carbon;

/**
 * WHEN TODAY'S SERVICE BEGAN.
 *
 * ── What was on the wall ─────────────────────────────────────────────
 *
 * The kitchen board showed every docket nobody had bumped, for as long as its
 * tab stayed open — and nothing closes a tab but a person. A takeaway rung at
 * the counter whose docket the cook never tapped, a table somebody forgot to
 * settle: each stayed on the pass the next morning, and the morning after, as
 * the top card of a queue that is worked from the top. A cook started the day
 * reading orders from last week.
 *
 * So the pass has a window, and this is where it opens.
 *
 * ── Why not midnight ─────────────────────────────────────────────────
 *
 * A restaurant's day does not turn at twelve. A karahi house is at full
 * stretch at one in the morning, and a board that wiped itself at midnight
 * would take the food off the pass while it was being cooked. In Ramzan the
 * busiest hour of the night is sehri.
 *
 * Two rules, and the EARLIER of them wins:
 *
 *   the day turns when the SHOP'S day turns (ShopDay) — five in the morning
 *   unless the shop has said otherwise, the hour that is after any night's
 *   last order and before any morning's first. It is the same turn the
 *   reports and the till's trading day use: the pass had an hour of its own
 *   once, and a board that called it tomorrow while the day's report still
 *   called it today was two answers to one question;
 *
 *   and nothing fired in the last six hours is ever "an earlier service",
 *   whatever the clock says. A kitchen serving sehri at ten to five does not
 *   lose its board at five.
 *
 * Read by the pass, the owner's dashboard and the floor, so the three cannot
 * disagree about what "left over from before" means.
 */
final class ServiceDay
{
    /** Younger than this is still tonight's work, whatever the clock says. */
    public const STILL_LIVE_HOURS = 6;

    public static function began(?Tenant $tenant = null): Carbon
    {
        $now = now();

        // When the shop's day turned — the same hour its reports turn at.
        $turned = ShopDay::startOf(ShopDay::today($tenant), $tenant);

        $recent = $now->copy()->subHours(self::STILL_LIVE_HOURS);

        return $turned->lessThan($recent) ? Carbon::instance($turned) : $recent->utc();
    }
}
