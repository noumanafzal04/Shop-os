<?php

namespace App\Support;

use App\Models\Tenant;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * HOW FAR BACK A SHOP CAN LOOK.
 *
 * A plan sells a window: two years of history on the cheap one, five on the
 * next, forever on the top. Until now the number was recorded on the plan,
 * printed on two screens, and enforced by nothing — every shop could read
 * every row it had ever written.
 *
 * ── Archived is not deleted, and the difference is the whole design ─────
 *
 * Nothing here deletes anything. A row outside the window is ARCHIVED: still
 * in the database, still correct, still counted by anything that must count
 * it — and simply not returned to a list that is paging through history.
 * Three consequences follow, and all three are deliberate:
 *
 *   IT COMES BACK      Upgrade the plan and last year reappears, because the
 *                      rows never went anywhere. A retention window that
 *                      destroyed data would make an upgrade useless and a
 *                      downgrade unforgivable.
 *
 *   IT IS NEVER SILENT Every fenced read says what it fenced. A shopkeeper
 *                      who opens Sales and cannot find last March must be
 *                      told "your plan keeps 24 months" — otherwise the only
 *                      reading available to them is that the records are
 *                      LOST, which is a support call and a refund, not an
 *                      upsell.
 *
 *   IT NEVER TOUCHES A LIVE FIGURE
 *                      Stock on hand, a customer's outstanding khata, a
 *                      supplier's balance — these are the SUM of history, and
 *                      a balance that silently drops the first two years is
 *                      not a smaller answer, it is a WRONG one. Only
 *                      historical LISTS and REPORTS are fenced; no balance,
 *                      no stock level, no ledger total is.
 *
 * ── Why the window is measured from the plan, not the subscription ──────
 *
 * It is a property of what the shop pays for today, so an upgrade takes
 * effect the moment it is saved. `retention_months` null = forever, which is
 * also what a shop with no plan at all gets: an unprovisioned or test tenant
 * is never fenced.
 */
final class Retention
{
    /** The tenant of this request, when a caller has not got one to hand. */
    public static function current(): ?Tenant
    {
        return app(TenantContext::class)->get();
    }

    /** Months of history this shop's plan keeps online. Null = forever. */
    public static function months(?Tenant $tenant): ?int
    {
        $months = $tenant?->plan?->retention_months;

        return $months === null ? null : max(1, (int) $months);
    }

    /**
     * The earliest day still online, or null when nothing is fenced.
     *
     * `subMonthsNoOverflow` for the reason every other date in this codebase
     * uses it: 31 March minus one month is 28 February, not 3 March. On a
     * horizon the overflow would move the boundary FORWARD and hide two days
     * that the plan paid for.
     */
    public static function horizon(?Tenant $tenant): ?CarbonImmutable
    {
        $months = self::months($tenant);

        return $months === null
            ? null
            : CarbonImmutable::today()->subMonthsNoOverflow($months)->startOfDay();
    }

    /**
     * Fence a history query at the horizon.
     *
     * @param  Builder<covariant \Illuminate\Database\Eloquent\Model>  $query
     * @return Builder<covariant \Illuminate\Database\Eloquent\Model>
     */
    public static function fence(Builder $query, string $column, ?Tenant $tenant = null): Builder
    {
        $horizon = self::horizon($tenant ?? self::current());

        return $horizon === null ? $query : $query->where($column, '>=', $horizon);
    }

    /**
     * The earliest date a read may ask for — the asked-for date, or the
     * horizon when it reaches past it.
     */
    public static function clamp(?string $from, ?Tenant $tenant = null): ?string
    {
        $horizon = self::horizon($tenant ?? self::current());

        if ($horizon === null) {
            return $from;
        }

        if ($from === null) {
            return $horizon->toDateString();
        }

        return CarbonImmutable::parse($from)->startOfDay()->lessThan($horizon)
            ? $horizon->toDateString()
            : $from;
    }

    /**
     * WHAT TO SAY ON THE SCREEN.
     *
     * Returned on every fenced read, and never null when a window exists —
     * including when the request stayed inside it. A notice that only appears
     * once you have already hit the wall teaches the shopkeeper nothing; one
     * that is always there is a fact about their plan.
     *
     * `reached` is the part that changes: it is true when this particular
     * read wanted rows older than the window, which is the moment the screen
     * should speak up rather than whisper.
     *
     * @return array{months: int, from: string, reached: bool, asked_from: string|null}|null
     */
    public static function notice(?string $askedFrom = null, ?Tenant $tenant = null): ?array
    {
        $tenant ??= self::current();
        $months = self::months($tenant);
        $horizon = self::horizon($tenant);

        if ($months === null || $horizon === null) {
            return null;
        }

        return [
            'months' => $months,
            'from' => $horizon->toDateString(),
            'reached' => $askedFrom !== null
                && CarbonImmutable::parse($askedFrom)->startOfDay()->lessThan($horizon),
            'asked_from' => $askedFrom,
        ];
    }
}
