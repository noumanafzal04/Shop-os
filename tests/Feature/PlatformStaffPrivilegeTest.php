<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Platform staff are hired for different jobs.
 *
 * They are given an explicit permission list precisely so that the person who
 * schedules banner ads is not also a finance person. The billing endpoints were
 * gated on ROLE alone, so every one of them could read the whole platform's
 * revenue — and the admin dashboard printed this month's takings on the landing
 * page regardless.
 *
 * A gate on the endpoint that the screen routes around is a decorative gate,
 * which is why the dashboard's contents are asserted here too.
 */
class PlatformStaffPrivilegeTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);

        $this->superAdmin = User::factory()->superAdmin()->create();

        $plan = Plan::query()->where('code', 'basic')->firstOrFail();
        $tenant = Tenant::factory()->create(['plan_id' => $plan->id]);

        SubscriptionPayment::query()->create([
            'tenant_id' => $tenant->id,
            'plan_id' => $plan->id,
            'plan_name' => $plan->name,
            'amount' => 2500,
            'method' => 'cash',
            'period_start' => now()->subMonth()->toDateString(),
            'period_end' => now()->toDateString(),
            'paid_at' => now()->subDays(2),
        ]);
    }

    private function asUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function bannerStaff(): User
    {
        return User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();
    }

    private function financeStaff(): User
    {
        return User::factory()->adminStaff([Permissions::BILLING_VIEW])->create();
    }

    // ── The ledger ──────────────────────────────────────────────────

    public function test_a_banner_scheduler_cannot_read_the_revenue_ledger(): void
    {
        $this->asUser($this->bannerStaff())
            ->getJson('/api/v1/admin/billing/payments')
            ->assertForbidden();
    }

    public function test_a_banner_scheduler_cannot_read_the_billing_summary(): void
    {
        $this->asUser($this->bannerStaff())
            ->getJson('/api/v1/admin/billing/summary')
            ->assertForbidden();
    }

    public function test_a_finance_staffer_can(): void
    {
        $this->asUser($this->financeStaff())
            ->getJson('/api/v1/admin/billing/summary')
            ->assertOk()
            ->assertJsonPath('data.revenue.all_time', 2500);
    }

    public function test_a_super_admin_holds_everything_by_role(): void
    {
        $this->asUser($this->superAdmin)
            ->getJson('/api/v1/admin/billing/payments')
            ->assertOk();
    }

    // ── The screen the gate could be routed around ──────────────────

    public function test_the_dashboard_withholds_the_money_from_staff_without_billing_view(): void
    {
        $response = $this->asUser($this->bannerStaff())
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk();

        // Absent, not zero. A zero is an answer, and the wrong one.
        $this->assertArrayNotHasKey('revenue_this_month', $response->json('data.kpis'));
        $this->assertArrayNotHasKey('revenue_series', $response->json('data'));
        $this->assertArrayNotHasKey('recent_payments', $response->json('data'));

        // The plans panel carried takings per plan alongside the tenant counts.
        // Stripping the headline figure while a table underneath still added up
        // to it would be the appearance of a gate rather than a gate.
        foreach ($response->json('data.plans') as $plan) {
            $this->assertArrayNotHasKey('revenue', $plan);
            // The plan's PRICE stays: that is the product list, not the
            // platform's takings, and it is on the public pricing page anyway.
            $this->assertArrayHasKey('price', $plan);
        }
    }

    public function test_the_dashboard_still_loads_for_them(): void
    {
        // /admin lands here. A home page that 403s is not a permission model,
        // it is a locked front door — so the screen stays, minus the money.
        $this->asUser($this->bannerStaff())
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk()
            ->assertJsonStructure(['data' => ['tenants', 'kpis', 'plans', 'modules']]);
    }

    public function test_the_dashboard_shows_the_money_to_staff_who_may_see_it(): void
    {
        $response = $this->asUser($this->financeStaff())
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk();

        $this->assertArrayHasKey('revenue_this_month', $response->json('data.kpis'));
        $this->assertArrayHasKey('revenue_series', $response->json('data'));
    }

    public function test_a_super_admin_sees_the_money_without_holding_the_permission(): void
    {
        $response = $this->asUser($this->superAdmin)
            ->getJson('/api/v1/admin/dashboard')
            ->assertOk();

        $this->assertArrayHasKey('revenue_this_month', $response->json('data.kpis'));
    }

    // ── The permission is offered where staff are created ───────────

    public function test_billing_view_is_assignable_to_platform_staff(): void
    {
        // A permission the staff screen cannot offer is a permission nobody
        // holds — the shape of half the defects in this codebase.
        $this->asUser($this->superAdmin)
            ->getJson('/api/v1/admin/staff/permissions')
            ->assertOk()
            ->assertJsonFragment([Permissions::BILLING_VIEW])
            ->assertJsonFragment([Permissions::TENANTS_RESET_PASSWORD]);
    }
}
