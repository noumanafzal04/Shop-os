<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * THE PERIOD A DASHBOARD IS ASKED ABOUT.
 *
 * ── What was wrong ───────────────────────────────────────────────────
 *
 * Both dashboards answered one question each and could not be asked another.
 * The shop's said "today", with a week of bars behind it and a month of
 * leaders under that — three windows, none of them chosen by the reader. The
 * platform's said "this month" beside "today" beside "a month ago". Somebody
 * who wanted yesterday, or last month, or the fortnight of Eid, opened the
 * reports and built it there.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * A dashboard is asked about a PERIOD: two dates, both inclusive. Everything
 * on it that is a flow — what was sold, spent, refunded, who led — is cut to
 * exactly those dates. Everything that is a state — what is low, what is
 * owed, what is on the pass — is the state now, whatever period is asked.
 *
 * Three things follow from the two dates, and are worked out here so that the
 * shop's dashboard and the platform's cannot work them out differently:
 *
 *   WHAT IT IS COMPARED WITH. Like for like, not merely "the days before".
 *   The first nine days of a month are set against the first nine of the
 *   month before — in a country paid on the first, the nine days before the
 *   1st are the poorest of the month, and every month would open as a
 *   triumph. A whole month is set against the whole month before it, a year
 *   so far against the same days a year back. Only a run of days that is none
 *   of those is set against the same number of days immediately before.
 *
 *   WHAT THE CHART DRAWS. The period, a point a day — until that is more
 *   points than a chart can carry, and then a point a week, and then a month.
 *   One day is not a trend at all, so one day is drawn as the last of the
 *   seven that led to it.
 *
 *   HOW FAR BACK TO READ. The earlier of the two — the comparison and the
 *   chart — so one set of grouped queries answers the tiles, the pills and
 *   the chart, and they cannot contradict one another.
 *
 * ── Whose dates ──────────────────────────────────────────────────────
 *
 * This class is arithmetic on calendar dates and knows nothing about clocks.
 * The caller says what "today" is — a shop's business date (ShopDay), or the
 * platform's — and turns the dates into instants its own way.
 */
final class DashboardPeriod
{
    /** Three years. Past that it is a report, and a dashboard is the wrong place to wait for one. */
    public const LONGEST_DAYS = 1096;

    /** A point a day up to this many days; then a point a week. */
    private const DAILY_UP_TO = 31;

    /** A point a week up to this many days; then a point a month. */
    private const WEEKLY_UP_TO = 120;

    private function __construct(
        public readonly string $from,
        public readonly string $to,
        public readonly string $comparedFrom,
        public readonly string $comparedTo,
        public readonly string $today,
        /** False when nobody named a period and this is the one the screen opens on. */
        public readonly bool $asked,
    ) {}

