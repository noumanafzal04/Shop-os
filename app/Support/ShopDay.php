<?php

namespace App\Support;

use App\Models\Tenant;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Contracts\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * WHICH DAY A MOMENT BELONGS TO, FOR THIS SHOP.
 *
 * ── Two days, one shop ───────────────────────────────────────────────
 *
 * "Today" was being worked out in two ways that disagreed for five hours of
 * every night:
 *
 *   the reports, the dashboard and the ledger   a UTC day — which in
 *                                               Pakistan runs from five in
 *                                               the morning to five in the
 *                                               morning;
 *   the till's trading day, and every date      the calendar day on the
 *   box in the panel                            shop's wall, midnight to
 *                                               midnight.
 *
 * Between midnight and five a restaurant still serving was, at once, in
 * yesterday (its dashboard) and today (the day its next shift would open,
 * and the date its "Today" filter asked for — which the report then answered
 * with nothing, because that day had not begun). Nobody chose either rule.
 * The first is what a database does when nobody says otherwise.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * A shop's day TURNS AT AN HOUR, by its own clock, and everything asks here.
 *
 * Five in the morning unless the shop says otherwise. Not midnight: a karahi
 * house takes money until two, and its owner reading "today's sales" at half
 * past one wants the evening — not the last ninety minutes of it, with the
 * rest filed under yesterday. Five is after any night's last sale and before
 * any morning's first. A shop that shuts at eleven never meets the
 * difference; a shop that wants midnight can have it (Settings → Shop).
 *
 * A sale at one in the morning is therefore part of the day before, in every
 * figure — and its receipt still prints one in the morning on the calendar
 * date it happened, because that is when it happened (ShopTime).
 *
 * ── Why the default is not written as "5" ────────────────────────────
 *
 * Unset, the day turns where it always has: at midnight UTC, read on the
 * shop's own clock. In Pakistan that IS five in the morning, so no figure any
 * shop has ever been shown moves. Written as a flat "5" it would have moved
 * every shop not on Pakistan's clock by its own offset on the day this
 * shipped — for a rule whose whole purpose is that the day stops moving.
 * Where midnight UTC falls outside the small hours (the Americas) the default
 * is midnight local, which is what such a shop would expect.
 *
 * So a day is cut on a FRAME: a clock, and the minutes past that clock's
 * midnight. Unset in Pakistan the frame is (UTC, 0); set to 3 it is
 * (Asia/Karachi, 180). Every method below asks the frame and nothing else.
 *
 * ── Not this class's business ────────────────────────────────────────
 *
 * A date somebody TYPES — an expense's date, an expiry, a "valid until" — is
 * a calendar date and is not moved. `calendarToday` is the newest one of
 * those a person may type: the date on the wall, even at one in the morning.
 */
final class ShopDay
{
    /** A day may turn no later than this. Past it, it is not "the night before" any more. */
    public const LATEST_TURN_HOUR = 8;

    public static function zone(?Tenant $tenant = null): string
    {
        return ShopTime::zone($tenant);
    }

    /**
     * The clock the day is cut on, and the minutes past its midnight.
     *
     * @return array{zone: string, minutes: int}
     */
    private static function frame(?Tenant $tenant): array
    {
        $tenant ??= app(TenantContext::class)->get();
        $zone = self::zone($tenant);

        $chosen = $tenant?->settings['day_turns_at'] ?? null;
        if (is_numeric($chosen)) {
            return ['zone' => $zone, 'minutes' => max(0, min(self::LATEST_TURN_HOUR, (int) $chosen)) * 60];
        }

        // Where it has always turned: midnight UTC — when that falls in the
        // shop's small hours. Cut on UTC itself rather than on "the shop's
        // clock, five hours in", so a zone that moves its clocks twice a year
        // does not move this with them.
        $offset = self::offsetMinutes($zone);

        return $offset >= 0 && $offset <= self::LATEST_TURN_HOUR * 60
            ? ['zone' => 'UTC', 'minutes' => 0]
            : ['zone' => $zone, 'minutes' => 0];
    }

