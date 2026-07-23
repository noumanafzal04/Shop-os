<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class AuditLogTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_tenant_lifecycle_actions_are_audited_with_actor(): void
    {
        $admin = User::factory()->superAdmin()->create();
        $plan = \App\Models\Plan::query()->where('code', 'business-pos')->first();

        $tenant = $this->actingAsUser($admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Audited Mart',
            'business_type' => 'grocery',
            'plan_id' => $plan->id,
            'owner' => ['name' => 'O', 'email' => 'o@audit.test', 'password' => 'password123'],
        ])->json('data');

        // suspend → produces an 'updated' audit row with the status change.
        $this->actingAsUser($admin)->postJson("/api/v1/admin/tenants/{$tenant['id']}/suspend");

        // Find the specific row that recorded the status change (several
        // 'updated' rows can share a timestamp, so don't rely on ordering).
        $suspendLog = AuditLog::query()
            ->where('auditable_type', Tenant::class)
            ->where('auditable_id', $tenant['id'])
            ->where('event', 'updated')
            ->get()
            ->first(fn (AuditLog $log) => isset($log->new_values['status']));

        $this->assertNotNull($suspendLog);
        $this->assertSame($admin->id, $suspendLog->user_id); // WHO did it
        $this->assertSame('suspended', $suspendLog->new_values['status']);
        $this->assertSame('active', $suspendLog->old_values['status']);
    }

    public function test_secrets_are_never_written_to_the_audit_log(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $this->actingAsUser($admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Secret Mart',
            'business_type' => 'grocery',
            'owner' => ['name' => 'O', 'email' => 'secret@audit.test', 'password' => 'password123'],
        ]);

        $userLogs = AuditLog::query()->where('auditable_type', User::class)->get();

        $this->assertNotEmpty($userLogs);
        foreach ($userLogs as $log) {
            $this->assertArrayNotHasKey('password', $log->new_values ?? []);
            $this->assertArrayNotHasKey('remember_token', $log->new_values ?? []);
        }
    }

    public function test_super_admin_can_read_audit_trail(): void
    {
        $admin = User::factory()->superAdmin()->create();
        Tenant::factory()->create(['business_name' => 'Trace Co']);

        $response = $this->actingAsUser($admin)->getJson('/api/v1/admin/audit-logs')
            ->assertOk();

        $this->assertNotEmpty($response->json('data'));
        $this->assertArrayHasKey('entity', $response->json('data.0'));
    }

    public function test_platform_staff_cannot_read_audit_trail(): void
    {
        $staff = User::factory()->adminStaff([\App\Support\Permissions::TENANTS_VIEW])->create();

        $this->actingAsUser($staff)->getJson('/api/v1/admin/audit-logs')->assertStatus(403);
    }
}