    /** What a request may send. Both ends optional; see `of()` for what an absent one means. */
    public static function rules(): array
    {
        return [
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    /**
     * @param  string|null  $from  absent with `to` absent: the period the screen opens on.
     *                             Absent alone: the one day `to` names.
     * @param  string|null  $to  absent alone: up to today.
     * @param  'today'|'week'|'month'  $opens  what the screen opens on — the day, the seven days ending
     *                                         on it, or its month so far (the 1st up to it).
     *
     * @throws ValidationException when the dates are back to front, or further apart than a dashboard reads
     */
    public static function of(?string $from, ?string $to, string $today, string $opens = 'today'): self
    {
        $from = $from !== null && $from !== '' ? substr($from, 0, 10) : null;
        $to = $to !== null && $to !== '' ? substr($to, 0, 10) : null;
        $asked = $from !== null || $to !== null;

        if (! $asked) {
            $to = $today;
            $from = match ($opens) {
                'week' => CarbonImmutable::parse($today)->subDays(6)->toDateString(),
                // What is paid by the month is read by the month.
                'month' => CarbonImmutable::parse($today)->startOfMonth()->toDateString(),
                default => $today,
            };
        } elseif ($from === null) {
            $from = $to;
        } elseif ($to === null) {
            // "From the 1st" with no end is up to today — unless the 1st has
            // not come yet, and then it is that one day and it is empty.
            $to = max($from, $today);
        }

        if ($from > $to) {
            throw ValidationException::withMessages([
                'to' => ['The end of the period is before its start.'],
            ]);
        }

        $start = CarbonImmutable::parse($from);
        $end = CarbonImmutable::parse($to);

        if (self::daysBetween($start, $end) > self::LONGEST_DAYS) {
            throw ValidationException::withMessages([
                'from' => ['Pick a period of three years or less. For anything longer, use Reports.'],
            ]);
        }

        [$comparedFrom, $comparedTo] = self::comparison($start, $end);

        return new self($from, $to, $comparedFrom->toDateString(), $comparedTo->toDateString(), $today, $asked);
    }

    public function days(): int
    {
        return self::daysBetween(CarbonImmutable::parse($this->from), CarbonImmutable::parse($this->to));
    }

    public function isOneDay(): bool
    {
        return $this->from === $this->to;
    }

    /**
     * What the chart draws: its two ends, and how wide each point is.
     *
     * @return array{from: string, to: string, bucket: 'day'|'week'|'month'}
     */
    public function series(): array
    {
        if ($this->isOneDay()) {
            return [
                'from' => CarbonImmutable::parse($this->to)->subDays(6)->toDateString(),
                'to' => $this->to,
                'bucket' => 'day',
            ];
        }

        $days = $this->days();

        return [
            'from' => $this->from,
            'to' => $this->to,
            'bucket' => $days <= self::DAILY_UP_TO ? 'day' : ($days <= self::WEEKLY_UP_TO ? 'week' : 'month'),
        ];
    }

    /**
     * The chart's points, oldest first: the dates each one covers, and what
     * it is called on the axis.
     *
     * Built here rather than by the database so a day nobody traded on still
     * has a point — a chart with a hole in it reads as a fault, not as a
     * quiet Tuesday.
     *
     * A WEEK is seven days counted from the period's own first day, not a
     * calendar week: "the quarter, a week at a time" should not open with a
     * two-day stub because the 1st fell on a Saturday. Only the last point may
     * be short. A MONTH is a calendar month, cut at the period's ends.
     *
     * @return array<int, array{from: string, to: string, label: string}>
     */
    public function buckets(): array
    {
        $series = $this->series();
        $first = CarbonImmutable::parse($series['from']);
        $last = CarbonImmutable::parse($series['to']);
        $buckets = [];

        if ($series['bucket'] === 'month') {
            $acrossYears = $first->year !== $last->year;

            for ($cursor = $first; $cursor->lte($last); $cursor = $cursor->addMonthNoOverflow()->startOfMonth()) {
                $end = $cursor->endOfMonth()->startOfDay();
                $buckets[] = [
                    'from' => $cursor->toDateString(),
                    'to' => ($end->gt($last) ? $last : $end)->toDateString(),
                    // The year only when the axis would otherwise show "Jan" twice.
                    'label' => $cursor->format($acrossYears ? 'M y' : 'M'),
                ];
            }

            return $buckets;
        }

        $step = $series['bucket'] === 'week' ? 7 : 1;
        // "Mon" for a week of days, as the chart has always said it; the date
        // itself once there are more days than weekday names.
        $format = $step === 1 && self::daysBetween($first, $last) <= 7 ? 'D' : 'j M';

        for ($cursor = $first; $cursor->lte($last); $cursor = $cursor->addDays($step)) {
            $end = $cursor->addDays($step - 1);
            $buckets[] = [
                'from' => $cursor->toDateString(),
                'to' => ($end->gt($last) ? $last : $end)->toDateString(),
                'label' => $cursor->format($format),
            ];
        }

        return $buckets;
    }

    /** The earliest date anything on the dashboard is read from. */
    public function readsFrom(): string
    {
        return min($this->comparedFrom, $this->series()['from']);
    }

    /**
     * The period as a screen is told it — so the screen can SAY what it is
     * showing and what it set it against, rather than working either out again.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        return [
            'from' => $this->from,
            'to' => $this->to,
            'days' => $this->days(),
            'compared_from' => $this->comparedFrom,
            'compared_to' => $this->comparedTo,
            'today' => $this->today,
            'asked' => $this->asked,
            'series' => $this->series(),
        ];
    }

    private static function daysBetween(CarbonImmutable $from, CarbonImmutable $to): int
    {
        return (int) round($from->diffInDays($to)) + 1;
    }

    /**
     * What a period is set against. See the class note for why this is not
     * simply "the days before".
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    private static function comparison(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $days = self::daysBetween($from, $to);
        // "Up to the end of the month" must stay that when the month before
        // is a day shorter or longer: all of March against all of February.
        $toMonthEnd = $to->day === $to->daysInMonth;

        if ($days > 1 && $from->day === 1 && $from->year === $to->year) {
            // A month, or the first part of one.
            if ($from->month === $to->month) {
                $before = $from->subMonthNoOverflow();

                return [$before, $toMonthEnd
                    ? $before->endOfMonth()->startOfDay()
                    : $before->addDays(min($to->day, $before->daysInMonth) - 1)];
            }

            // A quarter, or the first part of one.
            if ($from->month % 3 === 1 && $from->quarter === $to->quarter) {
                $before = $to->subMonthsNoOverflow(3);

                return [$from->subMonthsNoOverflow(3), $toMonthEnd ? $before->endOfMonth()->startOfDay() : $before];
            }

            // A year, or the first part of one.
            if ($from->month === 1) {
                $before = $to->subYearNoOverflow();

                return [$from->subYearNoOverflow(), $toMonthEnd ? $before->endOfMonth()->startOfDay() : $before];
            }
        }

        // One day against the day before; any other run of days against the
        // same number of days immediately before it.
        return [$from->subDays($days), $from->subDay()];
    }
}
