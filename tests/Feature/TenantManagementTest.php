<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class TenantManagementTest extends TestCase
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

    public function withToken(string $token, string $type = 'Bearer'): static
    {
        $this->app['auth']->forgetGuards();

        return parent::withToken($token, $type);
    }

    private function asAdmin(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->admin);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function tenantPayload(array $overrides = []): array
    {
        return array_merge([
            'business_name' => 'Karachi General Store',
            'email' => 'store@test.com',
            'phone' => '+923000000001',
            'business_type' => 'grocery',
            'business_category' => 'grocery',
            'owner' => [
                'name' => 'Ali Khan',
                'email' => 'ali@test.com',
                'password' => 'password123',
            ],
        ], $overrides);
    }

    // ── Create ──────────────────────────────────────────────────────

    public function test_admin_creates_tenant_with_owner_atomically(): void
    {
        $response = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload());

        $response->assertCreated()
            ->assertJsonPath('data.business_name', 'Karachi General Store')
            ->assertJsonPath('data.online_shop_enabled', false);

        $this->assertDatabaseHas('users', [
            'email' => 'ali@test.com',
            'role' => UserRole::ShopOwner->value,
            'tenant_id' => $response->json('data.id'),
        ]);
    }

    public function test_create_with_plan_sets_subscription_and_online_flag(): void
    {
        $plan = Plan::query()->where('code', 'business-pos-online')->first();

        $response = $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload([
            'plan_id' => $plan->id,
        ]));

        $response->assertCreated()
            ->assertJsonPath('data.online_shop_enabled', true)
            ->assertJsonPath('data.plan.code', 'business-pos-online');

        $this->assertNotNull($response->json('data.subscription_ends_at'));
    }

    public function test_duplicate_business_name_rejected(): void
    {
        Tenant::factory()->create(['business_name' => 'Karachi General Store']);

        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload())
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'VALIDATION_ERROR')
            ->assertJsonStructure(['errors' => ['business_name']]);
    }

    public function test_duplicate_tenant_email_and_phone_rejected(): void
    {
        Tenant::factory()->create(['email' => 'store@test.com', 'phone' => '+923000000001']);

        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload())
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['email', 'phone']]);
    }

    public function test_duplicate_owner_email_rejected(): void
    {
        User::factory()->create(['email' => 'ali@test.com']);

        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload())
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['owner.email']]);
    }

    public function test_deleted_tenants_name_can_be_reused(): void
    {
        $old = Tenant::factory()->create(['business_name' => 'Karachi General Store']);
        $old->delete();

        $this->asAdmin()->postJson('/api/v1/admin/tenants', $this->tenantPayload())
            ->assertCreated();
    }

    public function test_owner_requires_email_or_phone(): void
    {
        $payload = $this->tenantPayload();
        unset($payload['owner']['email']);

        $this->asAdmin()->postJson('/api/v1/admin/tenants', $payload)
            ->assertStatus(422);
    }

    // ── Authorization ───────────────────────────────────────────────

    public function test_non_admin_cannot_access_tenant_management(): void
    {
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->app['auth']->forgetGuards();

        $this->actingAs($owner)->getJson('/api/v1/admin/tenants')
            ->assertStatus(403);
    }

    public function test_unauthenticated_cannot_access_tenant_management(): void
    {
        $this->getJson('/api/v1/admin/tenants')->assertStatus(401);
    }

    // ── Suspend / Activate ──────────────────────────────────────────

    public function test_suspend_revokes_all_tenant_user_sessions_immediately(): void
    {
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create(['email' => 'owner@test.com']);

        $tokens = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com', 'password' => 'password',
        ])->json('data');

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/suspend")
            ->assertOk()
            ->assertJsonPath('data.status', 'suspended');

        // Owner's existing token is dead NOW.
        $this->withToken($tokens['access_token'])
            ->getJson('/api/v1/auth/me')
            ->assertStatus(401);

        // And fresh logins are blocked.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com', 'password' => 'password',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'TENANT_SUSPENDED');
    }

    public function test_suspend_twice_conflicts(): void
    {
        $tenant = Tenant::factory()->suspended()->create();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/suspend")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'TENANT_ALREADY_SUSPENDED');
    }

    public function test_activate_restores_login(): void
    {
        $tenant = Tenant::factory()->suspended()->create();
        User::factory()->shopOwner($tenant)->create(['email' => 'owner@test.com']);

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/activate")
            ->assertOk()
            ->assertJsonPath('data.status', 'active');

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com', 'password' => 'password',
        ])->assertOk();
    }

    // ── Delete / Restore ────────────────────────────────────────────

    public function test_delete_is_soft_and_blocks_owner(): void
    {
        $tenant = Tenant::factory()->create();
        User::factory()->shopOwner($tenant)->create(['email' => 'owner@test.com']);

        $this->asAdmin()->deleteJson("/api/v1/admin/tenants/{$tenant->id}")->assertOk();

        // Data preserved (soft delete).
        $this->assertSoftDeleted('tenants', ['id' => $tenant->id]);

        // Owner blocked with precise reason.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com', 'password' => 'password',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'TENANT_DELETED');
    }

    public function test_deleted_tenant_can_be_restored(): void
    {
        $tenant = Tenant::factory()->create();
        $tenant->delete();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/restore")
            ->assertOk();

        $this->assertNull($tenant->fresh()->deleted_at);
    }

    // ── Plan assignment ─────────────────────────────────────────────

    public function test_upgrade_to_online_shop_plan(): void
    {
        $tenant = Tenant::factory()->create();
        $plan = Plan::query()->where('code', 'business-pos-online')->first();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $plan->id,
        ])->assertOk()->assertJsonPath('data.online_shop_enabled', true);
    }

    public function test_downgrade_disables_online_shop_but_preserves_data(): void
    {
        $tenant = Tenant::factory()->onlineShop()->create();
        $expenseOnly = Plan::query()->where('code', 'business-pos')->first();

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $expenseOnly->id,
        ])->assertOk()->assertJsonPath('data.online_shop_enabled', false);

        // Tenant row (and everything hanging off it) still exists.
        $this->assertDatabaseHas('tenants', ['id' => $tenant->id, 'deleted_at' => null]);
    }

    public function test_plan_drives_pos_and_online_modules(): void
    {
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Widget', 'price' => 100, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
        $ringSale = fn () => $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ]);

        // Online Business plan → POS module OFF, online ON.
        $online = Plan::query()->where('code', 'online-business')->first();
        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", ['plan_id' => $online->id])
            ->assertOk()->assertJsonPath('data.online_shop_enabled', true);
        $this->assertFalse($tenant->fresh()->featureEnabled('pos'));
        $ringSale()->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        $this->actingAsUser($owner)->getJson('/api/v1/pos/session')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        // Business/POS plan → POS module ON, online OFF (can't sell online).
        $pos = Plan::query()->where('code', 'business-pos')->first();
        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", ['plan_id' => $pos->id])
            ->assertOk()->assertJsonPath('data.online_shop_enabled', false);
        $this->assertTrue($tenant->fresh()->featureEnabled('pos'));
        $this->assertFalse($tenant->fresh()->featureEnabled('marketplace'));
        $ringSale()->assertCreated();
    }

    public function test_inactive_plan_cannot_be_assigned(): void
    {
        $tenant = Tenant::factory()->create();
        $plan = Plan::query()->where('code', 'business-pos')->first();
        $plan->update(['is_active' => false]);

        $this->asAdmin()->postJson("/api/v1/admin/tenants/{$tenant->id}/assign-plan", [
            'plan_id' => $plan->id,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PLAN_INACTIVE');
    }

    // ── Listing ─────────────────────────────────────────────────────

    public function test_list_is_paginated_and_searchable(): void
    {
        Tenant::factory()->count(3)->create();
        Tenant::factory()->create(['business_name' => 'Findable Mart']);

        $response = $this->asAdmin()->getJson('/api/v1/admin/tenants?search=Findable');

        $response->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)
            ->assertJsonPath('data.0.business_name', 'Findable Mart');
    }

    public function test_list_filters_by_status(): void
    {
        Tenant::factory()->count(2)->create();
        Tenant::factory()->suspended()->create();

        $this->asAdmin()->getJson('/api/v1/admin/tenants?status=suspended')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_plans_endpoint_lists_the_three_plans(): void
    {
        $response = $this->asAdmin()->getJson('/api/v1/admin/plans');

        $response->assertOk();
        $this->assertCount(3, $response->json('data'));
    }

    public function test_public_cities_endpoint(): void
    {
        \App\Models\City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        \App\Models\City::query()->create(['name' => 'Hidden City', 'is_active' => false]);

        $response = $this->getJson('/api/v1/cities');

        $response->assertOk();
        $this->assertCount(1, $response->json('data'));
    }
}
