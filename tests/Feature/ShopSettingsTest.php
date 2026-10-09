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

    public function test_what_a_label_carries_is_the_shops_and_comes_back_as_it_was_set(): void
    {
        // Out of the box: the name, the price and the number, on a standard
        // sticker, on a sheet.
        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')->assertOk()
            ->assertJsonPath('data.label_stock', '50x25')
            ->assertJsonPath('data.label_paper', 'sheet')
            ->assertJsonPath('data.label_show_digits', true)
            ->assertJsonPath('data.label_show_shop', false);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'label_stock' => '100x50', 'label_paper' => 'roll',
            'label_show_shop' => true, 'label_show_digits' => false, 'barcode_show_price' => false,
        ])->assertOk();

        $this->actingAsUser($this->owner)->getJson('/api/v1/shop/settings')->assertOk()
            ->assertJsonPath('data.label_stock', '100x50')
            ->assertJsonPath('data.label_paper', 'roll')
            ->assertJsonPath('data.label_show_shop', true)
            ->assertJsonPath('data.label_show_digits', false)
            ->assertJsonPath('data.barcode_show_price', false)
            // What was not sent is as it was.
            ->assertJsonPath('data.label_cut_lines', true);
    }

    public function test_a_sticker_size_nobody_makes_is_refused(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', ['label_stock' => '70x40'])->assertStatus(422);
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', ['label_paper' => 'fanfold'])->assertStatus(422);
    }

    public function test_staff_without_settings_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->putJson('/api/v1/shop', ['business_name' => 'Nope'])
            ->assertStatus(403);
    }
}
