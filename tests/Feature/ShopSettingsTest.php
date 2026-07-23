<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ShopSettingsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->create(['setup_completed' => true, 'business_type' => 'retail']);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_owner_updates_profile_and_delivery_fee(): void
    {
        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop', [
            'business_name' => 'Renamed Store',
            'city_id' => $city->id,
            'address' => 'New Address 123',
            'delivery_fee' => 250,
            'business_hours' => [['day' => 1, 'open' => '09:00', 'close' => '18:00']],
        ])->assertOk()
            ->assertJsonPath('data.business_name', 'Renamed Store')
            ->assertJsonPath('data.delivery_fee', '250.00')
            ->assertJsonPath('data.city.name', 'Karachi');

        // Editing settings does NOT reset setup or business type.
        $this->assertTrue($this->tenant->fresh()->setup_completed);
        $this->assertSame('retail', $this->tenant->fresh()->business_type);
    }

    public function test_invalid_delivery_fee_and_hours_rejected(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop', ['delivery_fee' => -5])
            ->assertStatus(422);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop', [
            'business_hours' => [['day' => 1, 'open' => '18:00', 'close' => '09:00']], // close before open
        ])->assertStatus(422);
    }

    public function test_duplicate_business_name_rejected(): void
    {
        Tenant::factory()->create(['business_name' => 'Taken Name']);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop', ['business_name' => 'Taken Name'])
            ->assertStatus(422);
    }

    public function test_staff_without_settings_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->putJson('/api/v1/shop', ['business_name' => 'Nope'])
            ->assertStatus(403);
    }
}
