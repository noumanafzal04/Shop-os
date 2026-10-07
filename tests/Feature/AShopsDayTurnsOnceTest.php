<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Support\ServiceDay;
use App\Support\ShopDay;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * WHICH DAY A MOMENT BELONGS TO — ShopDay, by itself.
 *
 * Every figure in the product that says "today" asks this class. These are
 * the answers it must give, written as the hours a shop actually trades in.
 */
class AShopsDayTurnsOnceTest extends TestCase
{
    use RefreshDatabase;

    private function shop(array $settings = [], string $timezone = 'Asia/Karachi'): Tenant
    {
        $tenant = Tenant::factory()->create(['timezone' => $timezone]);
        $tenant->forceFill(['settings' => $settings])->save();

        return $tenant->fresh();
    }

    /** A moment on the shop's wall in Karachi, as the instant it is. */
    private function karachi(string $wall): Carbon
    {
        return Carbon::parse($wall, 'Asia/Karachi')->utc();
    }

    public function test_left_alone_a_shop_in_pakistan_turns_at_five_in_the_morning(): void
    {
        $shop = $this->shop();

        $this->assertSame(300, ShopDay::turnsAtMinutes($shop));
        $this->assertNull(ShopDay::chosenHour($shop));

        // The evening runs on past midnight …
        $this->assertSame('2026-10-06', ShopDay::dateOf($this->karachi('2026-10-06 23:59:00'), $shop));
        $this->assertSame('2026-10-06', ShopDay::dateOf($this->karachi('2026-10-07 01:30:00'), $shop));
        $this->assertSame('2026-10-06', ShopDay::dateOf($this->karachi('2026-10-07 04:59:59'), $shop));
        // … and turns at five.
        $this->assertSame('2026-10-07', ShopDay::dateOf($this->karachi('2026-10-07 05:00:00'), $shop));
    }

    /**
     * The promise that let this ship: no figure any shop has been shown moves.
     * Left alone, a business date is exactly the UTC date it always was.
     */
    public function test_left_alone_no_moment_changes_the_date_it_was_always_filed_under(): void
    {
        $shop = $this->shop();

        $moment = Carbon::parse('2026-01-01 00:00:00', 'UTC');
        for ($i = 0; $i < 24 * 4 * 3; $i++) {            // three days, every quarter hour
            $this->assertSame(
                $moment->toDateString(),
                ShopDay::dateOf($moment, $shop),
                "moved: {$moment->toIso8601String()}",
            );
            $moment = $moment->copy()->addMinutes(15);
        }
    }

    public function test_a_shop_may_have_midnight(): void
    {
        $shop = $this->shop(['day_turns_at' => 0]);

        $this->assertSame(0, ShopDay::turnsAtMinutes($shop));
        $this->assertSame(0, ShopDay::chosenHour($shop));
        $this->assertSame('2026-10-06', ShopDay::dateOf($this->karachi('2026-10-06 23:59:59'), $shop));
        $this->assertSame('2026-10-07', ShopDay::dateOf($this->karachi('2026-10-07 00:00:00'), $shop));
    }

    public function test_a_shop_may_have_an_hour_of_its_own(): void
    {
        $shop = $this->shop(['day_turns_at' => 3]);

        $this->assertSame(180, ShopDay::turnsAtMinutes($shop));
        $this->assertSame('2026-10-06', ShopDay::dateOf($this->karachi('2026-10-07 02:59:59'), $shop));
        $this->assertSame('2026-10-07', ShopDay::dateOf($this->karachi('2026-10-07 03:00:00'), $shop));
    }

    public function test_an_hour_past_the_latest_is_held_at_the_latest(): void
    {
        $shop = $this->shop(['day_turns_at' => 15]);

        $this->assertSame(ShopDay::LATEST_TURN_HOUR * 60, ShopDay::turnsAtMinutes($shop));
    }

    /** Where midnight UTC is not in the small hours, the default is the shop's own midnight. */
    public function test_a_shop_west_of_greenwich_is_not_given_seven_in_the_evening(): void
    {
        $shop = $this->shop([], 'America/New_York');

        $this->assertSame(0, ShopDay::turnsAtMinutes($shop));
        $this->assertSame(
            '2026-10-06',
            ShopDay::dateOf(Carbon::parse('2026-10-06 23:30:00', 'America/New_York'), $shop),
        );
    }

    /**
     * A day's start and end, and the moments either side of them. The two
     * halves of the rule — "which date is this" and "when does that date
     * begin" — are written separately and must not be able to drift.
     */
    public function test_a_days_edges_agree_with_the_date_of_the_moments_at_them(): void
    {
        foreach ([[], ['day_turns_at' => 0], ['day_turns_at' => 3], ['day_turns_at' => 8]] as $settings) {
            $shop = $this->shop($settings);
            $label = json_encode($settings);

            $start = ShopDay::startOf('2026-10-06', $shop);
            $end = ShopDay::endOf('2026-10-06', $shop);

            $this->assertSame('2026-10-06', ShopDay::dateOf($start, $shop), "start {$label}");
            $this->assertSame('2026-10-05', ShopDay::dateOf($start->subSecond(), $shop), "before start {$label}");
            $this->assertSame('2026-10-06', ShopDay::dateOf($end, $shop), "end {$label}");
            $this->assertSame('2026-10-07', ShopDay::dateOf($end->addSecond(), $shop), "after end {$label}");
            $this->assertSame(86399, (int) $start->diffInSeconds($end), "length {$label}");
        }
    }

