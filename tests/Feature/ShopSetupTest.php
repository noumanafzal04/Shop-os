<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ShopSetupTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private City $city;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->create(['setup_completed' => false]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;

        return $this->withToken($token);
    }

    public function withToken(string $token, string $type = 'Bearer'): static
    {
        $this->app['auth']->forgetGuards();

        return parent::withToken($token, $type);
    }

    // ── Setup ───────────────────────────────────────────────────────

    public function test_owner_completes_setup_with_required_fields(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_type' => 'grocery', 'business_category' => 'grocery',
            'city_id' => $this->city->id,
        ])->assertOk()
            ->assertJsonPath('data.setup_completed', true)
            ->assertJsonPath('data.city.name', 'Karachi');
    }

    public function test_setup_requires_city(): void
    {
        // Type/category are admin-set; the owner only needs to pick a city.
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['city_id']]);
    }

    public function test_inactive_city_rejected(): void
    {
        $hidden = City::query()->create(['name' => 'Hidden', 'is_active' => false]);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_type' => 'grocery', 'business_category' => 'grocery',
            'city_id' => $hidden->id,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['city_id']]);
    }

    public function test_invalid_coordinates_rejected(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_type' => 'grocery', 'business_category' => 'grocery',
            'city_id' => $this->city->id,
            'latitude' => 123.0, // out of range
            'longitude' => 67.0,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['latitude']]);
    }

    public function test_latitude_without_longitude_rejected(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/setup', [
            'business_type' => 'grocery', 'business_category' => 'grocery',
            'city_id' => $this->city->id,
            'latitude' => 24.86,
        ])->assertStatus(422);
    }

    public function test_staff_without_settings_permission_cannot_setup(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->putJson('/api/v1/shop/setup', [
            'business_type' => 'grocery', 'business_category' => 'grocery',
            'city_id' => $this->city->id,
        ])->assertStatus(403);
    }

    public function test_customer_cannot_reach_shop_endpoints(): void
    {
        $customer = User::factory()->create(); // role customer

        $this->actingAsUser($customer)->getJson('/api/v1/shop')->assertStatus(403);
        $this->actingAsUser($customer)->getJson('/api/v1/dashboard')->assertStatus(403);
    }

    public function test_shop_profile_returns_own_tenant(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop')
            ->assertOk()
            ->assertJsonPath('data.id', $this->tenant->id);
    }

    // ── Logo upload ─────────────────────────────────────────────────

    public function test_logo_upload_stores_file_and_replaces_old(): void
    {
        Storage::fake('public');

        $first = $this->actingAsUser($this->owner)->post('/api/v1/shop/logo', [
            'logo' => UploadedFile::fake()->image('logo.png', 400, 400),
        ], ['Accept' => 'application/json']);

        $first->assertOk();
        $firstPath = $first->json('data.logo_path');
        Storage::disk('public')->assertExists($firstPath);

        // Replacing deletes the old file.
        $second = $this->actingAsUser($this->owner)->post('/api/v1/shop/logo', [
            'logo' => UploadedFile::fake()->image('new.jpg', 300, 300),
        ], ['Accept' => 'application/json']);

        $second->assertOk();
        Storage::disk('public')->assertMissing($firstPath);
        Storage::disk('public')->assertExists($second->json('data.logo_path'));
    }

    public function test_invalid_file_type_rejected(): void
    {
        Storage::fake('public');

        $this->actingAsUser($this->owner)->post('/api/v1/shop/logo', [
            'logo' => UploadedFile::fake()->create('malware.pdf', 100, 'application/pdf'),
        ], ['Accept' => 'application/json'])->assertStatus(422);
    }

    public function test_oversized_image_rejected(): void
    {
        Storage::fake('public');

        $this->actingAsUser($this->owner)->post('/api/v1/shop/logo', [
            'logo' => UploadedFile::fake()->image('huge.png')->size(4096), // 4 MB
        ], ['Accept' => 'application/json'])->assertStatus(422);
    }

    // ── Dashboards ──────────────────────────────────────────────────

    public function test_tenant_dashboard_returns_stable_empty_contract(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.setup_completed', false)
            ->assertJsonPath('data.today.sales_count', 0)
            ->assertJsonPath('data.today.revenue', 0)
            ->assertJsonPath('data.today.profit', 0)
            ->assertJsonPath('data.low_stock_count', 0)
            ->assertJsonStructure(['data' => [
                'setup_completed', 'online_shop_enabled', 'subscription_expired',
                'today' => ['sales_count', 'revenue', 'expenses', 'profit'],
                'pending_orders', 'pending_reservations', 'low_stock_count', 'products_count',
            ]]);
    }

    public function test_admin_dashboard_counts_tenants(): void
    {
        $admin = User::factory()->superAdmin()->create();
        Tenant::factory()->count(2)->create();          // + setUp tenant = 3 active
        Tenant::factory()->suspended()->create();       // 1 suspended
        Tenant::factory()->onlineShop()->create();      // 1 online (active)

        $response = $this->actingAsUser($admin)->getJson('/api/v1/admin/dashboard');

        $response->assertOk()
            ->assertJsonPath('data.tenants.total', 5)
            ->assertJsonPath('data.tenants.active', 4)
            ->assertJsonPath('data.tenants.suspended', 1)
            ->assertJsonPath('data.tenants.online_shops', 1);

        $this->assertCount(5, $response->json('data.recent_tenants'));
    }

    public function test_shop_owner_cannot_access_admin_dashboard(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/admin/dashboard')
            ->assertStatus(403);
    }
}
