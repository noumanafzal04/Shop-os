<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * PLANT ADDED WHILE A SHIFT IS RUNNING INVENTS TWO ACCUSATIONS.
 *
 * A forecourt shift snapshots the equipment at the moment it opens: one
 * `forecourt_readings` row per live nozzle, one `forecourt_dips` row per tank.
 * The close walks THOSE rows. Anything that appeared afterwards is invisible
 * to it.
 *
 * Editing and deleting plant mid-shift is already refused, for exactly this
 * reason. ADDING was not — and adding is worse than either, because the two
 * figures the whole module exists to keep apart both move, in opposite
 * directions, and each one lands on a different person:
 *
 *   TANK VARIANCE goes UP.   The new hose's litres never enter `meter_litres`,
 *                            so `book` stays high while the dip shows the fuel
 *                            gone. Reads as a leak in the ground.
 *   UNBILLED goes NEGATIVE.  The till DID ring those sales, so `pos_litres`
 *                            counts them while `litres_sold` does not. Reads
 *                            as the counter selling fuel no meter moved.
 *
 * A hole in a tank and a cashier's hand are chased by different people on
 * different days. One missing guard makes the module accuse both at once, on a
 * night when nothing happened but a fitter adding a hose.
 */
class ForecourtPlantChangedMidShiftTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $owner;

    private Product $petrol;

    private FuelTank $petrolTank;

    private FuelPump $pump;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Sahiwal', 'is_active' => true]);
        $this->station = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'petroleum',
            'features' => BusinessTypes::defaultFeatures('petroleum'),
            'timezone' => 'UTC',
        ]);

        $this->owner = User::factory()->shopOwner($this->station)->create(['name' => 'Owner']);

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Petrol', 'price' => 268.50, 'cost' => 250,
            'unit' => 'Litre', 'sold_by' => 'weight',
            'track_inventory' => true, 'stock_quantity' => 10000, 'is_active' => true,
        ]);

        $this->petrolTank = FuelTank::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'product_id' => $this->petrol->id, 'name' => 'Tank 1',
            'capacity_litres' => 30000, 'current_dip_litres' => 10000,
            'dead_stock_litres' => 0, 'is_active' => true,
        ]);

        $this->pump = FuelPump::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'name' => 'Pump 1', 'is_active' => true,
        ]);

        FuelNozzle::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'fuel_pump_id' => $this->pump->id,
            'fuel_tank_id' => $this->petrolTank->id, 'name' => 'A1',
            'current_reading' => 100000, 'is_active' => true,
        ]);
    }

    public function test_a_nozzle_cannot_be_added_while_a_shift_is_open(): void
    {
        $this->openShift();

        $this->actingAsOwner()
            ->postJson("/api/v1/fuel/pumps/{$this->pump->id}/nozzles", [
                'name' => 'A2',
                'fuel_tank_id' => $this->petrolTank->id,
                'current_reading' => 0,
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    public function test_a_tank_cannot_be_added_while_a_shift_is_open(): void
    {
        $this->openShift();

        $this->actingAsOwner()
            ->postJson('/api/v1/fuel/tanks', [
                'name' => 'Tank 2',
                'product_id' => $this->petrol->id,
                'capacity_litres' => 20000,
                'current_dip_litres' => 5000,
                'dead_stock_litres' => 0,
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    public function test_a_pump_cannot_be_added_while_a_shift_is_open(): void
    {
        $this->openShift();

        $this->actingAsOwner()
            ->postJson('/api/v1/fuel/pumps', ['name' => 'Pump 2'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    /**
     * THE DENOMINATOR. With no shift open all three must still succeed —
     * otherwise the three cases above would pass against a forecourt that
     * simply refuses everything, which is not a fix.
     */
    public function test_plant_can_still_be_added_when_no_shift_is_open(): void
    {
        $this->actingAsOwner()
            ->postJson('/api/v1/fuel/tanks', [
                'name' => 'Tank 2', 'product_id' => $this->petrol->id,
                'capacity_litres' => 20000, 'current_dip_litres' => 5000, 'dead_stock_litres' => 0,
            ])->assertCreated();

        $pump = $this->actingAsOwner()
            ->postJson('/api/v1/fuel/pumps', ['name' => 'Pump 2'])
            ->assertCreated()->json('data.id');

        $this->actingAsOwner()
            ->postJson("/api/v1/fuel/pumps/{$pump}/nozzles", [
                'name' => 'B1', 'fuel_tank_id' => $this->petrolTank->id, 'current_reading' => 0,
            ])->assertCreated();
    }

    private function openShift(): void
    {
        $this->actingAsOwner()->postJson('/api/v1/fuel/shifts', [])->assertCreated();
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');
    }

    private function actingAsOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
