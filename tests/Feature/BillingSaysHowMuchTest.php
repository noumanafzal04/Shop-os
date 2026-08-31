<?php

namespace Tests\Feature;

use App\Enums\TenantStatus;
use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE BILLING SCREEN LEARNS TO SAY HOW MUCH.
 *
 * Every number on it was a HEADCOUNT — active, expiring, expired, suspended —
 * and nobody chasing subscriptions is chasing heads. "Eleven shops are overdue"
 * and "eleven shops are overdue for 143,000" are different mornings, and only
 * one of them tells you whether to spend it on the phone.
 *
 * The ledger under those counts had the opposite problem: three filters
 * (`tenant_id`, `from`, `to`) that had worked since the day it was written and
 * that the screen in front of it had never once sent. An admin asked "what did
 * this shop pay in June" and was handed page one of everything.
 *
 * ── What each test is guarding ─────────────────────────────────────────
 *
 * The money figures are per-PLAN, and that is the part worth failing over: a
 * total that assumed one price would be wrong by the spread of the price list
 * and would still look like a plausible number.
 */
class BillingSaysHowMuchTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Plan $basic;

    private Plan $enterprise;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
        $this->basic = Plan::query()->where('code', 'basic')->firstOrFail();
        $this->enterprise = Plan::query()->where('code', 'enterprise')->firstOrFail();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function summary(): array
    {
        return $this->asAdmin()->getJson('/api/v1/admin/billing/summary')->assertOk()->json('data');
    }

    private function paid(Tenant $tenant, array $attributes = []): SubscriptionPayment
    {
        return SubscriptionPayment::query()->create(array_merge([
            'tenant_id' => $tenant->id,
            'plan_name' => 'Basic',
            'amount' => 5000,
            'method' => 'cash',
            'period_start' => now()->subMonth()->toDateString(),
            'period_end' => now()->toDateString(),
            'paid_at' => now(),
        ], $attributes));
    }

    // ── Money that is late ─────────────────────────────────────────────

    public function test_overdue_shops_are_counted_in_rupees_at_their_own_plan_price(): void
    {
        // Two plans with different prices, both overdue past their grace.
        Tenant::factory()->create([
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(60),
        ]);
        Tenant::factory()->create([
            'plan_id' => $this->enterprise->id,
            'subscription_ends_at' => now()->subDays(120),
        ]);

        $expected = round((float) $this->basic->price + (float) $this->enterprise->price, 2);

        $unpaid = $this->summary()['outstanding']['unpaid'];

        $this->assertSame(2, $unpaid['shops']);
        $this->assertEqualsWithDelta($expected, $unpaid['amount'], 0.01);
        // The denominator on the assertion above: if both plans cost the same
        // this test could not tell a per-plan sum from a doubled one.
        $this->assertNotEquals(
            (float) $this->basic->price,
            (float) $this->enterprise->price,
            'this test is only meaningful while the two plans are priced differently',
        );
    }

    public function test_a_shop_with_no_plan_is_counted_and_owes_nothing_and_says_so(): void
    {
        Tenant::factory()->create(['plan_id' => null, 'subscription_ends_at' => now()->subDays(60)]);

        $unpaid = $this->summary()['outstanding']['unpaid'];

        // Every converted demo starts here. Rolling it into the money figure
        // as a zero would hide the one list worth having: shops waiting to be
        // priced.
        $this->assertSame(1, $unpaid['shops']);
        $this->assertSame(1, $unpaid['unpriced']);
        $this->assertEqualsWithDelta(0.0, $unpaid['amount'], 0.01);
    }

    public function test_grace_and_overdue_are_separate_money(): void
    {
        // basic = 7 days grace, so 3 days past the end is still inside it.
        Tenant::factory()->create([
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(3),
        ]);
        Tenant::factory()->create([
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(60),
        ]);

        $out = $this->summary()['outstanding'];

        $this->assertSame(1, $out['grace']['shops']);
        $this->assertSame(1, $out['unpaid']['shops']);
        $this->assertEqualsWithDelta((float) $this->basic->price, $out['grace']['amount'], 0.01);
    }

    public function test_a_deleted_shop_owes_nothing(): void
    {
        $gone = Tenant::factory()->create([
            'plan_id' => $this->enterprise->id,
            'subscription_ends_at' => now()->subDays(90),
        ]);
        $gone->delete();

        $out = $this->summary()['outstanding'];

        $this->assertSame(0, $out['unpaid']['shops']);
        $this->assertEqualsWithDelta(0.0, $out['unpaid']['amount'], 0.01);
    }

    // ── Who to ring today ──────────────────────────────────────────────

    public function test_the_chase_list_puts_grace_before_overdue_and_says_how_late_each_one_is(): void
    {
        Tenant::factory()->create([
            'business_name' => 'Months Behind',
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(90),
        ]);
        Tenant::factory()->create([
            'business_name' => 'Two Days Over',
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(2),
        ]);

        $chase = $this->summary()['chase'];

        // In grace first: one phone call away from paying, one week away from
        // being switched off. The months-behind shop is a different job.
        $this->assertSame('Two Days Over', $chase[0]['business_name']);
        $this->assertSame('grace', $chase[0]['payment_status']);
        $this->assertSame(2, $chase[0]['days_late']);
        $this->assertSame('Months Behind', $chase[1]['business_name']);
        $this->assertSame('unpaid', $chase[1]['payment_status']);
        $this->assertEqualsWithDelta((float) $this->basic->price, (float) $chase[0]['amount'], 0.01);
    }

    public function test_a_shop_that_owes_nothing_is_not_on_the_chase_list(): void
    {
        Tenant::factory()->create(['business_name' => 'Paid Up', 'subscription_ends_at' => now()->addMonth()]);
        Tenant::factory()->create(['business_name' => 'No End Date', 'subscription_ends_at' => null]);

        $this->assertSame([], $this->summary()['chase']);
    }

    public function test_a_suspended_shop_is_counted_but_never_chased(): void
    {
        Tenant::factory()->suspended()->create([
            'business_name' => 'Switched Off',
            'plan_id' => $this->basic->id,
            'subscription_ends_at' => now()->subDays(30),
        ]);

        $summary = $this->summary();

        $this->assertSame(1, $summary['outstanding']['suspended']['shops']);
        $this->assertSame([], $summary['chase'], 'a suspended shop is a decision, not a phone call');
    }

    // ── The trend ──────────────────────────────────────────────────────

    public function test_the_summary_carries_the_same_twelve_month_trend_the_dashboard_draws(): void
    {
        // Pinned mid-month. `now()->subMonths(2)` from the 31st clamps onto a
        // thirty-day month, which drops the payment into the neighbouring
        // bucket — the month this test checks then reads zero, on the 31st and
        // no other day.
        $this->travelTo('2026-06-15 10:00:00');

        $tenant = Tenant::factory()->create();
        $this->paid($tenant, ['amount' => 1200, 'paid_at' => now()]);
        $this->paid($tenant, ['amount' => 800, 'paid_at' => now()->subMonths(2)]);

        $series = $this->summary()['revenue_series'];

        // Zero-filled: twelve months, holes included, or the chart draws a
        // straight line between two points three months apart and calls it
        // growth.
        $this->assertCount(12, $series);
        $this->assertEqualsWithDelta(1200.0, (float) end($series)['total'], 0.01);
        $this->assertEqualsWithDelta(0.0, (float) $series[10]['total'], 0.01);
    }

    // ── The ledger's filters, which were never reachable ───────────────

    public function test_the_ledger_can_be_narrowed_to_one_shop(): void
    {
        $mine = Tenant::factory()->create(['business_name' => 'Corner Mart']);
        $theirs = Tenant::factory()->create(['business_name' => 'Other Shop']);
        $this->paid($mine, ['reference' => 'MINE-1']);
        $this->paid($theirs, ['reference' => 'THEIRS-1']);

        $rows = $this->asAdmin()
            ->getJson('/api/v1/admin/billing/payments?tenant_id='.$mine->id)
            ->assertOk()
            ->json('data');

        $this->assertSame(['MINE-1'], array_column($rows, 'reference'));
    }

    public function test_the_ledger_can_be_searched_by_shop_name_plan_or_reference(): void
    {
        $mart = Tenant::factory()->create(['business_name' => 'Corner Mart']);
        $chemist = Tenant::factory()->create(['business_name' => 'Corner Chemist']);
        $this->paid($mart, ['reference' => 'TXN-AAA', 'plan_name' => 'Basic']);
        $this->paid($chemist, ['reference' => 'TXN-BBB', 'plan_name' => 'Enterprise']);

        $found = fn (string $term): array => array_column(
            $this->asAdmin()->getJson('/api/v1/admin/billing/payments?search='.$term)->assertOk()->json('data'),
            'reference',
        );

        $this->assertSame(['TXN-AAA'], $found('Mart'));
        $this->assertSame(['TXN-BBB'], $found('Enterprise'));
        $this->assertSame(['TXN-BBB'], $found('BBB'));
        // The denominator: all three searches must be picking one row out of
        // two, not one row out of one.
        $this->assertCount(2, $this->asAdmin()->getJson('/api/v1/admin/billing/payments')->json('data'));
    }

    public function test_the_ledger_can_be_narrowed_to_a_date_range(): void
    {
        $tenant = Tenant::factory()->create();
        $this->paid($tenant, ['reference' => 'OLD', 'paid_at' => now()->subMonths(3)]);
        $this->paid($tenant, ['reference' => 'RECENT', 'paid_at' => now()]);

        $rows = $this->asAdmin()
            ->getJson('/api/v1/admin/billing/payments?from='.now()->subDays(7)->toDateString())
            ->assertOk()
            ->json('data');

        $this->assertSame(['RECENT'], array_column($rows, 'reference'));
    }

    public function test_a_payment_made_today_is_inside_a_range_that_ends_today(): void
    {
        $tenant = Tenant::factory()->create();
        $this->paid($tenant, ['reference' => 'TODAY', 'paid_at' => now()->setTime(16, 30)]);

        $rows = $this->asAdmin()
            ->getJson('/api/v1/admin/billing/payments?to='.now()->toDateString())
            ->assertOk()
            ->json('data');

        // A `to` that compared against midnight would drop every payment taken
        // during the day it names — the single most common range there is.
        $this->assertSame(['TODAY'], array_column($rows, 'reference'));
    }

    public function test_the_ledger_totals_answer_how_much_not_how_many_rows_fit_on_a_page(): void
    {
        $tenant = Tenant::factory()->create();
        for ($i = 0; $i < 25; $i++) {
            $this->paid($tenant, ['amount' => 100, 'reference' => 'R-'.$i]);
        }

        $body = $this->asAdmin()->getJson('/api/v1/admin/billing/payments?per_page=20')->assertOk()->json();

        $this->assertCount(20, $body['data'], 'one page');
        // The whole filtered set, not the page. A total that counted the page
        // would change every time somebody turned it.
        $this->assertSame(25, $body['meta']['totals']['payments']);
        $this->assertEqualsWithDelta(2500.0, $body['meta']['totals']['amount'], 0.01);
    }

    public function test_the_totals_follow_the_filter(): void
    {
        $mart = Tenant::factory()->create(['business_name' => 'Corner Mart']);
        $other = Tenant::factory()->create(['business_name' => 'Other Shop']);
        $this->paid($mart, ['amount' => 700]);
        $this->paid($other, ['amount' => 300]);

        $body = $this->asAdmin()
            ->getJson('/api/v1/admin/billing/payments?tenant_id='.$mart->id)
            ->assertOk()
            ->json();

        $this->assertEqualsWithDelta(700.0, $body['meta']['totals']['amount'], 0.01);
    }

    public function test_the_split_by_method_is_grouped_and_ordered_by_money(): void
    {
        $tenant = Tenant::factory()->create();
        $this->paid($tenant, ['method' => 'cash', 'amount' => 100]);
        $this->paid($tenant, ['method' => 'cash', 'amount' => 150]);
        $this->paid($tenant, ['method' => 'bank_transfer', 'amount' => 900]);

        $methods = $this->asAdmin()->getJson('/api/v1/admin/billing/payments')->assertOk()->json('meta.methods');

        $this->assertSame('bank_transfer', $methods[0]['method']);
        $this->assertEqualsWithDelta(900.0, $methods[0]['amount'], 0.01);
        $this->assertSame('cash', $methods[1]['method']);
        $this->assertSame(2, $methods[1]['payments']);
        $this->assertEqualsWithDelta(250.0, $methods[1]['amount'], 0.01);
    }

    public function test_the_ledger_can_be_narrowed_to_one_method(): void
    {
        $tenant = Tenant::factory()->create();
        $this->paid($tenant, ['method' => 'cash', 'reference' => 'C1']);
        $this->paid($tenant, ['method' => 'bank_transfer', 'reference' => 'B1']);

        $rows = $this->asAdmin()
            ->getJson('/api/v1/admin/billing/payments?method=cash')
            ->assertOk()
            ->json('data');

        $this->assertSame(['C1'], array_column($rows, 'reference'));
    }

    public function test_the_four_subscription_buckets_still_partition_the_platform(): void
    {
        // The invariant BillingTest already guards, re-asserted here because
        // `outstanding` is computed from the same scope and a change to one
        // that broke the other would otherwise pass.
        Tenant::factory()->create(['subscription_ends_at' => now()->addMonth()]);
        Tenant::factory()->create(['subscription_ends_at' => now()->addDays(3)]);
        Tenant::factory()->create(['subscription_ends_at' => now()->subDays(60)]);
        Tenant::factory()->create(['status' => TenantStatus::Suspended]);

        $subs = $this->summary()['subscriptions'];

        $this->assertSame(4, array_sum($subs));
    }
}
