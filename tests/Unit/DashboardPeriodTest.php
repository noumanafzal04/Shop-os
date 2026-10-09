<?php

namespace Tests\Unit;

use App\Support\DashboardPeriod;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * THE PERIOD A DASHBOARD IS ASKED ABOUT — the arithmetic, with no shop in it.
 *
 * Dates go wrong quietly, so these stand on the days that break them: a month
 * end, February, a leap year, a quarter boundary, a year rollover.
 */
class DashboardPeriodTest extends TestCase
{
    private const TODAY = '2026-10-09';

    public function test_nobody_asked_is_today_set_against_yesterday(): void
    {
        $period = DashboardPeriod::of(null, null, self::TODAY);

        $this->assertSame(['2026-10-09', '2026-10-09'], [$period->from, $period->to]);
        $this->assertSame(['2026-10-08', '2026-10-08'], [$period->comparedFrom, $period->comparedTo]);
        $this->assertFalse($period->asked);
        $this->assertSame(1, $period->days());
    }

    public function test_a_screen_that_opens_on_the_week_is_the_seven_days_ending_today(): void
    {
        $period = DashboardPeriod::of(null, null, self::TODAY, 'week');

        // Seven days INCLUDING today — counting seven back would be eight.
        $this->assertSame(['2026-10-03', '2026-10-09'], [$period->from, $period->to]);
        $this->assertSame(7, $period->days());
        $this->assertSame(['2026-09-26', '2026-10-02'], [$period->comparedFrom, $period->comparedTo]);
        $this->assertFalse($period->asked);
    }

    public function test_a_period_somebody_named_says_so(): void
    {
        $this->assertTrue(DashboardPeriod::of(self::TODAY, self::TODAY, self::TODAY)->asked);
    }

    public function test_one_end_alone_is_still_a_period(): void
    {
        // From a date with no end: up to today.
        $from = DashboardPeriod::of('2026-10-01', null, self::TODAY);
        $this->assertSame(['2026-10-01', '2026-10-09'], [$from->from, $from->to]);

        // An end with no start: that one day.
        $to = DashboardPeriod::of(null, '2026-09-30', self::TODAY);
        $this->assertSame(['2026-09-30', '2026-09-30'], [$to->from, $to->to]);

        // A start that has not come yet is one empty day, not a period run backwards.
        $ahead = DashboardPeriod::of('2026-10-20', null, self::TODAY);
        $this->assertSame(['2026-10-20', '2026-10-20'], [$ahead->from, $ahead->to]);
    }

