<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Plan;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\PlanLimits;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * THE SHOP'S MONTH, NOT THE CALENDAR'S.
 *
 * A shop that subscribed on the 12th is billed on the 12th, and its
 * included transactions have to run with its bill. Counting from the 1st
 * put the meter and the invoice eleven days out of step, in both directions:
 *
 *   a shop could exhaust its allowance on the 9th, be billed for a fresh
 *   month on the 12th, and still read "full" for nineteen days;
 *
 *   or burn the tail of one month and the head of the next inside a single
 *   invoice and never see that it had.
 *
 * The anniversary is walked forward in whole billing PERIODS, so a
 * quarterly plan counts quarterly rather than in thirds of a quarter.
 */
class TheShopsOwnMonthTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    private function shopStartedOn(?string $date, int $periodMonths = 1): Tenant
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => $periodMonths, 'max_orders_month' => 1000, 'is_active' => true,
        ]);

        return Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
            'subscription_starts_at' => $date,
        ]);
    }

    /**
     * Named `clockAt` and not `travelTo`: Laravel's own TestCase already has
     * a public `travelTo`, and a private one here is a fatal error before a
     * single test runs. Both clocks are set — an action that reads
     * `CarbonImmutable::now()` is not moved by the mutable one.
     */
    private function clockAt(string $date): void
    {
        Carbon::setTestNow($date);
        CarbonImmutable::setTestNow($date);
    }

    public function test_a_shop_billed_on_the_twelfth_counts_from_the_twelfth(): void
    {
        $shop = $this->shopStartedOn('2026-01-12 09:00:00');
        $this->clockAt('2026-05-20 15:00:00');

        $this->assertSame('2026-05-12', PlanLimits::periodStart($shop)->toDateString());
    }

    /** On the day itself, the new period has already begun. */
    public function test_the_renewal_day_starts_the_new_period(): void
    {
        $shop = $this->shopStartedOn('2026-01-12 09:00:00');
        $this->clockAt('2026-05-12 00:30:00');

        $this->assertSame('2026-05-12', PlanLimits::periodStart($shop)->toDateString());
    }

    /** And the day before it, the old one is still running. */
    public function test_the_day_before_renewal_is_still_the_old_period(): void
    {
        $shop = $this->shopStartedOn('2026-01-12 09:00:00');
        $this->clockAt('2026-05-11 23:30:00');

        $this->assertSame('2026-04-12', PlanLimits::periodStart($shop)->toDateString());
    }

    /**
     * A QUARTERLY PLAN COUNTS QUARTERLY.
     *
     * Dividing elapsed time by one month would reset a quarterly shop's
     * allowance three times inside one invoice — handing it three times the
     * transactions it paid for, and silently.
     */
    public function test_a_quarterly_plan_resets_once_a_quarter(): void
    {
        $shop = $this->shopStartedOn('2026-01-12 09:00:00', periodMonths: 3);
        $this->clockAt('2026-05-20 15:00:00');

        $this->assertSame('2026-04-12', PlanLimits::periodStart($shop)->toDateString());
    }

    /**
     * THE 31st IS NOT A DAY OF EVERY MONTH.
     *
     * Walking with `addMonths` is calendar-aware and lands on the last day
     * of a short month. Dividing by thirty days would drift a day every
     * other month until the meter reset in the middle of a billing period.
     */
    public function test_a_shop_that_started_on_the_thirty_first_survives_february(): void
    {
        $shop = $this->shopStartedOn('2026-01-31 09:00:00');
        $this->clockAt('2026-03-05 10:00:00');

        // January 31 → February 28 → March 28 is still ahead, so the live
        // period opened at the end of February.
        $this->assertSame('2026-02-28', PlanLimits::periodStart($shop)->toDateString());
    }

    /**
     * NO SUBSCRIPTION, NO ANNIVERSARY.
     *
     * A tenant with no start date has no billing period to anchor to, and
     * the 1st is what everybody means by "this month" in its absence. The
     * fallback has to be stated, because the alternative is a null that
     * counts every sale the shop has ever made.
     */
    public function test_a_shop_with_no_subscription_falls_back_to_the_calendar(): void
    {
        $shop = $this->shopStartedOn(null);
        $this->clockAt('2026-05-20 15:00:00');

        $this->assertSame('2026-05-01', PlanLimits::periodStart($shop)->toDateString());
    }

    /** Subscribed with a future start: the window is the one it begins in. */
    public function test_a_subscription_that_has_not_begun_counts_from_its_start(): void
    {
        $shop = $this->shopStartedOn('2026-09-01 09:00:00');
        $this->clockAt('2026-05-20 15:00:00');

        $this->assertSame('2026-09-01', PlanLimits::periodStart($shop)->toDateString());
    }
}
