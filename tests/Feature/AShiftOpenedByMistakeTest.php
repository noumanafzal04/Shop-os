<?php

namespace Tests\Feature;

use App\Actions\Fuel\RecordFuelDeliveryAction;
use App\Actions\Sale\CreateSaleAction;
use App\Models\Branch;
use App\Models\City;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A SHIFT OPENED BY MISTAKE, AND NO WAY OUT OF IT.
 *
 * One forecourt, one open shift. The rule is right. Its consequence was
 * not designed: a shift opened in error blocked the whole station, and the
 * only way out was to CLOSE it — which demands a closing reading for every
 * nozzle and a dip for every tank.
 *
 * So the manager who pressed the button at the wrong station had to invent
 * a reconciliation that never happened, and it stayed in the month's fuel
 * report for ever; or leave it open, and lose the night's trading.
 *
 * Cancelling is a way back to EXACTLY the state the forecourt was in a
 * minute ago — nothing more. Most of what follows is the fences that keep
 * it from becoming a way to discard a shift that went badly.
 */
class AShiftOpenedByMistakeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $manager;

    private Product $petrol;

    private FuelTank $tank;

    private FuelNozzle $nozzle;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->station = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'petroleum',
            'features' => BusinessTypes::defaultFeatures('petroleum'),
            'timezone' => 'UTC',
        ]);

        $this->manager = User::factory()
            ->tenantStaff($this->station, ['inventory.manage'])->create(['name' => 'Forecourt Manager']);

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Petrol', 'price' => 268.50, 'cost' => 250,
            'unit' => 'Litre', 'sold_by' => 'weight',
            'track_inventory' => true, 'stock_quantity' => 10000, 'is_active' => true,
        ]);

        $branchId = Branch::withoutTenancy()
            ->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');

        $this->tank = FuelTank::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $branchId,
            'product_id' => $this->petrol->id, 'name' => 'Tank 1',
            'capacity_litres' => 30000, 'current_dip_litres' => 12000,
            'dead_stock_litres' => 0, 'is_active' => true,
        ]);

        $pump = FuelPump::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $branchId,
            'name' => 'Pump 1', 'is_active' => true,
        ]);

        $this->nozzle = FuelNozzle::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $this->tank->id, 'name' => 'A1',
            'current_reading' => 100000, 'is_active' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    /** @param array<string, mixed> $body */
    private function openShift(array $body = []): array
    {
        return $this->as($this->manager)
            ->postJson('/api/v1/fuel/shifts', $body)
            ->assertCreated()->json('data');
    }

    public function test_the_station_is_blocked_until_the_mistake_is_undone(): void
    {
        $this->openShift();

        // The premise: a second shift is refused while the first is open.
        $this->as($this->manager)->postJson('/api/v1/fuel/shifts', [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    public function test_cancelling_frees_the_forecourt(): void
    {
        $shift = $this->openShift();

        $this->as($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel", ['reason' => 'Wrong station'])
            ->assertOk()
            ->assertJsonPath('data.status', ForecourtShift::STATUS_CANCELLED)
            ->assertJsonPath('data.cancel_reason', 'Wrong station');

        // The real shift can now be opened.
        $this->as($this->manager)->postJson('/api/v1/fuel/shifts', [])->assertCreated();
    }

    /**
     * THE METERS GO BACK WHERE THEY WERE.
     *
     * Opening with a keyed figure winds the totaliser forward and overwrites
     * the tank's dip. A cancel that left those moved would leave a reading
     * and a dip no shift accounts for — which is the same leak the whole
     * module exists to detect.
     */
    public function test_a_keyed_opening_is_wound_back(): void
    {
        $shift = $this->openShift([
            'readings' => [['fuel_nozzle_id' => $this->nozzle->id, 'opening_reading' => 100450]],
            'dips' => [['fuel_tank_id' => $this->tank->id, 'opening_dip' => 11800]],
        ]);

        $this->assertEquals(100450, $this->nozzle->fresh()->current_reading);
        $this->assertEquals(11800, $this->tank->fresh()->current_dip_litres);

        $this->as($this->manager)->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")->assertOk();

        $this->assertEquals(100000, $this->nozzle->fresh()->current_reading, 'The totaliser was left wound forward.');
        $this->assertEquals(12000, $this->tank->fresh()->current_dip_litres, 'The tank was left holding a dip nobody took.');
    }

    /**
     * A SHIFT THAT SOLD FUEL IS NOT A MISTAKE.
     *
     * The litres left the ground. Abandoning it would throw away the only
     * record of that, which is exactly the thing a forecourt reconciliation
     * exists to produce.
     */
    public function test_a_shift_that_sold_fuel_cannot_be_abandoned(): void
    {
        $shift = $this->openShift();

        $owner = User::factory()->shopOwner($this->station)->create();
        app(TenantContext::class)->set($this->station);
        auth()->setUser($owner);

        app(CreateSaleAction::class)->execute([
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->petrol->id, 'quantity' => 10]],
            'payment_method' => 'cash',
            'amount_paid' => 5000,
            'created_by' => $owner->id,
        ]);

        $this->as($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_HAS_SALES');

        $this->assertSame(ForecourtShift::STATUS_OPEN, ForecourtShift::withoutTenancy()->find($shift['id'])->status);
    }

    /**
     * A TANKER MOVED THE DIP.
     *
     * Putting the dip back would un-receive fuel the station is holding —
     * and the delivery itself would stay on the books, so the tank and the
     * ledger would disagree by a tanker-load.
     */
    public function test_a_shift_a_tanker_arrived_during_cannot_be_abandoned(): void
    {
        $shift = $this->openShift();

        $owner = User::factory()->shopOwner($this->station)->create();
        app(TenantContext::class)->set($this->station);
        auth()->setUser($owner);

        app(RecordFuelDeliveryAction::class)->execute($owner, [
            'fuel_tank_id' => $this->tank->id,
            'invoiced_litres' => 5000,
            'unit_cost' => 250,
        ]);

        $this->as($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_HAS_DELIVERY');
    }

    /** A reconciled shift is history, and history does not get undone. */
    public function test_a_closed_shift_cannot_be_cancelled(): void
    {
        $shift = $this->openShift();

        $this->as($this->manager)->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
            'readings' => [['fuel_nozzle_id' => $this->nozzle->id, 'closing_reading' => 100000]],
            'dips' => [['fuel_tank_id' => $this->tank->id, 'closing_dip' => 12000]],
        ])->assertOk();

        $this->as($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_NOT_OPEN');
    }

    /**
     * AND ONE THAT PREDATES THE SNAPSHOT CANNOT BE EITHER.
     *
     * A shift opened before the forecourt started recording what the meters
     * read beforehand has nothing to be put back to. A cancel that restored
     * a figure it invented would be worse than no cancel at all.
     */
    public function test_a_shift_with_no_restore_point_is_refused(): void
    {
        $shift = $this->openShift();

        DB::table('forecourt_readings')->where('forecourt_shift_id', $shift['id'])
            ->update(['previous_reading' => null]);

        $this->as($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'FORECOURT_NO_RESTORE_POINT');
    }

    /** A cancelled shift stays on the list — a gap in the numbering is worse. */
    public function test_a_cancelled_shift_is_still_on_the_record(): void
    {
        $shift = $this->openShift();
        $this->as($this->manager)->postJson("/api/v1/fuel/shifts/{$shift['id']}/cancel")->assertOk();

        $numbers = collect($this->as($this->manager)->getJson('/api/v1/fuel/shifts')->assertOk()->json('data'))
            ->pluck('number');

        $this->assertTrue($numbers->contains($shift['number']));
    }
}