    private static function offsetMinutes(string $zone): int
    {
        return (int) round(now()->setTimezone($zone)->getOffset() / 60);
    }

    /** Minutes after midnight ON THE SHOP'S WALL at which its day turns. */
    public static function turnsAtMinutes(?Tenant $tenant = null): int
    {
        $tenant ??= app(TenantContext::class)->get();
        $frame = self::frame($tenant);

        return $frame['zone'] === 'UTC' && self::zone($tenant) !== 'UTC'
            ? self::offsetMinutes(self::zone($tenant))
            : $frame['minutes'];
    }

    /** What the shop chose, or null when it has left the day where it was. */
    public static function chosenHour(?Tenant $tenant = null): ?int
    {
        $tenant ??= app(TenantContext::class)->get();
        $chosen = $tenant?->settings['day_turns_at'] ?? null;

        return is_numeric($chosen) ? max(0, min(self::LATEST_TURN_HOUR, (int) $chosen)) : null;
    }

    /**
     * "Which business date is this moment?" — as a function, for a loop.
     *
     * A month of sales is several thousand rows; working the frame out once
     * and not once per row is the difference.
     *
     * @return Closure(DateTimeInterface): string
     */
    public static function dater(?Tenant $tenant = null): Closure
    {
        $frame = self::frame($tenant);

        return static fn (DateTimeInterface $moment): string => CarbonImmutable::instance($moment)
            ->setTimezone($frame['zone'])
            ->subMinutes($frame['minutes'])
            ->toDateString();
    }

    /** The business date a moment belongs to, as `Y-m-d`. */
    public static function dateOf(DateTimeInterface $moment, ?Tenant $tenant = null): string
    {
        return self::dater($tenant)($moment);
    }

    /** The business date it is now. */
    public static function today(?Tenant $tenant = null): string
    {
        return self::dateOf(now(), $tenant);
    }

    /** The date on the shop's wall right now — the newest date a person may type. */
    public static function calendarToday(?Tenant $tenant = null): string
    {
        return now()->setTimezone(self::zone($tenant))->toDateString();
    }

    /** The instant a business date begins, in UTC — a lower bound for a timestamp column. */
    public static function startOf(string|DateTimeInterface $date, ?Tenant $tenant = null): CarbonImmutable
    {
        $frame = self::frame($tenant);
        $day = $date instanceof DateTimeInterface ? Carbon::instance($date)->toDateString() : substr($date, 0, 10);

        return CarbonImmutable::parse($day.' 00:00:00', $frame['zone'])
            ->addMinutes($frame['minutes'])
            ->utc();
    }

    /** The last second of a business date, in UTC — an inclusive upper bound. */
    public static function endOf(string|DateTimeInterface $date, ?Tenant $tenant = null): CarbonImmutable
    {
        $day = $date instanceof DateTimeInterface ? Carbon::instance($date)->toDateString() : substr($date, 0, 10);

        return self::startOf(CarbonImmutable::parse($day)->addDay()->toDateString(), $tenant)->subSecond();
    }

    /**
     * Both ends of a run of business dates, for `whereBetween` on a timestamp.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public static function span(string|DateTimeInterface $from, string|DateTimeInterface $to, ?Tenant $tenant = null): array
    {
        return [self::startOf($from, $tenant), self::endOf($to, $tenant)];
    }

    /**
     * The window a screen asked for: its two dates, and the instants they span.
     *
     * Half the tenant controllers had their own four lines of this — parse the
     * date, start of day, end of day, fall back to today — and every copy cut
     * the day on the server's clock. One copy, on the shop's.
     *
     * @param  'today'|'month'  $opens  What an unasked-for `from` falls back to.
     * @return array{from: string, to: string, start: CarbonImmutable, end: CarbonImmutable}
     */
    public static function window(?string $from, ?string $to, string $opens = 'today', ?Tenant $tenant = null): array
    {
        $today = self::today($tenant);

        $from = $from !== null && $from !== ''
            ? Carbon::parse($from)->toDateString()
            : ($opens === 'month' ? substr($today, 0, 8).'01' : $today);
        $to = $to !== null && $to !== '' ? Carbon::parse($to)->toDateString() : $today;

        return [
            'from' => $from,
            'to' => $to,
            'start' => self::startOf($from, $tenant),
            'end' => self::endOf($to, $tenant),
        ];
    }

