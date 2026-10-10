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

    // ── On no plan ──────────────────────────────────────────────────

    public function test_a_shop_on_no_plan_has_paid_nothing_and_is_not_counted_as_paid(): void
    {
        // Kept from a demo an hour ago: real, on no plan, waiting to be priced.
        Tenant::factory()->create(['business_name' => 'Kept From A Demo', 'plan_id' => null, 'subscription_ends_at' => null]);
        $this->tenant('Paid Up', $this->basic, now()->addDays(20)->toDateTimeString());

        $this->assertSame(['Kept From A Demo'], $this->namesIn('no_plan'));
        // "Paid" is the shops that have paid.
        $this->assertSame(['Paid Up'], $this->namesIn('paid'));

        // And its own row says the same thing the filter does.
        $row = collect($this->asAdmin()->getJson('/api/v1/admin/tenants')->json('data'))->firstWhere('business_name', 'Kept From A Demo');
        $this->assertSame('no_plan', $row['payment_status']);
    }

    public function test_a_shop_on_no_plan_whose_period_ran_out_is_still_behind(): void
    {
        // It had a period, the period ended, and the plan was then taken off.
        // "No plan yet" would file a shop that owes for a month under the
        // heading for shops that have been asked for nothing.
        Tenant::factory()->create([
            'business_name' => 'Lapsed, Then Unplanned', 'plan_id' => null,
            'subscription_ends_at' => now()->subDays(60),
        ]);

        $this->assertSame([], $this->namesIn('no_plan'));
        $this->assertSame(['Lapsed, Then Unplanned'], $this->namesIn('unpaid'));
    }

    public function test_a_suspended_shop_on_no_plan_is_suspended(): void
    {
        Tenant::factory()->create([
            'business_name' => 'Switched Off', 'plan_id' => null, 'subscription_ends_at' => null,
            'status' => TenantStatus::Suspended,
        ]);

        $this->assertSame([], $this->namesIn('no_plan'));
        $this->assertSame(['Switched Off'], $this->namesIn('suspended'));
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
        Tenant::factory()->create(['business_name' => 'F No Plan', 'plan_id' => null, 'subscription_ends_at' => null]);

        $all = array_merge(
            $this->namesIn('paid'),
            $this->namesIn('grace'),
            $this->namesIn('unpaid'),
            $this->namesIn('no_plan'),
            $this->namesIn('suspended'),
        );

        sort($all);

        // Six shops, six slots. Overlapping buckets cannot be counted, and
        // a shop in no bucket is a shop nobody ever chases.
        $this->assertSame(['A Paid', 'B Grace', 'C Unpaid', 'D Suspended', 'E No Window', 'F No Plan'], $all);
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
            ->assertJsonPath('meta.payment_counts.no_plan', 0)
            ->assertJsonPath('meta.payment_counts.all', 4);
    }

    public function test_the_counts_tell_no_plan_apart_from_paid(): void
    {
        $this->tenant('A Paid', $this->basic, now()->addDay()->toDateTimeString());
        Tenant::factory()->create(['business_name' => 'B No Plan', 'plan_id' => null, 'subscription_ends_at' => null]);
        Tenant::factory()->create(['business_name' => 'C No Plan', 'plan_id' => null, 'subscription_ends_at' => null]);

        // "Paid 1", not "Paid 3": two of these have been asked for nothing.
        $this->asAdmin()->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('meta.payment_counts.paid', 1)
            ->assertJsonPath('meta.payment_counts.no_plan', 2)
            ->assertJsonPath('meta.payment_counts.all', 3);
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

        // A chase list must not include a business that no longer exists —
        // however long ago its subscription ran out.
        $this->assertSame([], $this->namesIn('unpaid'));

        $this->asAdmin()->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('meta.payment_counts.unpaid', 0);
    }

    public function test_deleted_shops_are_asked_for_never_mixed_in(): void
    {
        // The console used to ask for every shop that had ever existed, on
        // every request: the ones closed down sat among the ones trading, and
        // "All" counted both — over a platform the dashboard called smaller.
        $this->tenant('Still Trading', $this->basic, now()->addMonth()->toDateTimeString());
        $this->tenant('Closed Down', $this->basic, now()->addMonth()->toDateTimeString())->delete();
        $this->tenant('Closed Last Year', $this->basic, now()->subYear()->toDateTimeString())->delete();

        $list = fn (string $query = '') => $this->asAdmin()->getJson('/api/v1/admin/tenants?sort=name'.$query)->assertOk();

        // The list an admin opens is the shops there ARE.
        $open = $list();
        $this->assertSame(['Still Trading'], array_column($open->json('data'), 'business_name'));
        $this->assertSame(1, $open->json('meta.payment_counts.all'));
        $this->assertSame(1, $open->json('meta.pagination.total'));

        // Asked for: the ones that can be put back, and only those — each
        // saying when it went.
        $gone = $list('&only_deleted=1');
        $this->assertSame(['Closed Down', 'Closed Last Year'], array_column($gone->json('data'), 'business_name'));
        $this->assertSame(2, $gone->json('meta.payment_counts.all'));
        foreach ($gone->json('data') as $row) {
            $this->assertNotNull($row['deleted_at'], "{$row['business_name']} is listed as deleted and does not say when");
        }
        // Not one of them is owed by, in grace, or to be chased.
        foreach (['paid', 'grace', 'unpaid', 'suspended'] as $bucket) {
            $this->assertSame(0, $gone->json("meta.payment_counts.{$bucket}"));
        }

        // Both together is still there for anything that asks for it by name.
        $this->assertSame(
            ['Closed Down', 'Closed Last Year', 'Still Trading'],
            array_column($list('&with_deleted=1')->json('data'), 'business_name'),
        );
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
