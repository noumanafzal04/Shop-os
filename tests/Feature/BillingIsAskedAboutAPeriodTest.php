<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * THE BILLING SCREEN IS ASKED ABOUT A PERIOD.
 *
 * Its owner, looking at it: "should the Billing and Payments screen not have
 * a date picker?" It had one — at the bottom, on the ledger, called "Any
 * date". Everything above it was fixed at "this month", "this year" and "all
 * time", so the top of the screen could not be asked what came in last month.
 *
 * ── What each test is guarding ─────────────────────────────────────────
 *
 *   the period it opens on is this month so far — the figure the screen has
 *     always led with — and the server says which period it answered
 *   both ends of a period are counted, to the second, and nothing outside
 *   "collected" is the ledger's own total for the same two dates: one
 *     number, on one screen, twice
 *   it is set against like for like — and a period still running against the
 *     same PART of the one before, not the whole of it
 *   what is late and who to ring do not move with the period: they are now
 */
class BillingIsAskedAboutAPeriodTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        // A Wednesday, mid-morning, in the middle of a month.
        Carbon::setTestNow('2026-10-14 10:30:00');
        $this->admin = User::factory()->superAdmin()->create();
        $this->shop = Tenant::factory()->create([
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'subscription_ends_at' => now()->addMonth(),
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function summary(string $query = ''): array
    {
        return $this->asAdmin()->getJson('/api/v1/admin/billing/summary'.$query)->assertOk()->json('data');
    }

    private function paid(string $at, float $amount = 5000, array $more = []): SubscriptionPayment
    {
        return SubscriptionPayment::query()->create(array_merge([
            'tenant_id' => $this->shop->id,
            'plan_name' => 'Basic',
            'amount' => $amount,
            'method' => 'cash',
            'period_start' => Carbon::parse($at)->toDateString(),
            'period_end' => Carbon::parse($at)->addMonth()->toDateString(),
            'paid_at' => $at,
        ], $more));
    }

    public function test_it_opens_on_this_month_so_far_and_says_so(): void
    {
        $this->paid('2026-10-01 00:00:00', 2500);   // the first second of the month
        $this->paid('2026-10-14 09:00:00', 4000);   // this morning
        $this->paid('2026-09-30 23:59:59', 9000);   // the last second of last month

        $data = $this->summary();

        $this->assertSame('2026-10-01', $data['period']['from']);
        $this->assertSame('2026-10-14', $data['period']['to']);
        $this->assertSame('2026-10-14', $data['period']['today']);
        // Nobody named it: this is the period the screen opens on.
        $this->assertFalse($data['period']['asked']);

        $this->assertEquals(6500, $data['in_period']['collected']['value']);
        $this->assertSame(2, $data['in_period']['payments']['value']);
        // The figure the screen already out there leads with is the same one.
        $this->assertEquals(6500, $data['revenue']['this_month']);
    }

    public function test_a_period_counts_both_its_ends_to_the_second_and_nothing_outside(): void
    {
        $this->paid('2026-08-31 23:59:59', 100);
        $this->paid('2026-09-01 00:00:00', 1000);
        $this->paid('2026-09-17 12:00:00', 2000);
        $this->paid('2026-09-30 23:59:59', 4000);
        $this->paid('2026-10-01 00:00:00', 800);

        $data = $this->summary('?from=2026-09-01&to=2026-09-30');

        $this->assertTrue($data['period']['asked']);
        $this->assertSame(30, $data['period']['days']);
        $this->assertEquals(7000, $data['in_period']['collected']['value']);
        $this->assertSame(3, $data['in_period']['payments']['value']);

        // One day is a period too.
        $day = $this->summary('?from=2026-09-17&to=2026-09-17')['in_period'];
        $this->assertEquals(2000, $day['collected']['value']);
        $this->assertSame(1, $day['payments']['value']);
    }

    public function test_collected_is_the_ledgers_own_total_for_the_same_dates(): void
    {
        $this->paid('2026-09-01 00:00:00', 1000);
        $this->paid('2026-09-30 23:59:59', 4000, ['method' => 'bank_transfer']);
        $this->paid('2026-10-01 00:00:00', 800);
        $this->paid('2026-10-14 08:00:00', 300);

        foreach (['?from=2026-09-01&to=2026-09-30', '?from=2026-09-30&to=2026-10-01', '?from=2026-10-01&to=2026-10-14'] as $dates) {
            $said = $this->summary($dates)['in_period'];
            $ledger = $this->asAdmin()->getJson('/api/v1/admin/billing/payments'.$dates)->assertOk()->json('meta.totals');

            $this->assertEquals($ledger['amount'], $said['collected']['value'], "collected and the ledger disagree for {$dates}");
            $this->assertSame($ledger['payments'], $said['payments']['value'], "the payment counts disagree for {$dates}");
        }
    }

    public function test_a_shop_that_paid_twice_is_one_shop_and_nothing_before_is_no_percentage(): void
    {
        $other = Tenant::factory()->create(['plan_id' => Plan::query()->where('code', 'basic')->value('id')]);
        $this->paid('2026-09-02 10:00:00', 2500);
        $this->paid('2026-09-20 10:00:00', 500);                          // the same shop, again
        $this->paid('2026-09-21 10:00:00', 2500, ['tenant_id' => $other->id]);

        $september = $this->summary('?from=2026-09-01&to=2026-09-30')['in_period'];

        $this->assertSame(3, $september['payments']['value']);
        $this->assertSame(2, $september['shops']['value']);
        // Nothing came in in August: there is no honest percentage against
        // nothing, and the screen prints none rather than "+100%".
        $this->assertSame(0, $september['shops']['previous']);
        $this->assertNull($september['shops']['delta_pct']);
        $this->assertNull($september['collected']['delta_pct']);

        // October so far is set against September up to the 14th at half
        // past ten — by when one shop had paid, not two.
        $october = $this->summary()['in_period'];
        $this->assertSame(0, $october['shops']['value']);
        $this->assertSame(1, $october['shops']['previous']);
        $this->assertEquals(-100.0, $october['shops']['delta_pct']);
    }

    public function test_a_whole_month_is_set_against_the_whole_month_before(): void
    {
        $this->paid('2026-08-05 10:00:00', 3000);
        $this->paid('2026-08-31 23:00:00', 500);
        $this->paid('2026-09-10 10:00:00', 7000);

        $data = $this->summary('?from=2026-09-01&to=2026-09-30');

        $this->assertSame('2026-08-01', $data['period']['compared_from']);
        $this->assertSame('2026-08-31', $data['period']['compared_to']);
        $this->assertEquals(3500, $data['in_period']['collected']['previous']);
        $this->assertSame(2, $data['in_period']['payments']['previous']);
        // Twice as much as the month before: said once, by the server.
        $this->assertEquals(100.0, $data['in_period']['collected']['delta_pct']);
    }

    public function test_a_month_still_running_is_set_against_the_same_part_of_the_one_before(): void
    {
        // It is the 14th, half past ten. September's first fourteen days up
        // to half past ten are what October so far is measured against —
        // against all of September every month would open as a decline.
        $this->paid('2026-09-03 10:00:00', 2000);
        $this->paid('2026-09-14 10:29:00', 1000);   // before this hour, a month back
        $this->paid('2026-09-14 16:00:00', 6000);   // later that day: not yet "by now"
        $this->paid('2026-09-25 10:00:00', 9000);   // later that month
        $this->paid('2026-10-02 10:00:00', 4500);

        $data = $this->summary();

        $this->assertSame('2026-09-01', $data['period']['compared_from']);
        $this->assertSame('2026-09-14', $data['period']['compared_to']);
        $this->assertEquals(4500, $data['in_period']['collected']['value']);
        $this->assertEquals(3000, $data['in_period']['collected']['previous']);
        $this->assertSame(2, $data['in_period']['payments']['previous']);
        $this->assertEquals(50.0, $data['in_period']['collected']['delta_pct']);
    }

    public function test_what_is_late_and_who_to_ring_do_not_move_with_the_period(): void
    {
        // One shop a fortnight overdue — today, whatever is asked about.
        Tenant::factory()->create([
            'business_name' => 'Late Mart',
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'subscription_ends_at' => now()->subDays(40),
        ]);
        $this->paid('2026-06-10 10:00:00', 5000);

        $now = $this->summary();
        $june = $this->summary('?from=2026-06-01&to=2026-06-30');

        // The flow moved…
        $this->assertEquals(0, $now['in_period']['collected']['value']);
        $this->assertEquals(5000, $june['in_period']['collected']['value']);
        // …and nothing that is a state did.
        $this->assertSame($now['outstanding'], $june['outstanding']);
        $this->assertSame($now['chase'], $june['chase']);
        $this->assertSame($now['subscriptions'], $june['subscriptions']);
        $this->assertSame('Late Mart', $june['chase'][0]['business_name']);
        $this->assertSame($now['revenue'], $june['revenue']);
    }

    public function test_a_period_that_is_not_one_is_refused(): void
    {
        $this->asAdmin()->getJson('/api/v1/admin/billing/summary?from=2026-09-30&to=2026-09-01')->assertStatus(422);
        $this->asAdmin()->getJson('/api/v1/admin/billing/summary?from=last-month')->assertStatus(422);
        // Three years is as far as a screen reads; past that it is a report.
        $this->asAdmin()->getJson('/api/v1/admin/billing/summary?from=2020-01-01&to=2026-10-14')->assertStatus(422);
    }

    public function test_only_somebody_who_may_see_the_money_is_told(): void
    {
        $token = User::factory()->adminStaff([])->create()->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/admin/billing/summary?from=2026-09-01&to=2026-09-30')->assertForbidden();
    }
}
