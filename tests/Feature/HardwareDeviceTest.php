<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\HardwareDevice;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Hardware registry: the shop configures its peripherals (printers, scanner,
 * cash drawer). At most one default per type; type is fixed after creation.
 */
class HardwareDeviceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function add(array $overrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/hardware-devices', array_merge([
            'type' => 'receipt_printer',
            'name' => 'Front counter',
            'connection_type' => 'browser',
        ], $overrides));
    }

    public function test_owner_can_register_a_device(): void
    {
        $res = $this->add([
            'brand' => 'XPrinter', 'model' => 'XP-80', 'connection_type' => 'usb',
            'settings' => ['paper_size' => '80mm', 'cut_paper' => true],
        ])->assertCreated()->json('data');

        $this->assertSame('XPrinter', $res['brand']);
        $this->assertSame('80mm', $res['settings']['paper_size']);
        $this->assertSame(1, HardwareDevice::withoutTenancy()->where('tenant_id', $this->tenant->id)->count());
    }

    public function test_only_one_default_per_type(): void
    {
        $a = $this->add(['name' => 'Printer A', 'is_default' => true])->assertCreated()->json('data');
        $b = $this->add(['name' => 'Printer B', 'is_default' => true])->assertCreated()->json('data');

        $this->assertFalse((bool) HardwareDevice::withoutTenancy()->find($a['id'])->is_default);
        $this->assertTrue((bool) HardwareDevice::withoutTenancy()->find($b['id'])->is_default);
    }

    public function test_a_default_of_a_different_type_is_untouched(): void
    {
        $printer = $this->add(['type' => 'receipt_printer', 'name' => 'Printer', 'is_default' => true])->assertCreated()->json('data');
        $scanner = $this->add(['type' => 'barcode_scanner', 'name' => 'Scanner', 'is_default' => true])->assertCreated()->json('data');

        // Different types → both stay default.
        $this->assertTrue((bool) HardwareDevice::withoutTenancy()->find($printer['id'])->is_default);
        $this->assertTrue((bool) HardwareDevice::withoutTenancy()->find($scanner['id'])->is_default);
    }

    public function test_type_cannot_be_changed_on_update(): void
    {
        $d = $this->add()->assertCreated()->json('data');

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/hardware-devices/{$d['id']}", ['type' => 'barcode_scanner'])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['type']]);
    }

    public function test_owner_can_update_and_delete_a_device(): void
    {
        $d = $this->add()->assertCreated()->json('data');

        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/hardware-devices/{$d['id']}", ['name' => 'Back office', 'is_default' => true])
            ->assertOk()->assertJsonPath('data.name', 'Back office');

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/hardware-devices/{$d['id']}")
            ->assertOk();

        $this->assertNull(HardwareDevice::withoutTenancy()->find($d['id']));
    }

    public function test_an_invalid_type_is_rejected(): void
    {
        $this->add(['type' => 'teleporter'])
            ->assertStatus(422)
            ->assertJsonStructure(['errors' => ['type']]);
    }
}
