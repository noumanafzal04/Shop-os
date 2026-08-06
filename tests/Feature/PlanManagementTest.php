<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class PlanManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Pro Plan',
            'code' => 'pro-plan',
            'description' => 'Everything, unlimited.',
            'price' => 9999,
            'billing_period_months' => 1,
            'grace_period_days' => 7,
            'max_products' => 5000,
        ], $overrides);
    }

    public function test_super_admin_creates_a_plan(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/plans', $this->payload())
            ->assertCreated()
            ->assertJsonPath('data.code', 'pro-plan')
            ->assertJsonPath('data.limits.products', 5000)
            // A plan is a price and a ceiling. It grants no capability, so
            // there is nothing here that a renewal could revoke.
            ->assertJsonPath('data.is_custom', false);

        $this->assertDatabaseHas('plans', ['code' => 'pro-plan', 'price' => 9999]);
    }

    public function test_duplicate_code_rejected(): void
    {
        Plan::query()->create($this->payload());

        $this->asAdmin()->postJson('/api/v1/admin/plans', $this->payload(['name' => 'Other']))
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['code']]);
    }

    public function test_update_changes_price_and_status(): void
    {
        $plan = Plan::query()->create($this->payload());

        $this->asAdmin()->putJson("/api/v1/admin/plans/{$plan->id}", [
            'price' => 12000, 'is_active' => false,
        ])->assertOk()
            ->assertJsonPath('data.price', '12000.00')
            ->assertJsonPath('data.is_active', false);
    }

    public function test_deactivated_plan_cannot_be_assigned_to_a_tenant(): void
    {
        $plan = Plan::query()->create($this->payload(['is_active' => false]));
        $tenant = Tenant::factory()->create();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $plan->id,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PLAN_INACTIVE');
    }

    public function test_delete_unused_plan_succeeds(): void
    {
        $plan = Plan::query()->create($this->payload());

        $this->asAdmin()->deleteJson("/api/v1/admin/plans/{$plan->id}")->assertOk();
        $this->assertDatabaseMissing('plans', ['id' => $plan->id]);
    }

    public function test_cannot_delete_plan_assigned_to_tenants(): void
    {
        $plan = Plan::query()->create($this->payload());
        Tenant::factory()->create(['plan_id' => $plan->id]);

        $this->asAdmin()->deleteJson("/api/v1/admin/plans/{$plan->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'PLAN_IN_USE');

        $this->assertDatabaseHas('plans', ['id' => $plan->id]);
    }

    public function test_index_includes_tenant_counts(): void
    {
        $plan = Plan::query()->create($this->payload());
        Tenant::factory()->count(2)->create(['plan_id' => $plan->id]);

        $data = $this->asAdmin()->getJson('/api/v1/admin/plans')->assertOk()->json('data');
        $created = collect($data)->firstWhere('code', 'pro-plan');
        $this->assertSame(2, $created['tenants_count']);
    }

    public function test_platform_staff_cannot_write_plans(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();
        $token = $staff->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        // Can read…
        $this->withToken($token)->getJson('/api/v1/admin/plans')->assertOk();
        // …but not create.
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/admin/plans', $this->payload())->assertStatus(403);
    }

    public function test_shop_owner_cannot_access_plan_admin(): void
    {
        $owner = User::factory()->shopOwner()->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->postJson('/api/v1/admin/plans', $this->payload())->assertStatus(403);
    }
}
