<?php

namespace Tests\Feature;

use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Modules;
use App\Support\PlanLimits;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * What a shop pays, and what a shop can do, are two different questions.
 *
 * They used to be one. A plan carried a module map, and assigning it merged
 * that map over the tenant's. Three things followed, and every one of them was
 * a real defect rather than an inconvenience:
 *
 *  1. Every combination of sellable modules needed its own plan. Four seeded
 *     plans were exactly the 2³ combinations of POS × Expenses × Online. A
 *     fifth module would have meant eight plans, a sixth sixteen.
 *  2. A RENEWAL — the most routine billing event there is — silently revoked
 *     any module an admin had granted one shop. Nobody was told. A screen was
 *     simply gone the next morning.
 *  3. Trade modules could not be expressed at all. A plan whose map said
 *     `fuel: false` stripped the forecourt off a petrol pump the instant it was
 *     assigned; a plan that stayed silent left it ungoverned.
 *
 * Now:
 *   plan   → price, period, grace, and the usage it meters (products, storage)
 *   tenant → its business type, the modules it was given, and how big it is
 *            (branches, staff, checkout lanes)
 *
 * These tests hold that line.
 */
class PlansAndModulesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);

        $this->admin = User::factory()->superAdmin()->create();
    }

    // ── A plan grants nothing ────────────────────────────────────────

    public function test_renewing_a_plan_never_revokes_a_module_granted_to_one_shop(): void
    {
        // The bug this whole split exists for. A pharmacy is granted delivery
        // so it can run phone orders; a month later its subscription renews.
        $tenant = $this->shop('pharmacy', ['delivery' => true, 'marketplace' => false]);
        $basic = Plan::query()->where('code', 'basic')->first();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", ['plan_id' => $basic->id])
            ->assertOk();
        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", ['plan_id' => $basic->id])
            ->assertOk();

        $this->assertTrue($tenant->fresh()->featureEnabled('delivery'));
    }

    public function test_a_petrol_pump_keeps_its_forecourt_on_the_cheapest_plan(): void
    {
        // The other half: a plan that named every module could only ever be
        // wrong for a trade it had not heard of.
        $pump = $this->shop('petroleum');
        $this->assertTrue($pump->featureEnabled('fuel'));

        foreach (['basic', 'premium', 'enterprise', 'basic'] as $code) {
            $plan = Plan::query()->where('code', $code)->first();
            $this->asAdmin()->postJson("/api/v1/admin/tenants/{$pump->id}/assign-plan", ['plan_id' => $plan->id])
                ->assertOk();
        }

        $this->assertTrue($pump->fresh()->featureEnabled('fuel'));
    }

    public function test_switching_plans_moves_only_the_ceiling_the_plan_owns(): void
    {
        $tenant = $this->shop('mart');
        $tenant->assignLimits(['staff' => 7]);

        $premium = Plan::query()->where('code', 'premium')->first();
        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", ['plan_id' => $premium->id])
            ->assertOk();

        $fresh = $tenant->fresh();
        $this->assertSame(10000, PlanLimits::limit($fresh, 'products')); // from the plan
        $this->assertSame(7, PlanLimits::limit($fresh, 'staff'));        // from the shop
    }

    // ── Modules are assigned, at creation ────────────────────────────

    public function test_the_admin_picks_the_modules_when_creating_a_business(): void
    {
        // A tyre shop that does not want the cashbook. It is not a different
        // product and it does not need a plan of its own.
        $id = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->payload([
            'business_type' => 'automotive',
            'modules' => ['products' => true, 'services' => true, 'inventory' => true, 'pos' => true, 'expenses' => false],
        ]))->assertCreated()->json('data.id');

        $tenant = Tenant::query()->findOrFail($id);

        $this->assertTrue($tenant->featureEnabled('services'));
        $this->assertTrue($tenant->featureEnabled('inventory'));
        $this->assertFalse($tenant->featureEnabled('expenses'));
    }

    public function test_a_business_type_proposes_modules_when_the_admin_names_none(): void
    {
        $id = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->payload(['business_type' => 'food']))
            ->assertCreated()->json('data.id');

        // Kitchen tickets and tables, because it is a restaurant — not because
        // of anything it pays.
        $this->assertTrue(Tenant::query()->findOrFail($id)->featureEnabled('dine_in'));
    }

    public function test_branches_and_staff_are_assigned_when_the_business_is_created(): void
    {
        $id = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->payload([
            'limits' => ['branches' => 3, 'staff' => 12, 'registers' => 4],
        ]))->assertCreated()->json('data.id');

        $tenant = Tenant::query()->findOrFail($id);

        $this->assertSame(3, PlanLimits::limit($tenant, 'branches'));
        $this->assertSame(12, PlanLimits::limit($tenant, 'staff'));
        $this->assertSame(4, PlanLimits::limit($tenant, 'registers'));
    }

    public function test_a_shop_nobody_sized_gets_the_platform_default_not_infinity(): void
    {
        $id = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->payload())
            ->assertCreated()->json('data.id');

        $tenant = Tenant::query()->findOrFail($id);

        // "As many branches as you like" is how a shop ends up with forty staff
        // accounts and finds out during an audit.
        $this->assertSame(1, PlanLimits::limit($tenant, 'branches'));
        $this->assertSame(5, PlanLimits::limit($tenant, 'staff'));
    }

    public function test_a_second_branch_is_a_number_an_admin_raises_not_a_plan_to_buy(): void
    {
        $tenant = $this->shop('mart');
        $tenant->assignLimits(['branches' => 1]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->login($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg', 'code' => 'GLB'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$tenant->id}/limits", [
            'mode' => 'set', 'limits' => ['branches' => 3],
        ])->assertOk();

        $this->login($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg', 'code' => 'GLB'])
            ->assertCreated();
    }

    public function test_the_refusal_names_the_thing_that_can_actually_be_changed(): void
    {
        $tenant = $this->shop('mart');
        $tenant->assignLimits(['branches' => 1]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $message = $this->login($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg', 'code' => 'GLB'])
            ->assertStatus(422)->json('message');

        // "Upgrade your plan" is useless advice when branches were never on a
        // plan to begin with.
        $this->assertStringNotContainsString('Upgrade your plan', $message);
        $this->assertStringContainsString('branches allowed for your shop', $message);
    }

    // ── The module map stays consistent ──────────────────────────────

    public function test_a_module_whose_dependency_is_off_cannot_be_left_on(): void
    {
        $tenant = $this->shop('mart');

        // Turning off the catalog takes everything built on it with it —
        // rather than leaving a Fuel screen that loads and dies on its first
        // query.
        $tenant->applyModules(['products' => false]);

        $fresh = $tenant->fresh();
        foreach (['inventory', 'marketplace', 'delivery', 'images', 'fuel', 'dine_in'] as $module) {
            $this->assertFalse($fresh->featureEnabled($module), "{$module} should be off without products");
        }
    }

    public function test_ticking_the_online_store_actually_puts_the_shop_online(): void
    {
        // It did not. `sellsOnline()` wants the module AND the denormalised
        // column, and the module toggle only ever wrote the module — so Online
        // Store went on and the shop stayed invisible, with nothing on screen
        // to say why.
        $tenant = $this->shop('pharmacy', ['marketplace' => false]);
        $this->assertFalse($tenant->online_shop_enabled);

        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$tenant->id}/modules", [
            'modules' => ['marketplace' => true],
        ])->assertOk()->assertJsonPath('data.online_shop_enabled', true);

        $this->assertTrue($tenant->fresh()->online_shop_enabled);
    }

    public function test_turning_the_online_store_off_takes_the_shop_off_the_marketplace(): void
    {
        $tenant = $this->shop('mart', ['marketplace' => true]);
        $tenant->forceFill(['setup_completed' => true])->save();

        $this->assertTrue(Tenant::query()->marketplaceVisible()->whereKey($tenant->id)->exists());

        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$tenant->id}/modules", [
            'modules' => ['marketplace' => false],
        ])->assertOk();

        $this->assertFalse(Tenant::query()->marketplaceVisible()->whereKey($tenant->id)->exists());
    }

    public function test_selling_online_forces_product_photos_on(): void
    {
        // An online listing without a photo is a listing nobody buys from.
        $tenant = $this->shop('pharmacy', ['images' => false]);
        $this->assertFalse($tenant->featureEnabled('images'));

        $tenant->applyModules(['marketplace' => true]);

        $this->assertTrue($tenant->fresh()->featureEnabled('images'));
    }

    // ── Plans ────────────────────────────────────────────────────────

    public function test_the_seeded_ladder_differs_only_in_size_and_price(): void
    {
        $plans = $this->asAdmin()->getJson('/api/v1/admin/plans')->assertOk()->json('data');

        $this->assertSame(['basic', 'premium', 'enterprise'], array_column($plans, 'code'));
        $this->assertSame([2500, 6000, 15000], array_map(fn ($p) => (int) $p['price'], $plans));
        $this->assertSame([1000, 10000, null], array_map(fn ($p) => $p['limits']['products'], $plans));

        // Nothing in a plan says what a shop may DO.
        foreach ($plans as $plan) {
            $this->assertArrayNotHasKey('features', $plan);
        }
    }

    public function test_a_custom_plan_sits_below_the_standard_ladder(): void
    {
        // The chain that negotiated its own ceiling. It is an ordinary plan; the
        // flag only keeps the published price list readable.
        $this->asAdmin()->postJson('/api/v1/admin/plans', [
            'name' => 'Metro chain', 'code' => 'metro-chain', 'price' => 40000,
            'billing_period_months' => 12, 'grace_period_days' => 60,
            'max_products' => null, 'is_custom' => true,
        ])->assertCreated()->assertJsonPath('data.is_custom', true);

        $codes = array_column($this->asAdmin()->getJson('/api/v1/admin/plans')->json('data'), 'code');

        $this->assertSame(['basic', 'premium', 'enterprise', 'metro-chain'], $codes);
    }

    public function test_a_plan_cannot_be_given_modules_branches_or_staff(): void
    {
        $this->asAdmin()->postJson('/api/v1/admin/plans', [
            'name' => 'Sneaky', 'code' => 'sneaky', 'price' => 100,
            'billing_period_months' => 1, 'grace_period_days' => 7,
            'features' => ['pos' => true], 'max_branches' => 9, 'max_staff' => 9,
        ])->assertCreated();

        // Silently ignored rather than stored — there is nowhere for them to go.
        $plan = Plan::query()->where('code', 'sneaky')->first();
        $this->assertArrayNotHasKey('features', $plan->getAttributes());
        $this->assertArrayNotHasKey('max_branches', $plan->getAttributes());
    }

    // ── Registry ─────────────────────────────────────────────────────

    public function test_the_module_catalog_carries_groups_and_dependencies(): void
    {
        $catalog = $this->asAdmin()->getJson('/api/v1/admin/modules')->assertOk()->json('data');

        $fuel = collect($catalog)->firstWhere('key', 'fuel');

        $this->assertSame('Trade-specific', $fuel['group']);
        $this->assertSame(['products', 'inventory'], $fuel['depends']);
        $this->assertCount(count(Modules::keys()), $catalog);
    }

    public function test_every_limit_declares_who_owns_it(): void
    {
        // The registry is the single answer to "can an admin change this for
        // one shop, or does it take a different plan?".
        $this->assertSame(['products', 'orders_month', 'storage_mb'], PlanLimits::billedKeys());
        $this->assertSame(['branches', 'staff', 'registers'], PlanLimits::assignedKeys());
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private function shop(string $type, array $modules = []): Tenant
    {
        $tenant = Tenant::factory()->create(['business_type' => $type, 'limits' => null]);
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $type);

        if ($modules !== []) {
            $tenant->applyModules($modules);
        }

        return $tenant->fresh();
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'business_name' => 'Test Business '.uniqid(),
            'business_type' => 'mart',
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'owner' => [
                'name' => 'Owner',
                'email' => uniqid().'@test.com',
                'password' => 'password123',
            ],
        ], $overrides);
    }

    private function asAdmin(): static
    {
        return $this->login($this->admin);
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