    /**
     * Fence a MOMENT column to a run of business dates. Either end may be open.
     *
     * In place of `whereDate(column, '>=', $from)`, which asks the database
     * what date the moment is — and the database answers in UTC.
     *
     * @template TQuery of QueryBuilder
     *
     * @param  TQuery  $query
     * @return TQuery
     */
    public static function between(QueryBuilder $query, string $column, string|DateTimeInterface|null $from, string|DateTimeInterface|null $to, ?Tenant $tenant = null): QueryBuilder
    {
        if ($from !== null && $from !== '') {
            $query->where($column, '>=', self::startOf($from, $tenant));
        }
        if ($to !== null && $to !== '') {
            $query->where($column, '<=', self::endOf($to, $tenant));
        }

        return $query;
    }

    /**
     * SQL for "the business date of this UTC timestamp column", as `Y-m-d`.
     *
     * For grouping a week of sales into its days in one query. The shift is
     * the frame's distance from UTC less the minutes its day turns at —
     * nought when the shop has left the day where it was, which is why a
     * plain DATE() has looked right for as long as it has.
     *
     * The distance is the one in force NOW. A shop on a clock that changes
     * twice a year, with an hour of its own choosing, gets the hour either
     * side of each change filed by today's offset. Pakistan's clock does not
     * change.
     *
     * MySQL runs production and SQLite the tests; neither spells this the
     * same way.
     */
    public static function dateSql(string $column, ?Tenant $tenant = null): string
    {
        $moved = self::movedSql($column, $tenant);

        return match (DB::connection()->getDriverName()) {
            'sqlite' => "strftime('%Y-%m-%d', {$moved})",
            'pgsql' => "to_char({$moved}, 'YYYY-MM-DD')",
            default => "DATE_FORMAT({$moved}, '%Y-%m-%d')",
        };
    }

    /**
     * SQL for a UTC timestamp column moved onto the shop's day, so that its
     * DATE is the business date. The column itself when nothing has to move.
     */
    public static function movedSql(string $column, ?Tenant $tenant = null): string
    {
        $frame = self::frame($tenant);
        $shift = self::offsetMinutes($frame['zone']) - $frame['minutes'];
        if ($shift === 0) {
            return $column;
        }

        $signed = ($shift > 0 ? '+' : '').$shift;

        return match (DB::connection()->getDriverName()) {
            'sqlite' => "datetime({$column}, '{$signed} minutes')",
            'pgsql' => "({$column} + interval '{$shift} minutes')",
            default => "DATE_ADD({$column}, INTERVAL {$shift} MINUTE)",
        };
    }

    /**
     * The rule, for a screen: the clock, the minute the day turns on it, and
     * the date it is now. A panel works out "today" from the first two, so it
     * stays right across midnight without asking again.
     *
     * @return array{zone: string, turns_at_minutes: int, chosen_hour: int|null, today: string}
     */
    public static function describe(?Tenant $tenant = null): array
    {
        return [
            'zone' => self::zone($tenant),
            'turns_at_minutes' => self::turnsAtMinutes($tenant),
            'chosen_hour' => self::chosenHour($tenant),
            'today' => self::today($tenant),
        ];
    }

    /** The shop a tenant id names — the one in context when it is that one. */
    public static function shop(?string $tenantId): ?Tenant
    {
        $current = app(TenantContext::class)->get();
        if ($tenantId === null || $current?->id === $tenantId) {
            return $current;
        }

        return Tenant::query()->find($tenantId);
    }
}