    /**
     * LIKE FOR LIKE. Each row: the period, and what it is set against.
     *
     * @return array<string, array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function comparisons(): array
    {
        return [
            // The first nine days of a month against the first nine of the
            // month before — NOT the nine days before the 1st, which in a
            // country paid on the first are the poorest of any month.
            'a month so far' => ['2026-10-01', '2026-10-09', '2026-09-01', '2026-09-09'],
            'a whole month, the one before being shorter' => ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30'],
            'all of March against all of February' => ['2027-03-01', '2027-03-31', '2027-02-01', '2027-02-28'],
            'all of March in a leap year' => ['2028-03-01', '2028-03-31', '2028-02-01', '2028-02-29'],
            'thirty days of March cannot find thirty in February' => ['2027-03-01', '2027-03-30', '2027-02-01', '2027-02-28'],
            'all of February against all of January' => ['2027-02-01', '2027-02-28', '2027-01-01', '2027-01-31'],
            'January against the December of the year before' => ['2027-01-01', '2027-01-31', '2026-12-01', '2026-12-31'],
            'a quarter so far' => ['2026-10-01', '2026-11-15', '2026-07-01', '2026-08-15'],
            'a whole quarter' => ['2026-10-01', '2026-12-31', '2026-07-01', '2026-09-30'],
            'two whole months of a quarter' => ['2026-10-01', '2026-11-30', '2026-07-01', '2026-08-31'],
            'the first quarter against the last of the year before' => ['2027-01-01', '2027-03-31', '2026-10-01', '2026-12-31'],
            'a year so far' => ['2026-01-01', '2026-10-09', '2025-01-01', '2025-10-09'],
            'a whole year' => ['2026-01-01', '2026-12-31', '2025-01-01', '2025-12-31'],
            'half a year' => ['2026-01-01', '2026-06-30', '2025-01-01', '2025-06-30'],
            'a leap year against the one before' => ['2028-01-01', '2028-12-31', '2027-01-01', '2027-12-31'],
            // January and February are the first part of a QUARTER before they
            // are the first part of a year — the nearer like is the truer one.
            'a quarter up to a leap day' => ['2028-01-01', '2028-02-29', '2027-10-01', '2027-11-30'],
            // None of the above: the same number of days, immediately before.
            'seven days' => ['2026-10-03', '2026-10-09', '2026-09-26', '2026-10-02'],
            'thirty days across a month end' => ['2026-09-10', '2026-10-09', '2026-08-11', '2026-09-09'],
            'a run that starts on the 1st and ends in another year' => ['2025-12-01', '2026-01-10', '2025-10-21', '2025-11-30'],
            'one day, even the 1st' => ['2026-10-01', '2026-10-01', '2026-09-30', '2026-09-30'],
            'new year\'s day against new year\'s eve' => ['2027-01-01', '2027-01-01', '2026-12-31', '2026-12-31'],
        ];
    }

    #[DataProvider('comparisons')]
    public function test_a_period_is_set_against_its_like(string $from, string $to, string $againstFrom, string $againstTo): void
    {
        $period = DashboardPeriod::of($from, $to, self::TODAY);

        $this->assertSame([$againstFrom, $againstTo], [$period->comparedFrom, $period->comparedTo]);
    }

    public function test_one_day_is_drawn_as_the_last_of_the_seven_that_led_to_it(): void
    {
        $period = DashboardPeriod::of('2026-10-08', '2026-10-08', self::TODAY);

        $this->assertSame(['from' => '2026-10-02', 'to' => '2026-10-08', 'bucket' => 'day'], $period->series());

        $buckets = $period->buckets();
        $this->assertCount(7, $buckets);
        $this->assertSame(['from' => '2026-10-02', 'to' => '2026-10-02', 'label' => 'Fri'], $buckets[0]);
        $this->assertSame(['from' => '2026-10-08', 'to' => '2026-10-08', 'label' => 'Thu'], $buckets[6]);
        // …and that is as far back as anything is read: the day before it is
        // inside the seven.
        $this->assertSame('2026-10-02', $period->readsFrom());
    }

    public function test_a_month_is_a_point_a_day_named_by_its_date(): void
    {
        $period = DashboardPeriod::of('2026-09-01', '2026-09-30', self::TODAY);

        $this->assertSame('day', $period->series()['bucket']);
        $buckets = $period->buckets();
        $this->assertCount(30, $buckets);
        // More days than there are weekday names: the date itself.
        $this->assertSame('1 Sep', $buckets[0]['label']);
        $this->assertSame('30 Sep', $buckets[29]['label']);
        // The comparison reaches further back than the chart does.
        $this->assertSame('2026-08-01', $period->readsFrom());
    }

    public function test_a_quarter_is_a_point_a_week_counted_from_its_own_first_day(): void
    {
        // 1 Jul – 30 Sep 2026: ninety-two days.
        $period = DashboardPeriod::of('2026-07-01', '2026-09-30', self::TODAY);

        $this->assertSame('week', $period->series()['bucket']);
        $buckets = $period->buckets();
        $this->assertCount(14, $buckets);
        // The 1st was a Wednesday. A calendar week would open on a five-day stub.
        $this->assertSame(['from' => '2026-07-01', 'to' => '2026-07-07', 'label' => '1 Jul'], $buckets[0]);
        // Only the LAST point may be short — and it ends where the period does.
        $this->assertSame(['from' => '2026-09-30', 'to' => '2026-09-30', 'label' => '30 Sep'], $buckets[13]);
        // Every day is in exactly one point.
        $this->assertSame(92, array_sum(array_map(
            fn (array $b): int => (int) ((strtotime($b['to']) - strtotime($b['from'])) / 86400) + 1,
            $buckets,
        )));
    }

    public function test_a_year_is_a_point_a_month_cut_at_the_periods_own_ends(): void
    {
        $period = DashboardPeriod::of('2026-01-01', '2026-10-09', self::TODAY);

        $this->assertSame('month', $period->series()['bucket']);
        $buckets = $period->buckets();
        $this->assertCount(10, $buckets);
        $this->assertSame(['from' => '2026-01-01', 'to' => '2026-01-31', 'label' => 'Jan'], $buckets[0]);
        $this->assertSame(['from' => '2026-02-01', 'to' => '2026-02-28', 'label' => 'Feb'], $buckets[1]);
        // October is nine days old, and the point says so.
        $this->assertSame(['from' => '2026-10-01', 'to' => '2026-10-09', 'label' => 'Oct'], $buckets[9]);
    }

    public function test_months_in_two_years_carry_their_year(): void
    {
        // Mid-month to mid-month: the first and last points are both cut.
        $buckets = DashboardPeriod::of('2025-11-15', '2026-04-10', self::TODAY)->buckets();

        $this->assertSame(
            ['Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26'],
            array_column($buckets, 'label'),
        );
        $this->assertSame(['from' => '2025-11-15', 'to' => '2025-11-30', 'label' => 'Nov 25'], $buckets[0]);
        $this->assertSame(['from' => '2026-04-01', 'to' => '2026-04-10', 'label' => 'Apr 26'], $buckets[5]);
    }

    public function test_where_a_day_becomes_a_week_and_a_week_a_month(): void
    {
        // Thirty-one days is the longest month, and is still a point a day.
        $this->assertSame('day', DashboardPeriod::of('2026-08-01', '2026-08-31', self::TODAY)->series()['bucket']);
        $this->assertSame('week', DashboardPeriod::of('2026-08-01', '2026-09-01', self::TODAY)->series()['bucket']);
        // A hundred and twenty days is the last a week at a time.
        $this->assertSame('week', DashboardPeriod::of('2026-06-12', '2026-10-09', self::TODAY)->series()['bucket']);
        $this->assertSame('month', DashboardPeriod::of('2026-06-11', '2026-10-09', self::TODAY)->series()['bucket']);
    }

    public function test_dates_back_to_front_are_refused_in_words(): void
    {
        try {
            DashboardPeriod::of('2026-10-09', '2026-10-01', self::TODAY);
            $this->fail('a period that ends before it starts was accepted');
        } catch (ValidationException $e) {
            $this->assertSame(['The end of the period is before its start.'], $e->errors()['to']);
        }
    }

    public function test_more_than_three_years_is_a_report_not_a_dashboard(): void
    {
        // Three years to the day is the longest it will read…
        $this->assertSame(1096, DashboardPeriod::of('2023-10-10', '2026-10-09', self::TODAY)->days());

        // …and one day more is not.
        $this->expectException(ValidationException::class);
        DashboardPeriod::of('2023-10-09', '2026-10-09', self::TODAY);
    }

    public function test_the_screen_is_told_what_it_is_showing(): void
    {
        $this->assertSame([
            'from' => '2026-10-01',
            'to' => '2026-10-09',
            'days' => 9,
            'compared_from' => '2026-09-01',
            'compared_to' => '2026-09-09',
            'today' => '2026-10-09',
            'asked' => true,
            'series' => ['from' => '2026-10-01', 'to' => '2026-10-09', 'bucket' => 'day'],
        ], DashboardPeriod::of('2026-10-01', '2026-10-09', self::TODAY)->toArray());
    }
}
