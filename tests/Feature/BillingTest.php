<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class BillingTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Plan $onlinePlan;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
        $this->onlinePlan = Plan::query()->where('code', 'business-pos-online')->first();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_assigning_plan_with_payment_records_the_ledger(): void
    {
        $tenant = Tenant::factory()->create();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $this->onlinePlan->id,
            'payment' => ['amount' => 5000, 'method' => 'bank_transfer', 'reference' => 'TXN-99'],
        ])->assertOk();

        $payment = SubscriptionPayment::query()->first();
        $this->assertNotNull($payment);
        $this->assertSame('5000.00', $payment->amount);
        $this->assertSame('bank_transfer', $payment->method);
        $this->assertSame('TXN-99', $payment->reference);
        $this->assertSame($this->admin->id, $payment->recorded_by);
        // Period matches the tenant's new subscription window.
        $this->assertEquals(
            $tenant->fresh()->subscription_ends_at->toDateString(),
            $payment->period_end->toDateString(),
        );
    }

    public function test_same_plan_renewal_stacks_from_current_end_date(): void
    {
        $tenant = Tenant::factory()->create([
            'plan_id' => $this->onlinePlan->id,
            'subscription_starts_at' => now()->subDays(10),
            'subscription_ends_at' => now()->addDays(20),
        ]);

        $before = $tenant->subscription_ends_at->copy();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $this->onlinePlan->id,
            'payment' => ['amount' => 5000],
        ])->assertOk();

        // 1-month plan → new end ≈ old end + 1 month (paid days preserved).
        $newEnd = $tenant->fresh()->subscription_ends_at;
        $this->assertTrue($newEnd->greaterThan($before->copy()->addDays(25)));

        $payment = SubscriptionPayment::query()->first();
        $this->assertEquals($before->toDateString(), $payment->period_start->toDateString());
    }

    public function test_switching_plan_starts_period_now(): void
    {
        $core = Plan::query()->where('code', 'business-pos')->first();
        $tenant = Tenant::factory()->create([
            'plan_id' => $core->id,
            'subscription_ends_at' => now()->addDays(20),
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $this->onlinePlan->id,
            'payment' => ['amount' => 5000],
        ])->assertOk();

        // Different plan → fresh 1-month window from now (~30 days, not 50).
        $this->assertTrue($tenant->fresh()->subscription_ends_at->lessThan(now()->addDays(35)));
    }

    public function test_free_plan_assignment_records_no_payment(): void
    {
        $core = Plan::query()->where('code', 'business-pos')->first(); // price 0
        $tenant = Tenant::factory()->create();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $core->id,
        ])->assertOk();

        $this->assertSame(0, SubscriptionPayment::query()->count());
    }

    public function test_billing_summary_buckets_and_revenue(): void
    {
        $t1 = Tenant::factory()->create(['subscription_ends_at' => now()->addMonth()]);   // active
        $t2 = Tenant::factory()->create(['subscription_ends_at' => now()->addDays(3)]);   // expiring soon
        $t3 = Tenant::factory()->create(['subscription_ends_at' => now()->subDay()]);     // expired

        SubscriptionPayment::query()->create([
            'tenant_id' => $t1->id, 'plan_name' => 'Online', 'amount' => 5000,
            'period_start' => now()->toDateString(), 'period_end' => now()->addMonth()->toDateString(),
            'paid_at' => now(),
        ]);

        $summary = $this->asAdmin()->getJson('/api/v1/admin/billing/summary')
            ->assertOk()
            ->json('data');

        $this->assertEquals(5000, $summary['revenue']['this_month']);
        $this->assertSame(1, $summary['subscriptions']['active']);
        $this->assertSame(1, $summary['subscriptions']['expiring_soon']);
        $this->assertSame(1, $summary['subscriptions']['expired']);
        $this->assertCount(1, $summary['recent_payments']);
    }

    public function test_payments_list_and_tenant_filter(): void
    {
        $tenant = Tenant::factory()->create();
        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $this->onlinePlan->id,
            'payment' => ['amount' => 5000],
        ]);

        $this->asAdmin()->getJson('/api/v1/admin/billing/payments')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)
            ->assertJsonPath('data.0.plan_name', 'Business / POS + Online Business');

        $this->asAdmin()->getJson("/api/v1/admin/billing/payments?tenant_id={$tenant->id}")
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_shop_owner_cannot_access_billing(): void
    {
        $owner = User::factory()->shopOwner()->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/admin/billing/payments')->assertStatus(403);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/admin/billing/summary')->assertStatus(403);
    }
}
