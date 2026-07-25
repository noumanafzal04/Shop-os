<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Flexible limit-based plans: a plan defines baseline ceilings, a tenant can be
 * EXTENDED past them individually, and creating past the effective ceiling is
 * blocked with LIMIT_REACHED. NULL limit = unlimited.
 */
class PlanLimitTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function planWith(array $limits): Plan
    {
        return Plan::query()->create([
            'name' => 'Test Plan',
            'code' => 'test-plan',
            'price' => 0,
            'billing_period_months' => 1,
            'online_shop_enabled' => true,
            'grace_period_days' => 7,
            ...$limits,
        ]);
    }

    /** @return array{0: Tenant, 1: User} */
    private function shopOn(Plan $plan): array
    {
        $tenant = Tenant::factory()->provisioned()->create(['plan_id' => $plan->id]);
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function createProduct(User $owner, string $name): \Illuminate\Testing\TestResponse
    {
        return $this->login($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => $name, 'price' => 10,
        ]);
    }

    private function createStaff(User $owner, string $name): \Illuminate\Testing\TestResponse
    {
        return $this->login($owner)->postJson('/api/v1/staff', [
            'name' => $name,
            'email' => strtolower($name).'@shop.test',
            'password' => 'password123',
            'permissions' => [Permissions::tenant()[0]],
        ]);
    }

    // ── plan config ──────────────────────────────────────────────────────

    public function test_plan_create_stores_and_returns_limits(): void
    {
        $this->login($this->admin)->postJson('/api/v1/admin/plans', [
            'name' => 'Limited', 'code' => 'limited', 'price' => 500,
            'billing_period_months' => 1, 'online_shop_enabled' => false, 'grace_period_days' => 7,
            'max_products' => 50, 'max_staff' => 3, 'max_branches' => 2,
        ])
            ->assertCreated()
            ->assertJsonPath('data.limits.products', 50)
            ->assertJsonPath('data.limits.staff', 3)
            ->assertJsonPath('data.limits.branches', 2)
            ->assertJsonPath('data.limits.orders_month', null); // omitted = unlimited
    }

    // ── product ceiling ──────────────────────────────────────────────────

    public function test_product_creation_blocked_at_plan_limit(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => 2]));

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    public function test_null_limit_is_unlimited(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => null]));

        foreach (['A', 'B', 'C', 'D', 'E'] as $name) {
            $this->createProduct($owner, $name)->assertCreated();
        }
    }

    public function test_tenant_without_a_plan_is_unrestricted(): void
    {
        $tenant = Tenant::factory()->provisioned()->create(['plan_id' => null]);
        $owner = User::factory()->shopOwner($tenant)->create();

        foreach (['A', 'B', 'C'] as $name) {
            $this->createProduct($owner, $name)->assertCreated();
        }
    }

    // ── per-tenant extend ────────────────────────────────────────────────

    public function test_per_tenant_extend_lifts_the_ceiling(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 1]));

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertStatus(422);

        // Admin extends just this tenant past the plan baseline.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => 5],
        ])->assertOk()->assertJsonPath('data.limit_overrides.products', 5);

        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')->assertCreated();
    }

    public function test_extend_null_clears_the_override(): void
    {
        [$tenant, ] = $this->shopOn($this->planWith(['max_products' => 1]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => 9],
        ])->assertOk()->assertJsonPath('data.limit_overrides.products', 9);

        // Clearing falls back to the plan baseline.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => null],
        ])->assertOk()->assertJsonPath('data.limit_overrides', []);
    }

    public function test_extend_rejects_unknown_limit_key(): void
    {
        [$tenant, ] = $this->shopOn($this->planWith(['max_products' => 1]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['bananas' => 5],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['limits']]);
    }

    // ── staff ceiling ────────────────────────────────────────────────────

    public function test_staff_limit_enforced_and_extendable(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_staff' => 1]));

        $this->createStaff($owner, 'Aisha')->assertCreated();
        $this->createStaff($owner, 'Bilal')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['staff' => 3],
        ])->assertOk();

        $this->createStaff($owner, 'Bilal')->assertCreated();
    }

    // ── usage snapshot ───────────────────────────────────────────────────

    public function test_tenant_detail_exposes_usage_vs_limit(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 10]));
        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();

        $usage = collect(
            $this->login($this->admin)->getJson("/api/v1/admin/tenants/{$tenant->id}")
                ->assertOk()
                ->json('data.limits_usage'),
        )->firstWhere('key', 'products');

        $this->assertSame(10, $usage['limit']);
        $this->assertSame(2, $usage['used']);
        $this->assertSame(8, $usage['remaining']);
        $this->assertFalse($usage['unlimited']);
    }
}