    public function test_today_follows_the_clock(): void
    {
        $shop = $this->shop();

        $this->travelTo($this->karachi('2026-10-07 01:30:00'));
        $this->assertSame('2026-10-06', ShopDay::today($shop));
        // The date on the wall is the 7th all the same — that is the newest
        // date somebody may type on a bill.
        $this->assertSame('2026-10-07', ShopDay::calendarToday($shop));

        $this->travelTo($this->karachi('2026-10-07 05:00:00'));
        $this->assertSame('2026-10-07', ShopDay::today($shop));
    }

    /**
     * The SQL has to give the date PHP gives, or a chart is bucketed by one
     * rule and its window cut by another.
     */
    public function test_the_database_files_a_moment_under_the_same_date_php_does(): void
    {
        foreach ([[], ['day_turns_at' => 0], ['day_turns_at' => 3], ['day_turns_at' => 8]] as $settings) {
            $shop = $this->shop($settings);
            $sql = ShopDay::dateSql('at', $shop);
            $moved = ShopDay::movedSql('at', $shop);

            foreach (['2026-10-06 18:59:59', '2026-10-06 19:00:00', '2026-10-06 21:59:59', '2026-10-06 22:00:00',
                '2026-10-06 23:59:59', '2026-10-07 00:00:00', '2026-10-07 02:59:59', '2026-10-07 03:00:00'] as $utc) {
                $expected = ShopDay::dateOf(Carbon::parse($utc, 'UTC'), $shop);

                $row = DB::selectOne("select {$sql} as day, DATE({$moved}) as plain from (select ? as at) t", [$utc]);

                $this->assertSame($expected, $row->day, json_encode($settings)." {$utc}");
                $this->assertSame($expected, $row->plain, json_encode($settings)." {$utc} (DATE)");
            }
        }
    }

    public function test_a_window_is_the_shops_days_and_says_which(): void
    {
        $shop = $this->shop(['day_turns_at' => 0]);
        $this->travelTo($this->karachi('2026-10-07 10:00:00'));

        $asked = ShopDay::window('2026-10-01', '2026-10-03', 'today', $shop);
        $this->assertSame('2026-10-01', $asked['from']);
        $this->assertSame('2026-10-03', $asked['to']);
        $this->assertTrue($asked['start']->equalTo($this->karachi('2026-10-01 00:00:00')));
        $this->assertTrue($asked['end']->equalTo($this->karachi('2026-10-03 23:59:59')));

        $today = ShopDay::window(null, null, 'today', $shop);
        $this->assertSame(['2026-10-07', '2026-10-07'], [$today['from'], $today['to']]);

        $month = ShopDay::window(null, null, 'month', $shop);
        $this->assertSame(['2026-10-01', '2026-10-07'], [$month['from'], $month['to']]);
    }

    /**
     * The kitchen pass had an hour of its own once — five, written into
     * ServiceDay — so a shop that moved its day moved its reports and not its
     * board. One turn, read by both.
     */
    public function test_the_kitchens_tonight_turns_when_the_shops_day_does(): void
    {
        // Seven in the morning, for a shop whose day turns at eight: the
        // service that began yesterday morning is still this one.
        $late = $this->shop(['day_turns_at' => 8]);
        $this->travelTo($this->karachi('2026-10-07 07:00:00'));
        $this->assertTrue(ServiceDay::began($late)->equalTo($this->karachi('2026-10-06 08:00:00')));

        // The same moment for a shop left alone: its day turned at five, but
        // nothing from the last six hours is ever "an earlier service".
        $usual = $this->shop();
        $this->assertTrue(ServiceDay::began($usual)->equalTo($this->karachi('2026-10-07 01:00:00')));

        // And at noon the six hours no longer reach back past the turn.
        $this->travelTo($this->karachi('2026-10-07 12:00:00'));
        $this->assertTrue(ServiceDay::began($usual)->equalTo($this->karachi('2026-10-07 05:00:00')));
        $this->assertTrue(ServiceDay::began($late)->equalTo($this->karachi('2026-10-07 06:00:00')));
    }

    public function test_the_rule_is_described_for_a_screen(): void
    {
        $shop = $this->shop(['day_turns_at' => 2]);
        $this->travelTo($this->karachi('2026-10-07 01:00:00'));

        $this->assertSame([
            'zone' => 'Asia/Karachi',
            'turns_at_minutes' => 120,
            'chosen_hour' => 2,
            'today' => '2026-10-06',
        ], ShopDay::describe($shop));
    }
}
