<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class StaffManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        // Creating a tenant needs a plan to put it on.
        $this->seed(PlanSeeder::class);
    }

    private function actingAsUser(User $user): static
    {
        // Real bearer token — identical to how production clients authenticate.
        $token = $user->createToken('test-device', ['access'])->plainTextToken;

        return $this->withToken($token);
    }

    // ── Platform staff (admin side) ─────────────────────────────────

    public function test_super_admin_creates_platform_staff_with_permissions(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $this->actingAsUser($admin)->postJson('/api/v1/admin/staff', [
            'name' => 'Platform Helper',
            'email' => 'helper@shopos.test',
            'password' => 'password123',
            'permissions' => [Permissions::TENANTS_VIEW, Permissions::TENANTS_SUSPEND],
        ])->assertCreated()
            ->assertJsonPath('data.role', 'admin_staff')
            ->assertJsonPath('data.permissions', [Permissions::TENANTS_VIEW, Permissions::TENANTS_SUSPEND]);
    }

    public function test_platform_staff_with_view_permission_can_list_tenants(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();
        Tenant::factory()->count(2)->create();

        $this->actingAsUser($staff)->getJson('/api/v1/admin/tenants')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2);
    }

    public function test_platform_staff_without_create_permission_cannot_create_tenant(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Nope Mart',
            'owner' => ['name' => 'X', 'email' => 'x@x.com', 'password' => 'password123'],
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_DENIED');
    }

    public function test_platform_staff_with_create_permission_can_create_tenant(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_CREATE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Allowed Mart',
            'business_type' => 'mart',
            'plan_id' => Plan::query()->where('code', 'basic')->value('id'),
            'owner' => ['name' => 'X', 'email' => 'x@x.com', 'password' => 'password123'],
        ])->assertCreated();
    }

    public function test_platform_staff_cannot_manage_staff_without_permission(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/admin/staff')
            ->assertStatus(403);
    }

    public function test_staff_cannot_escalate_permissions_beyond_their_own(): void
    {
        $staff = User::factory()->adminStaff([
            Permissions::PLATFORM_STAFF_MANAGE, Permissions::TENANTS_VIEW,
        ])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/admin/staff', [
            'name' => 'Sneaky',
            'email' => 'sneaky@shopos.test',
            'password' => 'password123',
            // requests tenants.delete which the actor does NOT hold
            'permissions' => [Permissions::TENANTS_DELETE],
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_ESCALATION');
    }

    public function test_invalid_permission_key_rejected(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $this->actingAsUser($admin)->postJson('/api/v1/admin/staff', [
            'name' => 'X',
            'email' => 'x@shopos.test',
            'password' => 'password123',
            'permissions' => ['products.manage'], // tenant-scope key on platform endpoint
        ])->assertStatus(422);
    }

    public function test_shop_owner_cannot_access_admin_endpoints(): void
    {
        $owner = User::factory()->shopOwner()->create();

        $this->actingAsUser($owner)->getJson('/api/v1/admin/staff')->assertStatus(403);
        $this->actingAsUser($owner)->getJson('/api/v1/admin/tenants')->assertStatus(403);
    }

    // ── Tenant staff (shop side) ────────────────────────────────────

    public function test_shop_owner_creates_tenant_staff(): void
    {
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->actingAsUser($owner)->postJson('/api/v1/staff', [
            'name' => 'Cashier Ahmed',
            'email' => 'ahmed@shop.test',
            'password' => 'password123',
            'permissions' => [Permissions::SALES_MANAGE, Permissions::PRODUCTS_MANAGE],
        ])->assertCreated()
            ->assertJsonPath('data.role', 'staff')
            ->assertJsonPath('data.permissions.0', Permissions::SALES_MANAGE);

        // Staff belongs to the owner's tenant automatically.
        $this->assertDatabaseHas('users', [
            'email' => 'ahmed@shop.test',
            'tenant_id' => $tenant->id,
        ]);
    }

    public function test_tenant_staff_login_works_and_carries_permissions(): void
    {
        $tenant = Tenant::factory()->create();
        User::factory()->tenantStaff($tenant, [Permissions::SALES_MANAGE])
            ->create(['email' => 'staff@shop.test']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'staff@shop.test', 'password' => 'password',
        ])->assertOk()
            ->assertJsonPath('data.user.role', 'staff')
            ->assertJsonPath('data.user.permissions.0', Permissions::SALES_MANAGE);
    }

    public function test_owner_sees_only_own_tenant_staff(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();
        $ownerA = User::factory()->shopOwner($tenantA)->create();
        User::factory()->tenantStaff($tenantA)->count(2)->create();
        User::factory()->tenantStaff($tenantB)->count(3)->create();

        $this->actingAsUser($ownerA)->getJson('/api/v1/staff')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2);
    }

    public function test_owner_cannot_touch_other_tenants_staff(): void
    {
        $tenantA = Tenant::factory()->create();
        $tenantB = Tenant::factory()->create();
        $ownerA = User::factory()->shopOwner($tenantA)->create();
        $staffB = User::factory()->tenantStaff($tenantB)->create();

        $this->actingAsUser($ownerA)->getJson("/api/v1/staff/{$staffB->id}")
            ->assertStatus(404); // scoped query — other tenant's staff invisible

        $this->actingAsUser($ownerA)->deleteJson("/api/v1/staff/{$staffB->id}")
            ->assertStatus(404);
    }

    public function test_staff_without_staff_manage_cannot_manage_staff(): void
    {
        $tenant = Tenant::factory()->create();
        $staff = User::factory()->tenantStaff($tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/staff')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_DENIED');
    }

    public function test_staff_with_staff_manage_can_list_but_not_escalate(): void
    {
        $tenant = Tenant::factory()->create();
        $manager = User::factory()->tenantStaff($tenant, [
            Permissions::STAFF_MANAGE, Permissions::SALES_MANAGE,
        ])->create();

        $this->actingAsUser($manager)->getJson('/api/v1/staff')->assertOk();

        $this->actingAsUser($manager)->postJson('/api/v1/staff', [
            'name' => 'New Guy',
            'email' => 'new@shop.test',
            'password' => 'password123',
            'permissions' => [Permissions::EXPENSES_MANAGE], // manager doesn't hold this
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_ESCALATION');
    }

    public function test_suspending_staff_revokes_sessions_immediately(): void
    {
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create();
        $staff = User::factory()->tenantStaff($tenant, [Permissions::SALES_MANAGE])
            ->create(['email' => 'staff@shop.test']);

        $tokens = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'staff@shop.test', 'password' => 'password',
        ])->json('data');

        $this->actingAsUser($owner)->putJson("/api/v1/staff/{$staff->id}", [
            'status' => 'suspended',
        ])->assertOk();

        $this->app['auth']->forgetGuards();
        $this->withToken($tokens['access_token'])->getJson('/api/v1/auth/me')->assertStatus(401);
    }

    public function test_cannot_suspend_or_delete_self(): void
    {
        $tenant = Tenant::factory()->create();
        $manager = User::factory()->tenantStaff($tenant, [Permissions::STAFF_MANAGE])->create();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$manager->id}", [
            'status' => 'suspended',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'SELF_SUSPENSION');

        $this->actingAsUser($manager)->deleteJson("/api/v1/staff/{$manager->id}")
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'SELF_DELETION');
    }

    public function test_permission_catalogs_are_exposed(): void
    {
        $admin = User::factory()->superAdmin()->create();
        $owner = User::factory()->shopOwner()->create();

        // Each console offers its own scope, and offers it labelled — a bare
        // key match would pass on the slug alone and say nothing about whether
        // the form can explain the box it is drawing.
        $this->actingAsUser($admin)->getJson('/api/v1/admin/staff/permissions')
            ->assertOk()
            ->assertJsonFragment(['key' => Permissions::TENANTS_VIEW, 'label' => 'View tenants', 'hint' => null]);

        $this->actingAsUser($owner)->getJson('/api/v1/staff/permissions')
            ->assertOk()
            ->assertJsonFragment(['key' => Permissions::SALES_MANAGE, 'label' => 'Sales & invoices', 'hint' => null]);
    }

    public function withToken(string $token, string $type = 'Bearer'): static
    {
        $this->app['auth']->forgetGuards();

        return parent::withToken($token, $type);
    }

    // ── Taking over an account is an escalation too ─────────────────
    //
    // The permission guard was complete about permissions and blind about
    // identity. A manager who could not TICK a box could set the password of
    // somebody who already had it ticked, sign in as them, and be done. Email
    // and phone are the same door — login is by either, so moving a colleague's
    // address to one you control hands you their next one-time code.

    /** @return array{0: Tenant, 1: User, 2: User} shop, manager, the better-privileged colleague */
    private function shopWithAManagerAndACashier(): array
    {
        $tenant = Tenant::factory()->create();

        $manager = User::factory()->tenantStaff($tenant, [
            Permissions::STAFF_MANAGE, Permissions::SALES_MANAGE,
        ])->create();

        // Holds something the manager deliberately does not.
        $cashier = User::factory()->tenantStaff($tenant, [
            Permissions::SALES_MANAGE, Permissions::REPORTS_VIEW,
        ])->create();

        return [$tenant, $manager, $cashier];
    }

    public function test_a_manager_cannot_set_the_password_of_someone_who_can_do_more_than_they_can(): void
    {
        [, $manager, $cashier] = $this->shopWithAManagerAndACashier();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$cashier->id}", [
            'password' => 'iknowthisone',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_ESCALATION');
    }

    public function test_a_manager_cannot_move_that_persons_email_to_one_they_control(): void
    {
        // The quieter half. No password is changed and nothing looks unusual —
        // the next one-time code simply arrives somewhere else.
        [, $manager, $cashier] = $this->shopWithAManagerAndACashier();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$cashier->id}", [
            'email' => 'manager-controls-this@test.com',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_ESCALATION');
    }

    public function test_a_manager_cannot_move_that_persons_phone_either(): void
    {
        [, $manager, $cashier] = $this->shopWithAManagerAndACashier();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$cashier->id}", [
            'phone' => '03001234567',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_ESCALATION');
    }

    public function test_a_manager_may_still_reset_the_password_of_somebody_who_can_do_less(): void
    {
        // The half that keeps this usable. A guard that refuses every reset
        // makes the manager useless and gets switched off — and resetting the
        // password of someone whose permissions you already hold gains nothing
        // you did not have.
        $tenant = Tenant::factory()->create();
        $manager = User::factory()->tenantStaff($tenant, [
            Permissions::STAFF_MANAGE, Permissions::SALES_MANAGE,
        ])->create();
        $junior = User::factory()->tenantStaff($tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$junior->id}", [
            'password' => 'newpassword1',
        ])->assertOk();
    }

    public function test_a_manager_may_still_fix_their_ow_n_details(): void
    {
        // Changing your own password is not taking anybody over.
        $tenant = Tenant::factory()->create();
        $manager = User::factory()->tenantStaff($tenant, [
            Permissions::STAFF_MANAGE, Permissions::SALES_MANAGE,
        ])->create();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$manager->id}", [
            'password' => 'mynewpassword',
        ])->assertOk();
    }

    public function test_the_owner_may_reset_anybodys_password(): void
    {
        // The owner holds every permission implicitly, so there is nothing for
        // them to acquire — and being locked out of their own shop's accounts
        // would be the guard causing the outage it exists to prevent.
        $tenant = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($tenant)->create();
        $cashier = User::factory()->tenantStaff($tenant, [
            Permissions::SALES_MANAGE, Permissions::REPORTS_VIEW,
        ])->create();

        $this->actingAsUser($owner)->putJson("/api/v1/staff/{$cashier->id}", [
            'password' => 'ownerknowsbest',
        ])->assertOk();
    }

    public function test_a_change_that_touches_no_credential_is_left_alone(): void
    {
        // Renaming somebody is not taking them over, and a guard that fires on
        // every edit is a guard nobody keeps.
        [, $manager, $cashier] = $this->shopWithAManagerAndACashier();

        $this->actingAsUser($manager)->putJson("/api/v1/staff/{$cashier->id}", [
            'name' => 'Corrected Spelling',
        ])->assertOk();
    }
}
