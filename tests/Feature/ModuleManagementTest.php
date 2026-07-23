<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ModuleManagementTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
        $this->tenant = Tenant::factory()->create([
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
    }

    private function asAdmin(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->admin);
    }

    public function test_module_catalog_lists_manageable_modules(): void
    {
        $data = $this->asAdmin()->getJson('/api/v1/admin/modules')->assertOk()->json('data');
        $keys = collect($data)->pluck('key');
        $this->assertTrue($keys->contains('marketplace'));
        $this->assertTrue($keys->contains('inventory'));
    }

    public function test_admin_toggles_a_tenant_module(): void
    {
        $this->assertTrue($this->tenant->featureEnabled('marketplace'));

        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$this->tenant->id}/modules", [
            'modules' => ['marketplace' => false, 'reservations' => false],
        ])->assertOk()->assertJsonPath('data.features.marketplace', false);

        $fresh = $this->tenant->fresh();
        $this->assertFalse($fresh->featureEnabled('marketplace'));
        $this->assertFalse($fresh->featureEnabled('reservations'));
        // Untouched flags preserved.
        $this->assertTrue($fresh->featureEnabled('inventory'));
    }

    public function test_disabling_marketplace_hides_shop(): void
    {
        $this->tenant->forceFill(['online_shop_enabled' => true, 'setup_completed' => true])->save();
        $this->assertTrue($this->tenant->fresh()->sellsOnline());

        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$this->tenant->id}/modules", [
            'modules' => ['marketplace' => false],
        ])->assertOk();

        $this->assertFalse($this->tenant->fresh()->sellsOnline());
    }

    public function test_unknown_module_rejected(): void
    {
        $this->asAdmin()->putJson("/api/v1/admin/tenants/{$this->tenant->id}/modules", [
            'modules' => ['teleport' => true],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['modules']]);
    }

    public function test_shop_owner_cannot_manage_modules(): void
    {
        $owner = User::factory()->shopOwner($this->tenant)->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($owner)->putJson("/api/v1/admin/tenants/{$this->tenant->id}/modules", [
            'modules' => ['marketplace' => false],
        ])->assertForbidden();
    }
}
