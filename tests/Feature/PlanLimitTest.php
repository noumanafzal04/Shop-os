<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
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

    /**
     * A shop with these ceilings. The keys split by owner, exactly as the
     * platform does: max_products / max_storage_mb / max_orders_month are what
     * the PLAN sells, while staff, branches and lanes are ASSIGNED to this shop
     * — so a two-branch business no longer needs a plan of its own.
     */
    private function planWith(array $limits): Plan
    {
        return Plan::query()->create([
            'name' => 'Test Plan',
            'code' => 'test-plan',
            'price' => 0,
            'billing_period_months' => 1,
            'grace_period_days' => 7,
            ...collect($limits)->only(['max_products', 'max_storage_mb', 'max_orders_month'])->all(),
        ]);
    }

    /** The tenant-side half of the same array: max_staff → limits.staff, etc. */
    private function assignedFrom(array $limits): array
    {
        $map = ['max_staff' => 'staff', 'max_branches' => 'branches', 'max_registers' => 'registers'];

        return collect($limits)->only(array_keys($map))
            ->mapWithKeys(fn ($v, $k) => [$map[$k] => $v])->all();
    }

    /** @return array{0: Tenant, 1: User} */
    private function shopOn(Plan $plan, array $assigned = []): array
    {
        $tenant = Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            // The factory is deliberately roomy; a test about a ceiling states
            // its own, so nothing here is inherited by accident.
            'limits' => $assigned ?: null,
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function createProduct(User $owner, string $name): TestResponse
    {
        return $this->login($owner)->postJson('/api/v1/products', [
            'type' => 'product', 'name' => $name, 'price' => 10,
        ]);
    }

    private function createStaff(User $owner, string $name): TestResponse
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
            'billing_period_months' => 1, 'grace_period_days' => 7,
            'max_products' => 50, 'max_storage_mb' => 2048,
        ])
            ->assertCreated()
            ->assertJsonPath('data.limits.products', 50)
            ->assertJsonPath('data.limits.storage_mb', 2048)
            ->assertJsonPath('data.limits.orders_month', null); // omitted = unlimited
    }

    // ── product ceiling ──────────────────────────────────────────────────

    public function test_product_creation_blocked_at_plan_limit(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => 2]), $this->assignedFrom(['max_products' => 2]));

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    public function test_null_limit_is_unlimited(): void
    {
        [, $owner] = $this->shopOn($this->planWith(['max_products' => null]), $this->assignedFrom(['max_products' => null]));

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
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 1]), $this->assignedFrom(['max_products' => 1]));

        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertStatus(422);

        // Admin extends just this tenant past the plan baseline.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => 5],
        ])->assertOk()->assertJsonPath('data.limits.products', 5);

        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')->assertCreated();
    }

    public function test_extend_null_clears_the_override(): void
    {
        [$tenant] = $this->shopOn($this->planWith(['max_products' => 1]), $this->assignedFrom(['max_products' => 1]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => 9],
        ])->assertOk()->assertJsonPath('data.limits.products', 9);

        // Clearing falls back to the plan baseline.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['products' => null],
        ])->assertOk()->assertJsonPath('data.limits', []);
    }

    /**
     * The bug this exists to prevent: the button says "Extend", so an admin
     * raising a 1,000-product tenant by 100 types 100. Absolute mode read that
     * as the new ceiling and cut the shop to 100 — silently.
     */
    public function test_add_mode_raises_the_ceiling_by_the_amount_typed(): void
    {
        [$tenant] = $this->shopOn($this->planWith(['max_products' => 1000]), $this->assignedFrom(['max_products' => 1000]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'add',
            'limits' => ['products' => 100],
        ])->assertOk()->assertJsonPath('data.limits.products', 1100);

        // And again — extending twice compounds, it doesn't overwrite.
        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'add',
            'limits' => ['products' => 50],
        ])->assertOk()->assertJsonPath('data.limits.products', 1150);
    }

    /** A tenant downgrading gives some back. Negative deltas are legitimate. */
    public function test_add_mode_accepts_a_reduction(): void
    {
        [$tenant] = $this->shopOn($this->planWith(['max_products' => 1000]), $this->assignedFrom(['max_products' => 1000]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'add',
            'limits' => ['products' => -400],
        ])->assertOk()->assertJsonPath('data.limits.products', 600);
    }

    /**
     * The other half of the same mistake: whatever the mode, a ceiling can
     * never land below what the shop already has. Otherwise a typo puts a live
     * shop over its limit, and it surfaces days later as "nothing saves".
     */
    public function test_a_limit_can_never_be_set_below_what_is_already_used(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 1000]), $this->assignedFrom(['max_products' => 1000]));
        $this->createProduct($owner, 'One')->assertCreated();
        $this->createProduct($owner, 'Two')->assertCreated();
        $this->createProduct($owner, 'Three')->assertCreated();

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'set',
            'limits' => ['products' => 2],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_BELOW_USAGE');

        // Nothing was written — the shop still has its full ceiling.
        $this->assertNull($tenant->fresh()->limits);
    }

    public function test_adding_to_an_unlimited_resource_is_refused_rather_than_inventing_a_ceiling(): void
    {
        // No max_products on the plan = unlimited.
        [$tenant] = $this->shopOn($this->planWith([]), $this->assignedFrom([]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'add',
            'limits' => ['products' => 100],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ALREADY_UNLIMITED');
    }

    public function test_the_snapshot_separates_the_baseline_from_what_was_granted(): void
    {
        [$tenant] = $this->shopOn($this->planWith(['max_products' => 1000]), $this->assignedFrom(['max_products' => 1000]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'add',
            'limits' => ['products' => 100],
        ])->assertOk();

        $usage = collect(
            $this->login($this->admin)->getJson("/api/v1/admin/tenants/{$tenant->id}")
                ->assertOk()->json('data.limits_usage'),
        )->firstWhere('key', 'products');

        // "1,100" alone can't tell an admin whether that's the plan or
        // something a colleague granted last March.
        $this->assertSame(1100, $usage['limit']);
        $this->assertSame(1000, $usage['baseline']);
        $this->assertSame(100, $usage['extra']);
        $this->assertSame('plan', $usage['owner']);
        $this->assertTrue($usage['assigned']);
    }

    public function test_extend_rejects_unknown_limit_key(): void
    {
        [$tenant] = $this->shopOn($this->planWith(['max_products' => 1]), $this->assignedFrom(['max_products' => 1]));

        $this->login($this->admin)->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'limits' => ['bananas' => 5],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['limits']]);
    }

    // ── staff ceiling ────────────────────────────────────────────────────

    public function test_staff_limit_enforced_and_extendable(): void
    {
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_staff' => 1]), $this->assignedFrom(['max_staff' => 1]));

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
        [$tenant, $owner] = $this->shopOn($this->planWith(['max_products' => 10]), $this->assignedFrom(['max_products' => 10]));
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
