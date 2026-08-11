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
 * "Who has paid, who has not, who is on grace, who is suspended."
 *
 * The concepts all existed — subscription_ends_at, plans.grace_period_days,
 * Tenant::subscriptionState() — but only one row at a time, computed in PHP
 * after loading. An admin with four hundred shops could see the state of any
 * ONE of them and could not answer the only question they actually ask, which
 * is which ones to chase this morning.
 *
 * The grace period is per PLAN (basic 7 days, premium 14, enterprise 30), and
 * that is what makes this more than a date comparison: a filter that assumed a
 * single grace length would put enterprise shops in the wrong bucket for three
 * weeks. Several tests below exist specifically to fail if it did.
 */
class AdminBillingFiltersTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Plan $basic;      // 7 days grace

    private Plan $enterprise; // 30 days grace

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

    /** @return array<int, string> business names in the given bucket */
    private function namesIn(string $status): array
    {
        $response = $this->asAdmin()
            ->getJson('/api/v1/admin/tenants?payment_status='.$status)
            ->assertOk();

        return array_column($response->json('data'), 'business_name');
    }

    private function tenant(string $name, Plan $plan, ?string $endsAt, array $extra = []): Tenant
    {
        return Tenant::factory()->create([
            'business_name' => $name,
            'plan_id' => $plan->id,
            'subscription_starts_at' => now()->subMonths(2),
            'subscription_ends_at' => $endsAt,
        ] + $extra);
    }

    // ── The four buckets ────────────────────────────────────────────

    public function test_a_current_subscription_reads_as_paid(): void
    {
        $this->tenant('Paid Up', $this->basic, now()->addDays(10)->toDateTimeString());

        $this->assertSame(['Paid Up'], $this->namesIn('paid'));
        $this->assertSame([], $this->namesIn('unpaid'));
        $this->assertSame([], $this->namesIn('grace'));
    }

    public function test_just_past_the_end_date_is_grace_not_unpaid(): void
    {
        // Three days over on a seven-day grace. The shop still trades; the
        // admin still calls. Putting it in "unpaid" would have support chasing
        // a customer whose cheque is in the post.
        $this->tenant('Three Days Over', $this->basic, now()->subDays(3)->toDateTimeString());

        $this->assertSame(['Three Days Over'], $this->namesIn('grace'));
        $this->assertSame([], $this->namesIn('unpaid'));
        $this->assertSame([], $this->namesIn('paid'));
    }

    public function test_past_the_grace_period_is_unpaid(): void
    {
        $this->tenant('Long Gone', $this->basic, now()->subDays(30)->toDateTimeString());

        $this->assertSame(['Long Gone'], $this->namesIn('unpaid'));
        $this->assertSame([], $this->namesIn('grace'));
    }

    public function test_grace_is_read_from_the_plan_not_a_fixed_number(): void
    {
        // Twenty days past the end date. On basic (7 days) that is unpaid; on
        // enterprise (30 days) the same date is still grace. Any filter that
        // hardcodes one grace length gets one of these two wrong, which is why
        // both are asserted in a single test.
        $this->tenant('Small Shop', $this->basic, now()->subDays(20)->toDateTimeString());
        $this->tenant('Big Chain', $this->enterprise, now()->subDays(20)->toDateTimeString());

        $this->assertSame(['Big Chain'], $this->namesIn('grace'));
        $this->assertSame(['Small Shop'], $this->namesIn('unpaid'));
    }

    public function test_a_suspended_shop_is_only_ever_suspended(): void
    {
        // Its subscription is fully paid. It still must not appear under
        // "paid", because an admin filtering for paid customers is asking who
        // is trading, and this one is not.
        $this->tenant('Switched Off', $this->basic, now()->addDays(20)->toDateTimeString(), [
            'status' => TenantStatus::Suspended,
        ]);

        $this->assertSame(['Switched Off'], $this->namesIn('suspended'));
        $this->assertSame([], $this->namesIn('paid'));
        $this->assertSame([], $this->namesIn('grace'));
        $this->assertSame([], $this->namesIn('unpaid'));
    }

    public function test_a_shop_with_no_end_date_owes_nothing(): void
    {
        $this->tenant('No Window Set', $this->basic, null);

        $this->assertSame(['No Window Set'], $this->namesIn('paid'));
        $this->assertSame([], $this->namesIn('unpaid'));
    }

    // ── The buckets as a set ────────────────────────────────────────

    public function test_every_shop_lands_in_exactly_one_bucket(): void
    {
        $this->tenant('A Paid', $this->basic, now()->addDay()->toDateTimeString());
        $this->tenant('B Grace', $this->basic, now()->subDays(2)->toDateTimeString());
        $this->tenant('C Unpaid', $this->basic, now()->subDays(40)->toDateTimeString());
        $this->tenant('D Suspended', $this->basic, now()->addDay()->toDateTimeString(), [
            'status' => TenantStatus::Suspended,
        ]);
        $this->tenant('E No Window', $this->basic, null);

        $all = array_merge(
            $this->namesIn('paid'),
            $this->namesIn('grace'),
            $this->namesIn('unpaid'),
            $this->namesIn('suspended'),
        );

        sort($all);

        // Five shops, five slots. Overlapping buckets cannot be counted, and
        // a shop in no bucket is a shop nobody ever chases.
        $this->assertSame(['A Paid', 'B Grace', 'C Unpaid', 'D Suspended', 'E No Window'], $all);
    }

    public function test_the_counts_ride_along_on_every_response(): void
    {
        $this->tenant('A Paid', $this->basic, now()->addDay()->toDateTimeString());
        $this->tenant('B Grace', $this->basic, now()->subDays(2)->toDateTimeString());
        $this->tenant('C Unpaid', $this->basic, now()->subDays(40)->toDateTimeString());
        $this->tenant('D Also Unpaid', $this->basic, now()->subDays(50)->toDateTimeString());

        // Unfiltered — so the tab labels read "Unpaid (2)" without a click,
        // and an admin who never opens the tab still sees the number.
        $this->asAdmin()->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('meta.payment_counts.paid', 1)
            ->assertJsonPath('meta.payment_counts.grace', 1)
            ->assertJsonPath('meta.payment_counts.unpaid', 2)
            ->assertJsonPath('meta.payment_counts.suspended', 0)
            ->assertJsonPath('meta.payment_counts.all', 4);
    }

    public function test_the_all_count_survives_a_bucket_being_selected(): void
    {
        $this->tenant('A Paid', $this->basic, now()->addDay()->toDateTimeString());
        $this->tenant('C Unpaid', $this->basic, now()->subDays(40)->toDateTimeString());

        // The paginator now counts one row. "All" must still say two, or the
        // tab relabels itself every time it is clicked away from.
        $this->asAdmin()->getJson('/api/v1/admin/tenants?payment_status=unpaid')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)
            ->assertJsonPath('meta.payment_counts.all', 2)
            ->assertJsonPath('meta.payment_counts.paid', 1);
    }

    public function test_the_counts_respect_the_other_filters(): void
    {
        $this->tenant('Searchable Unpaid', $this->basic, now()->subDays(40)->toDateTimeString());
        $this->tenant('Unrelated Unpaid', $this->basic, now()->subDays(40)->toDateTimeString());

        // A search for one shop should break DOWN that search, not report the
        // whole platform back at it.
        $this->asAdmin()->getJson('/api/v1/admin/tenants?search=Searchable')
            ->assertOk()
            ->assertJsonPath('meta.payment_counts.unpaid', 1);
    }

    public function test_the_row_carries_its_own_status_for_the_chip(): void
    {
        $this->tenant('Chip Me', $this->basic, now()->subDays(2)->toDateTimeString());

        $this->asAdmin()->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('data.0.payment_status', 'grace');
    }

    public function test_a_deleted_business_owes_nothing(): void
    {
        $gone = $this->tenant('Closed Down', $this->basic, now()->subDays(40)->toDateTimeString());
        $gone->delete();

        // The list is fetched with_deleted so an admin can restore it, and it
        // still shows in "All" — but a chase list must not include a business
        // that no longer exists.
        $this->assertSame([], $this->namesIn('unpaid'));

        $this->asAdmin()->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('meta.payment_counts.unpaid', 0);
    }

    public function test_an_unknown_bucket_is_refused_rather_than_ignored(): void
    {
        $this->tenant('Somebody', $this->basic, now()->subDays(40)->toDateTimeString());

        // Silently ignoring an unrecognised filter is how a screen ends up
        // showing every shop under a tab labelled "Unpaid".
        $this->asAdmin()->getJson('/api/v1/admin/tenants?payment_status=overdue')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'UNKNOWN_PAYMENT_STATUS');
    }

    public function test_the_filter_composes_with_search(): void
    {
        $this->tenant('Karachi Bakers', $this->basic, now()->subDays(40)->toDateTimeString());
        $this->tenant('Karachi Pharmacy', $this->basic, now()->addDays(5)->toDateTimeString());
        $this->tenant('Lahore Bakers', $this->basic, now()->subDays(40)->toDateTimeString());

        $names = array_column(
            $this->asAdmin()->getJson('/api/v1/admin/tenants?payment_status=unpaid&search=Karachi')
                ->assertOk()->json('data'),
            'business_name',
        );

        $this->assertSame(['Karachi Bakers'], $names);
    }

    // ── The billing window at creation ──────────────────────────────

    private function createPayload(array $overrides = []): array
    {
        return array_merge([
            'business_name' => 'New Shop',
            'business_type' => 'retail',
            'plan_id' => $this->basic->id,
            'owner' => [
                'name' => 'Owner',
                'email' => 'newowner@shop.test',
                'password' => 'a-strong-password',
            ],
        ], $overrides);
    }

    public function test_a_tenant_created_without_a_window_starts_today(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload())
            ->assertCreated();

        $tenant = Tenant::query()->where('business_name', 'New Shop')->firstOrFail();

        $this->assertTrue($tenant->subscription_starts_at->isToday());
        $this->assertSame(
            now()->addMonths($this->basic->billing_period_months)->toDateString(),
            $tenant->subscription_ends_at->toDateString(),
        );
    }

    public function test_the_admin_can_state_the_billing_window(): void
    {
        // A shop moving onto the platform mid-cycle with two months already
        // settled. Typed as "starts now" the renewal date is wrong forever,
        // because every later period stacks onto this one.
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'period' => [
                'starts_at' => '2026-06-01',
                'ends_at' => '2026-09-01',
            ],
        ]))->assertCreated();

        $tenant = Tenant::query()->where('business_name', 'New Shop')->firstOrFail();

        $this->assertSame('2026-06-01', $tenant->subscription_starts_at->toDateString());
        $this->assertSame('2026-09-01', $tenant->subscription_ends_at->toDateString());
    }

    public function test_a_stated_start_alone_still_derives_the_end_from_the_plan(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'period' => ['starts_at' => '2026-06-01'],
        ]))->assertCreated();

        $tenant = Tenant::query()->where('business_name', 'New Shop')->firstOrFail();

        $this->assertSame('2026-06-01', $tenant->subscription_starts_at->toDateString());
        $this->assertSame('2026-07-01', $tenant->subscription_ends_at->toDateString());
    }

    public function test_a_window_that_ends_before_it_starts_is_refused(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'period' => ['starts_at' => '2026-09-01', 'ends_at' => '2026-06-01'],
        ]))->assertStatus(422)->assertJsonValidationErrors('period.ends_at');

        $this->assertDatabaseMissing('tenants', ['business_name' => 'New Shop']);
    }

    public function test_the_opening_payment_can_be_dated_when_the_money_arrived(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'payment' => [
                'amount' => 2500,
                'method' => 'cash',
                'reference' => 'RCPT-1',
                'paid_at' => now()->subDays(4)->toDateTimeString(),
            ],
        ]))->assertCreated();

        $payment = SubscriptionPayment::query()->firstOrFail();

        // Paid Thursday, entered Monday. The ledger says Thursday.
        $this->assertSame(now()->subDays(4)->toDateString(), $payment->paid_at->toDateString());
        $this->assertSame('2500.00', $payment->amount);
        $this->assertSame('RCPT-1', $payment->reference);
    }

    public function test_a_payment_cannot_be_dated_in_the_future(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'payment' => ['amount' => 2500, 'paid_at' => now()->addDays(3)->toDateTimeString()],
        ]))->assertStatus(422)->assertJsonValidationErrors('payment.paid_at');
    }

    public function test_the_stated_window_is_what_the_ledger_records(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'period' => ['starts_at' => '2026-06-01', 'ends_at' => '2026-09-01'],
            'payment' => ['amount' => 7500, 'method' => 'bank_transfer'],
        ]))->assertCreated();

        $payment = SubscriptionPayment::query()->firstOrFail();

        // The receipt has to say what the money bought, or a renewal dispute
        // has nothing to check against.
        $this->assertSame('2026-06-01', $payment->period_start->toDateString());
        $this->assertSame('2026-09-01', $payment->period_end->toDateString());
    }

    public function test_a_backdated_window_lands_the_shop_straight_into_the_right_bucket(): void
    {
        // The end-to-end point of items 2 and 3 together: an admin records the
        // real dates, and the shop shows up under the right tab immediately
        // rather than looking paid for a month.
        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->createPayload([
            'period' => [
                'starts_at' => now()->subMonths(3)->toDateString(),
                'ends_at' => now()->subDays(40)->toDateString(),
            ],
        ]))->assertCreated();

        $this->assertSame(['New Shop'], $this->namesIn('unpaid'));
    }
}
