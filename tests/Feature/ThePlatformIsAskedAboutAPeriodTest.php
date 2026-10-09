<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * THE PLATFORM'S DASHBOARD, ASKED ABOUT A PERIOD.
 *
 * It said "revenue this month" beside "orders today" beside "riders a month
 * ago" — three windows on one row, none of them chosen. It is asked about two
 * dates now, and `in_period` is what happened between them:
 *
 *   money collected, shops that joined, orders placed, buyers who signed up
 *   each beside the same count for the period it is set against
 *
 * What the platform IS — how many shops, how many subscriptions — is not a
 * period's business and stays in `kpis`, untouched (AdminDashboardTest).
 *
 * The quiet ways this goes wrong: a day left out at either end; a demo counted
 * as a shop that joined; a running week set against a whole one, so that every
 * morning reads as a decline; and the money shown to somebody who may not see it.
 */
final class ThePlatformIsAskedAboutAPeriodTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        // Monday 15 June 2026, noon. Asked nothing, the period is the seven
        // days 9–15 June, set against 2–8 June UP TO NOON on the 8th.
        $this->travelTo(Carbon::parse('2026-06-15 12:00:00'));
        $this->admin = User::factory()->superAdmin()->create(['created_at' => '2026-01-01 00:00:00']);
        $this->shop = Tenant::factory()->create(['created_at' => '2026-05-01 09:00:00']);
    }

    public function test_asked_nothing_it_is_the_seven_days_ending_today(): void
    {
        // ── Shops ───────────────────────────────────────────────────
        Tenant::factory()->create(['created_at' => '2026-06-10 10:00:00']);                      // in
        Tenant::factory()->create(['created_at' => '2026-06-15 08:00:00']);                      // in — this morning
        Tenant::factory()->create(['created_at' => '2026-06-05 10:00:00']);                      // the week before
        // The afternoon of the 8th is in the week before — but past the hour
        // this week has reached, so it is not what this week is set against.
        Tenant::factory()->create(['created_at' => '2026-06-08 18:00:00']);
        // A shop a stranger was handed from the landing page did not JOIN.
        Tenant::factory()->create(['created_at' => '2026-06-12 10:00:00', 'is_demo' => true]);
        // One that began as a demo last month and was kept this week.
        Tenant::factory()->create(['created_at' => '2026-05-20 10:00:00', 'converted_at' => '2026-06-11 15:00:00']);

        // ── Money ───────────────────────────────────────────────────
        $this->payment(1000, '2026-06-09 00:00:00');      // the first second of the period
        $this->payment(500, '2026-06-15 11:00:00');       // an hour ago
        $this->payment(2000, '2026-06-03 10:00:00');      // the week before
        $this->payment(9000, '2026-06-08 23:59:00');      // the week before, past noon — not compared
        $this->payment(7000, '2026-05-30 10:00:00');      // neither

        // ── Orders, and who placed them ─────────────────────────────
        $ali = User::factory()->create(['name' => 'Ali', 'created_at' => '2026-06-14 09:00:00']);        // signed up in it
        $sara = User::factory()->create(['name' => 'Sara', 'created_at' => '2026-06-07 09:00:00']);      // the week before
        User::factory()->create(['created_at' => '2026-03-01 09:00:00']);                                 // long ago
        // Somebody who joined in it to WORK at a shop did not sign up to buy.
        User::factory()->shopOwner($this->shop)->create(['created_at' => '2026-06-13 09:00:00']);
        $this->order($ali, '2026-06-12 14:00:00', 800);
        $this->order($ali, '2026-06-13 14:00:00', 300, 'cancelled');
        $this->order($sara, '2026-06-04 14:00:00', 650);

        $data = $this->dashboard();

        $this->assertSame([
            'from' => '2026-06-09',
            'to' => '2026-06-15',
            'days' => 7,
            'compared_from' => '2026-06-02',
            'compared_to' => '2026-06-08',
            'today' => '2026-06-15',
            'asked' => false,
            'series' => ['from' => '2026-06-09', 'to' => '2026-06-15', 'bucket' => 'day'],
        ], $data['period']);

        $in = $data['in_period'];

        $this->assertEquals(['value' => 1500.0, 'previous' => 2000.0, 'delta_pct' => -25.0], $in['revenue']);
        $this->assertSame(2, $in['payments']);

        $this->assertEquals(['value' => 2, 'previous' => 1, 'delta_pct' => 100.0], $in['new_tenants']);
        $this->assertSame(1, $in['kept_from_demo']);

        // Two were placed. One was called off, and came to nothing.
        $this->assertEquals(['value' => 2, 'previous' => 1, 'delta_pct' => 100.0], $in['online_orders']);
        $this->assertEquals(800.0, $in['orders_value']);

        $this->assertEquals(['value' => 1, 'previous' => 1, 'delta_pct' => 0.0], $in['new_customers']);
    }

    public function test_a_period_that_is_over_is_set_against_the_whole_of_the_one_before(): void
    {
        // May, against April — both finished, so both are read to their last second.
        $this->payment(400, '2026-05-01 00:00:00');
        $this->payment(600, '2026-05-31 23:30:00');
        $this->payment(250, '2026-04-30 23:30:00');
        $this->payment(900, '2026-06-01 00:00:00');       // June's
        Tenant::factory()->create(['created_at' => '2026-04-30 22:00:00']);

        $data = $this->dashboard('from=2026-05-01&to=2026-05-31');

        $this->assertTrue($data['period']['asked']);
        $this->assertSame(['2026-04-01', '2026-04-30'], [$data['period']['compared_from'], $data['period']['compared_to']]);
        $this->assertEquals(['value' => 1000.0, 'previous' => 250.0, 'delta_pct' => 300.0], $data['in_period']['revenue']);
        $this->assertSame(2, $data['in_period']['payments']);
        // The shop this test stands on joined on 1 May; one joined the night before.
        $this->assertEquals(['value' => 1, 'previous' => 1, 'delta_pct' => 0.0], $data['in_period']['new_tenants']);

        // What the platform IS does not move with the period.
        $this->assertSame($this->dashboard()['kpis'], $data['kpis']);
    }

    public function test_one_day_is_one_day(): void
    {
        $this->payment(100, '2026-06-14 23:59:59');
        $this->payment(40, '2026-06-15 00:00:00');
        $this->payment(60, '2026-06-15 09:00:00');
        // Yesterday afternoon: past the hour today has reached.
        $this->payment(5, '2026-06-14 16:00:00');
        $this->payment(20, '2026-06-14 08:00:00');

        $today = $this->dashboard('from=2026-06-15&to=2026-06-15')['in_period'];
        $this->assertEquals(['value' => 100.0, 'previous' => 20.0, 'delta_pct' => 400.0], $today['revenue']);

        // Yesterday is over: all of it, against all of the day before.
        $yesterday = $this->dashboard('from=2026-06-14&to=2026-06-14')['in_period'];
        $this->assertEquals(125.0, $yesterday['revenue']['value']);
        $this->assertNull($yesterday['revenue']['delta_pct']);
    }

    public function test_the_money_is_withheld_from_somebody_who_may_not_see_it(): void
    {
        $this->payment(1000, '2026-06-12 10:00:00');
        $staff = User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();

        $in = $this->as($staff)->getJson('/api/v1/admin/dashboard')->assertOk()->json('data.in_period');

        // Absent, not zero. A zero is an answer, and the wrong one.
        $this->assertArrayNotHasKey('revenue', $in);
        $this->assertArrayNotHasKey('payments', $in);
        // Everything that is not the platform's takings is still theirs to see.
        $this->assertSame(['new_tenants', 'kept_from_demo', 'online_orders', 'orders_value', 'new_customers'], array_keys($in));
    }

    public function test_a_period_that_cannot_be_read_is_refused_in_words(): void
    {
        $ask = fn (string $query) => $this->as($this->admin)->getJson("/api/v1/admin/dashboard?{$query}");

        $ask('from=2026-06-15&to=2026-06-01')->assertStatus(422)
            ->assertJsonPath('errors.to.0', 'The end of the period is before its start.');
        $ask('to=15/06/2026')->assertStatus(422)->assertJsonStructure(['errors' => ['to']]);
        $ask('from=2020-01-01&to=2026-06-15')->assertStatus(422)->assertJsonStructure(['errors' => ['from']]);
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array<string, mixed> */
    private function dashboard(string $query = ''): array
    {
        $res = $this->as($this->admin)->getJson('/api/v1/admin/dashboard'.($query === '' ? '' : "?{$query}"));
        $this->assertSame(200, $res->status(), "GET /admin/dashboard?{$query} answered {$res->status()}: ".$res->content());

        return $res->json('data');
    }

    private function payment(float $amount, string $paidAt): void
    {
        $paid = Carbon::parse($paidAt);

        SubscriptionPayment::query()->create([
            'tenant_id' => $this->shop->id,
            'plan_id' => null,
            'plan_name' => 'Basic',
            'amount' => $amount,
            'method' => 'cash',
            'period_start' => $paid->copy()->startOfMonth()->toDateString(),
            'period_end' => $paid->copy()->endOfMonth()->toDateString(),
            'paid_at' => $paid,
        ]);
    }

    private function order(User $customer, string $placedAt, float $total, string $status = 'pending'): void
    {
        Order::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'customer_id' => $customer->id,
            'order_number' => 'ORD-'.substr(md5($placedAt.$total), 0, 8),
            'status' => $status,
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'customer_name' => $customer->name,
            'subtotal' => $total,
            'total' => $total,
            'placed_at' => $placedAt,
        ]);
    }
}
