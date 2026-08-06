<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Order;
use App\Models\Plan;
use App\Models\Rider;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DashboardService;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The platform (Super Admin) dashboard payload: KPI deltas, the revenue and
 * growth series, business-type / plan spread, and the billing + audit feeds.
 *
 * Two things are load-bearing beyond the numbers themselves:
 *  - platform aggregates must span EVERY tenant, so a tenant context left over
 *    on the request can never narrow them
 *  - an empty platform must return the whole shape, zeroed, with no invented
 *    percentages
 */
class AdminDashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        // Mid-month, mid-day: every "this month / last month / today /
        // yesterday" window the payload draws is then exactly known. Run at
        // 00:05 real time and the yesterday-so-far window would be a sliver.
        $this->travelTo(Carbon::parse('2026-06-15 12:00:00'));
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function dashboard(): array
    {
        return $this->asAdmin()->getJson('/api/v1/admin/dashboard')
            ->assertOk()
            ->json('data');
    }

    private function plan(string $code, float $price = 3000): Plan
    {
        return Plan::query()->create([
            'name' => ucfirst($code).' Plan',
            'code' => $code,
            'price' => $price,
            'billing_period_months' => 1,
            'grace_period_days' => 7,
        ]);
    }

    private function payment(Tenant $tenant, ?Plan $plan, float $amount, string $paidAt, array $extra = []): SubscriptionPayment
    {
        $paid = Carbon::parse($paidAt);

        return SubscriptionPayment::query()->create(array_merge([
            'tenant_id' => $tenant->id,
            'plan_id' => $plan?->id,
            'plan_name' => $plan?->name ?? 'Legacy',
            'amount' => $amount,
            'method' => 'cash',
            'period_start' => $paid->copy()->startOfMonth()->toDateString(),
            'period_end' => $paid->copy()->endOfMonth()->toDateString(),
            'paid_at' => $paid,
        ], $extra));
    }

    private function order(Tenant $tenant, User $customer, string $placedAt, string $number = 'ORD-000001'): Order
    {
        return Order::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'customer_id' => $customer->id,
            'order_number' => $number,
            'status' => 'pending',
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'customer_name' => $customer->name,
            'subtotal' => 500,
            'total' => 500,
            'placed_at' => $placedAt,
        ]);
    }

    public function test_kpis_report_platform_totals_against_the_previous_period(): void
    {
        $plan = $this->plan('pro');
        $customer = User::factory()->create();

        // Two shops from last month, one joined this month.
        $old = Tenant::factory()->create([
            'plan_id' => $plan->id,
            'created_at' => now()->subMonth()->startOfMonth()->addDay(),
            'subscription_ends_at' => now()->addMonths(3),
        ]);
        Tenant::factory()->create([
            'plan_id' => $plan->id,
            'created_at' => now()->subMonth()->startOfMonth()->addDays(2),
            'subscription_ends_at' => now()->addMonths(3),
        ]);
        $fresh = Tenant::factory()->create([
            'plan_id' => $plan->id,
            'created_at' => now()->startOfMonth()->addHours(2),
            // Already lapsed — must not count as a live subscription.
            'subscription_ends_at' => now()->subDay(),
        ]);

        $this->payment($old, $plan, 3000, now()->startOfMonth()->addDay()->toDateTimeString());
        $this->payment($old, $plan, 2000, now()->subMonth()->startOfMonth()->addDay()->toDateTimeString());

        $this->order($old, $customer, now()->subHours(2)->toDateTimeString(), 'ORD-000001');
        $this->order($fresh, $customer, now()->subHours(3)->toDateTimeString(), 'ORD-000002');
        $this->order($old, $customer, now()->subDay()->subHours(4)->toDateTimeString(), 'ORD-000003');

        Rider::withoutTenancy()->create([
            'tenant_id' => $old->id, 'name' => 'Bilal', 'is_active' => true,
            'created_at' => now()->subMonths(2),
        ]);
        Rider::withoutTenancy()->create([
            'tenant_id' => $fresh->id, 'name' => 'Kamran', 'is_active' => true,
        ]);
        Rider::withoutTenancy()->create([
            'tenant_id' => $fresh->id, 'name' => 'Retired', 'is_active' => false,
        ]);

        $kpis = $this->dashboard()['kpis'];

        $this->assertEquals(3, $kpis['total_tenants']['value']);
        $this->assertEquals(2, $kpis['total_tenants']['previous']);
        $this->assertEquals(50.0, $kpis['total_tenants']['delta_pct']);

        // Only the two unexpired windows count.
        $this->assertSame(2, $kpis['active_subscriptions']['value']);

        $this->assertEquals(3000.0, $kpis['revenue_this_month']['value']);
        $this->assertEquals(2000.0, $kpis['revenue_this_month']['previous']);
        $this->assertEquals(50.0, $kpis['revenue_this_month']['delta_pct']);

        // Two orders today across two different tenants, one yesterday.
        $this->assertSame(2, $kpis['online_orders_today']['value']);
        $this->assertSame(1, $kpis['online_orders_today']['previous']);
        $this->assertEquals(100.0, $kpis['online_orders_today']['delta_pct']);

        $this->assertSame(2, $kpis['active_riders']['value']);
        $this->assertSame(1, $kpis['active_riders']['previous']);

        $this->assertSame(1, $kpis['new_tenants_this_month']['value']);
        $this->assertSame(2, $kpis['new_tenants_this_month']['previous']);
        $this->assertEquals(-50.0, $kpis['new_tenants_this_month']['delta_pct']);

        // The pre-existing keys are untouched.
        $this->assertEquals(3, $this->dashboard()['tenants']['total']);
    }

    public function test_delta_is_null_when_the_previous_period_had_nothing(): void
    {
        $plan = $this->plan('starter');
        $tenant = Tenant::factory()->create(['plan_id' => $plan->id, 'created_at' => now()->startOfMonth()]);
        $this->payment($tenant, $plan, 1500, now()->toDateTimeString());
        $this->order($tenant, User::factory()->create(), now()->toDateTimeString());

        $kpis = $this->dashboard()['kpis'];

        // No prior month at all → no honest percentage to show.
        $this->assertNull($kpis['revenue_this_month']['delta_pct']);
        $this->assertNull($kpis['new_tenants_this_month']['delta_pct']);
        $this->assertNull($kpis['online_orders_today']['delta_pct']);
        $this->assertNull($kpis['total_tenants']['delta_pct']);
        $this->assertEquals(1500.0, $kpis['revenue_this_month']['value']);
    }

    public function test_revenue_series_covers_twelve_zero_filled_months(): void
    {
        $plan = $this->plan('pro');
        $tenant = Tenant::factory()->create(['plan_id' => $plan->id]);

        $this->payment($tenant, $plan, 1000, now()->startOfMonth()->addDay()->toDateTimeString());
        $this->payment($tenant, $plan, 250, now()->startOfMonth()->addDays(2)->toDateTimeString());
        $this->payment($tenant, $plan, 900, now()->startOfMonth()->subMonths(2)->addDay()->toDateTimeString());
        // Older than the window — must be excluded, not folded into month one.
        $this->payment($tenant, $plan, 5000, now()->startOfMonth()->subMonths(14)->toDateTimeString());

        $series = $this->dashboard()['revenue_series'];

        $this->assertCount(12, $series);
        $this->assertSame(now()->startOfMonth()->subMonths(11)->format('Y-m'), $series[0]['ym']);
        $this->assertSame(now()->format('Y-m'), $series[11]['ym']);
        $this->assertSame(now()->format('M'), $series[11]['month']);

        $byMonth = collect($series)->pluck('total', 'ym');
        $this->assertEquals(1250.0, $byMonth[now()->format('Y-m')]);
        $this->assertEquals(900.0, $byMonth[now()->subMonths(2)->format('Y-m')]);
        $this->assertEquals(0.0, $byMonth[now()->subMonth()->format('Y-m')]);
        $this->assertSame(5000.0 + 1250.0 + 900.0, 7150.0); // sanity on the fixture
        $this->assertEquals(2150.0, (float) collect($series)->sum('total'));
    }

    public function test_tenant_growth_splits_active_and_suspended_over_six_months(): void
    {
        Tenant::factory()->create(['created_at' => now()->startOfMonth()->addDay()]);
        Tenant::factory()->create(['created_at' => now()->startOfMonth()->addDays(2)]);
        Tenant::factory()->suspended()->create(['created_at' => now()->startOfMonth()->addDays(3)]);
        Tenant::factory()->suspended()->create(['created_at' => now()->startOfMonth()->subMonths(2)->addDay()]);
        // Outside the 6-month window.
        Tenant::factory()->create(['created_at' => now()->startOfMonth()->subMonths(9)]);

        $growth = $this->dashboard()['tenant_growth'];

        $this->assertCount(6, $growth);
        $this->assertSame(now()->startOfMonth()->subMonths(5)->format('Y-m'), $growth[0]['ym']);

        $byMonth = collect($growth)->keyBy('ym');
        $this->assertSame(2, $byMonth[now()->format('Y-m')]['active']);
        $this->assertSame(1, $byMonth[now()->format('Y-m')]['suspended']);
        $this->assertEquals(3, $byMonth[now()->format('Y-m')]['total']);

        $twoBack = $byMonth[now()->subMonths(2)->format('Y-m')];
        $this->assertSame(0, $twoBack['active']);
        $this->assertSame(1, $twoBack['suspended']);

        $lastMonth = $byMonth[now()->subMonth()->format('Y-m')];
        $this->assertEquals(0, $lastMonth['total']);
    }

    public function test_business_types_use_registry_labels_and_rank_by_count(): void
    {
        Tenant::factory()->count(3)->create(['business_type' => 'mart']);
        Tenant::factory()->create(['business_type' => 'food']);
        Tenant::factory()->create(['business_type' => null]);

        $types = $this->dashboard()['business_types'];

        $this->assertSame('mart', $types[0]['type']);
        $this->assertSame('Mart & Grocery', $types[0]['label']);
        $this->assertSame(3, $types[0]['count']);

        $byType = collect($types)->keyBy(fn (array $t) => $t['type'] ?? 'null');
        $this->assertSame('Food & Restaurant', $byType['food']['label']);
        $this->assertSame('Unspecified', $byType['null']['label']);
        $this->assertSame(5, collect($types)->sum('count'));
    }

    public function test_plans_report_active_tenants_and_attributed_revenue(): void
    {
        $pro = $this->plan('pro', 5000);
        $basic = $this->plan('basic', 1500);
        $unused = $this->plan('unused', 100);

        $a = Tenant::factory()->create(['plan_id' => $pro->id]);
        $b = Tenant::factory()->create(['plan_id' => $pro->id]);
        Tenant::factory()->suspended()->create(['plan_id' => $pro->id]);
        Tenant::factory()->create(['plan_id' => $basic->id]);

        $this->payment($a, $pro, 5000, now()->subDays(2)->toDateTimeString());
        $this->payment($b, $pro, 5000, now()->subDays(3)->toDateTimeString());
        // Attributed to the plan the money was paid for, even though this shop
        // has since moved to Pro.
        $this->payment($a, $basic, 1500, now()->subMonths(2)->toDateTimeString());

        $plans = collect($this->dashboard()['plans'])->keyBy('code');

        $this->assertSame(2, $plans['pro']['active_tenants']); // the suspended shop is excluded
        $this->assertEquals(10000.0, $plans['pro']['revenue']);
        $this->assertSame(1, $plans['basic']['active_tenants']);
        $this->assertEquals(1500.0, $plans['basic']['revenue']);
        $this->assertSame(0, $plans['unused']['active_tenants']);
        $this->assertEquals(0.0, $plans['unused']['revenue']);
        $this->assertSame('Pro Plan', $plans['pro']['name']);
    }

    public function test_a_retired_plan_that_never_did_anything_is_not_a_card(): void
    {
        $live = $this->plan('basic', 2500);
        Tenant::factory()->create(['plan_id' => $live->id]);

        // The combination plans the rebuild retired. Deactivated, no tenants,
        // never took a rupee — a card for it is just something in the way.
        $this->plan('pos-online-delivery')->forceFill(['is_active' => false])->save();

        // But one that still holds a paying tenant is a real obligation and stays.
        $legacy = $this->plan('legacy-pro', 9000);
        $legacy->forceFill(['is_active' => false])->save();
        $held = Tenant::factory()->create(['plan_id' => $legacy->id]);
        $this->payment($held, $legacy, 9000, now()->subDays(3)->toDateTimeString());

        $codes = collect($this->dashboard()['plans'])->pluck('code');

        $this->assertTrue($codes->contains('basic'));
        $this->assertTrue($codes->contains('legacy-pro'));
        $this->assertFalse($codes->contains('pos-online-delivery'));
    }

    public function test_a_bespoke_plan_is_marked_as_one_and_carries_its_price(): void
    {
        $ladder = $this->plan('premium', 6000);
        $bespoke = $this->plan('karahi-house-custom', 22000);
        $bespoke->forceFill(['is_custom' => true])->save();

        Tenant::factory()->create(['plan_id' => $ladder->id]);
        Tenant::factory()->create(['plan_id' => $bespoke->id]);

        $plans = collect($this->dashboard()['plans'])->keyBy('code');

        // A one-off enterprise deal is not a rung on the ladder and must not
        // read as one.
        $this->assertFalse($plans['premium']['is_custom']);
        $this->assertTrue($plans['karahi-house-custom']['is_custom']);
        $this->assertEquals(22000, $plans['karahi-house-custom']['price']);
    }

    public function test_module_adoption_counts_what_shops_actually_run(): void
    {
        Tenant::factory()->create(['features' => ['pos' => true, 'products' => true, 'inventory' => true]]);
        Tenant::factory()->create(['features' => ['pos' => true, 'products' => true]]);
        Tenant::factory()->create(['features' => ['expenses' => true]]);
        // A suspended shop is not running anything; counting it would flatter
        // every share on the panel.
        Tenant::factory()->suspended()->create(['features' => ['pos' => true, 'products' => true, 'fuel' => true]]);

        $modules = collect($this->dashboard()['modules'])->keyBy('key');

        $this->assertSame(2, $modules['pos']['count']);
        $this->assertSame(2, $modules['products']['count']);
        $this->assertSame(1, $modules['inventory']['count']);
        $this->assertSame(1, $modules['expenses']['count']);
        // Nobody runs it. That is a fact the platform should be able to see,
        // not a row to hide.
        $this->assertSame(0, $modules['fuel']['count']);

        $this->assertEquals(66.7, $modules['pos']['share']);
        $this->assertSame('Point of Sale (POS)', $modules['pos']['label']);

        // Ranked, so the panel reads as a league table.
        $counts = collect($this->dashboard()['modules'])->pluck('count')->all();
        $this->assertSame($counts, collect($counts)->sortDesc()->values()->all());
    }

    public function test_recent_payments_return_the_five_latest_with_tenant_and_reference(): void
    {
        $plan = $this->plan('pro');
        $tenant = Tenant::factory()->create(['business_name' => 'Al-Karam Mart', 'plan_id' => $plan->id]);

        foreach (range(1, 6) as $i) {
            $this->payment($tenant, $plan, 1000 * $i, now()->subDays(7 - $i)->toDateTimeString(), [
                'method' => 'bank_transfer',
                'reference' => "INV-100{$i}",
            ]);
        }

        $payments = $this->dashboard()['recent_payments'];

        $this->assertCount(5, $payments);
        $this->assertSame('INV-1006', $payments[0]['reference']); // newest first
        $this->assertSame('Al-Karam Mart', $payments[0]['tenant']);
        $this->assertEquals(6000.0, $payments[0]['amount']);
        $this->assertSame('bank_transfer', $payments[0]['method']);
        $this->assertSame('paid', $payments[0]['status']);
        $this->assertSame('Pro Plan', $payments[0]['plan_name']);
        $this->assertNotNull(Carbon::parse($payments[0]['paid_at']));
        $this->assertSame('INV-1002', $payments[4]['reference']);
    }

    public function test_activity_timeline_carries_real_iso_timestamps(): void
    {
        // Tenant + user writes are audited, so the trail fills itself.
        Tenant::factory()->count(3)->create();

        $activity = $this->dashboard()['activity'];

        $this->assertNotEmpty($activity);
        $this->assertLessThanOrEqual(8, count($activity));

        foreach ($activity as $entry) {
            $this->assertNotNull($entry['at'], 'timeline entry has no timestamp');
            // Anything the UI cannot parse shows as "Invalid Date" — assert the
            // round-trip, not just that a string is present.
            $this->assertSame(
                $entry['at'],
                Carbon::parse($entry['at'])->toIso8601String(),
            );
            $this->assertNotEmpty($entry['actor']);
            $this->assertContains($entry['action'], ['created', 'updated', 'deleted']);
        }

        $latest = AuditLog::query()->latest('created_at')->first();
        $this->assertSame(class_basename($latest->auditable_type), $activity[0]['subject']);
    }

    public function test_activity_names_the_acting_admin(): void
    {
        $plan = $this->plan('pro');
        $this->asAdmin()->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Audited Shop',
            'business_type' => 'mart',
            'plan_id' => $plan->id,
            'owner' => ['name' => 'Owner', 'email' => 'owner@audited.test', 'password' => 'password123'],
        ])->assertCreated();

        $actors = collect($this->dashboard()['activity'])->pluck('actor')->unique();

        $this->assertTrue($actors->contains($this->admin->name));
    }

    public function test_platform_aggregates_span_every_tenant_despite_a_tenant_context(): void
    {
        $plan = $this->plan('pro');
        $customer = User::factory()->create();
        $one = Tenant::factory()->create(['plan_id' => $plan->id]);
        $two = Tenant::factory()->create(['plan_id' => $plan->id]);

        $this->order($one, $customer, now()->toDateTimeString(), 'ORD-000001');
        $this->order($two, $customer, now()->toDateTimeString(), 'ORD-000002');
        Rider::withoutTenancy()->create(['tenant_id' => $one->id, 'name' => 'A']);
        Rider::withoutTenancy()->create(['tenant_id' => $two->id, 'name' => 'B']);

        // A leftover tenant context must not narrow a platform-wide figure.
        app(TenantContext::class)->set($one);

        $kpis = app(DashboardService::class)->forPlatform()['kpis'];

        $this->assertSame(2, $kpis['online_orders_today']['value']);
        $this->assertSame(2, $kpis['active_riders']['value']);
    }

    public function test_empty_platform_returns_the_whole_shape_zeroed(): void
    {
        $data = $this->dashboard();

        $this->assertEquals(0, $data['tenants']['total']);

        foreach (['total_tenants', 'active_subscriptions', 'revenue_this_month',
            'online_orders_today', 'active_riders', 'new_tenants_this_month'] as $key) {
            $this->assertSame(0, (int) $data['kpis'][$key]['value'], "{$key} should be zero");
            $this->assertSame(0, (int) $data['kpis'][$key]['previous'], "{$key} previous should be zero");
            // No baseline, no percentage — and definitely no divide-by-zero.
            $this->assertNull($data['kpis'][$key]['delta_pct'], "{$key} should have no delta");
        }

        $this->assertCount(12, $data['revenue_series']);
        $this->assertEquals(0.0, (float) collect($data['revenue_series'])->sum('total'));

        $this->assertCount(6, $data['tenant_growth']);
        $this->assertEquals(0, collect($data['tenant_growth'])->sum('total'));
        $this->assertSame(0, collect($data['tenant_growth'])->sum('active'));
        $this->assertSame(0, collect($data['tenant_growth'])->sum('suspended'));

        $this->assertSame([], $data['business_types']);
        $this->assertSame([], $data['plans']);
        $this->assertSame([], $data['recent_payments']);
        $this->assertSame([], $data['recent_tenants']);
        $this->assertIsArray($data['activity']);
    }

    public function test_payload_is_a_fixed_number_of_queries_regardless_of_size(): void
    {
        $plans = collect(['pro', 'basic', 'lite'])->map(fn (string $c) => $this->plan($c));
        $customer = User::factory()->create();

        foreach (range(1, 12) as $i) {
            $tenant = Tenant::factory()->create([
                'plan_id' => $plans[$i % 3]->id,
                'business_type' => ['food', 'mart', 'pharmacy', 'retail'][$i % 4],
                'created_at' => now()->subMonths($i % 6)->startOfMonth()->addDay(),
                'subscription_ends_at' => now()->addMonth(),
            ]);
            $this->payment($tenant, $plans[$i % 3], 1000 + $i, now()->subMonths($i % 6)->startOfMonth()->addDays(2)->toDateTimeString());
            $this->order($tenant, $customer, now()->toDateTimeString(), "ORD-{$i}");
            Rider::withoutTenancy()->create(['tenant_id' => $tenant->id, 'name' => "R{$i}"]);
        }

        $service = app(DashboardService::class);
        $service->forPlatform(); // warm any lazily-resolved state

        $queries = 0;
        DB::listen(function () use (&$queries): void {
            $queries++;
        });

        $service->forPlatform();

        // A per-tenant or per-plan query inside a loop would blow straight
        // through this; the whole payload is grouped aggregates.
        $this->assertLessThanOrEqual(20, $queries, "forPlatform() issued {$queries} queries");
    }
}
