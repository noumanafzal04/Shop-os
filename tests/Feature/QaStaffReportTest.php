<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Reproducing the 2026-08-12 QA report against the CURRENT build.
 *
 * Staging is several sessions behind, so a finding there may already be fixed
 * here — and a finding that survives is a real one. This file is the
 * difference between those two, per issue, rather than a guess at either.
 */
class QaStaffReportTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->superAdmin = User::factory()->superAdmin()->create();
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function login(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── QA #1: "server error on the first try, saves on the second" ──

    public function test_creating_platform_staff_works_on_the_first_attempt(): void
    {
        $response = $this->login($this->superAdmin)->postJson('/api/v1/admin/staff', [
            'name' => 'Bilal',
            'email' => 'bilal@shopos.test',
            'password' => 'password123',
            'permissions' => [Permissions::TENANTS_VIEW],
        ]);

        $response->assertCreated();
        $this->assertDatabaseHas('users', ['email' => 'bilal@shopos.test', 'role' => 'admin_staff']);
    }

    public function test_creating_shop_staff_works_on_the_first_attempt(): void
    {
        $response = $this->login($this->owner)->postJson('/api/v1/staff', [
            'name' => 'Sana',
            'email' => 'sana@shop.test',
            'password' => 'password123',
            'permissions' => [Permissions::SALES_MANAGE],
        ]);

        $response->assertCreated();
    }

    /**
     * The most likely shape of "server error the first time".
     *
     * `permissions` is `min:1`, so saving with nothing ticked is a 422 — and
     * the panel renders field errors only inside the modal. If that 422 is
     * what QA saw, the defect is the message, not the save.
     */
    public function test_saving_with_no_permissions_is_a_clean_422_not_a_server_error(): void
    {
        $response = $this->login($this->superAdmin)->postJson('/api/v1/admin/staff', [
            'name' => 'Nobody',
            'email' => 'nobody@shopos.test',
            'password' => 'password123',
            'permissions' => [],
        ]);

        $response->assertStatus(422);
        $this->assertArrayHasKey('permissions', $response->json('errors'));
    }

    public function test_a_duplicate_email_is_a_clean_422_not_a_server_error(): void
    {
        User::factory()->adminStaff()->create(['email' => 'taken@shopos.test']);

        $this->login($this->superAdmin)->postJson('/api/v1/admin/staff', [
            'name' => 'Clash',
            'email' => 'taken@shopos.test',
            'password' => 'password123',
            'permissions' => [Permissions::TENANTS_VIEW],
        ])->assertStatus(422);
    }

    // ── QA #2: "suspend does nothing" ───────────────────────────────

    public function test_suspending_platform_staff_actually_suspends_them(): void
    {
        $staff = User::factory()->adminStaff([Permissions::TENANTS_VIEW])->create();

        $this->login($this->superAdmin)
            ->putJson("/api/v1/admin/staff/{$staff->id}", ['status' => 'suspended'])
            ->assertOk();

        $this->assertSame('suspended', $staff->fresh()->status->value);
    }

    public function test_suspending_shop_staff_actually_suspends_them(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->login($this->owner)
            ->putJson("/api/v1/staff/{$staff->id}", ['status' => 'suspended'])
            ->assertOk();

        $this->assertSame('suspended', $staff->fresh()->status->value);
    }

    public function test_a_suspended_member_of_staff_cannot_sign_in(): void
    {
        // Suspend has to MEAN something. A status column that flips while the
        // person keeps working is worse than no suspend at all.
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])
            ->create(['email' => 'gone@shop.test', 'status' => 'suspended']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'gone@shop.test',
            'password' => 'password',
        ])->assertStatus(403);

        $this->assertNotNull($staff->id);
    }

    public function test_reactivating_works_too(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])
            ->create(['status' => 'suspended']);

        $this->login($this->owner)
            ->putJson("/api/v1/staff/{$staff->id}", ['status' => 'active'])
            ->assertOk();

        $this->assertSame('active', $staff->fresh()->status->value);
    }
}
