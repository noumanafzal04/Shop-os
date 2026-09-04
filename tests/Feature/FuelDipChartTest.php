<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\ForecourtDip;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A TANK IS DIPPED IN MILLIMETRES.
 *
 * The forecourt shipped asking for a closing dip in LITRES, and a dipstick does
 * not read in litres. An underground cylinder lying on its side holds a wildly
 * different volume per millimetre at the bottom, the middle and the crown, so
 * the station was doing the lookup by hand off a paper chart, in the dark, at
 * the end of a shift — and typing the result into the one number the whole leak
 * detection rests on.
 *
 * The interesting half of this file is what it REFUSES:
 *
 *   - a depth outside the chart is not extrapolated;
 *   - a chart that falls as it deepens is not accepted;
 *   - a tank with no chart cannot be dipped in millimetres at all;
 *   - and litres keep working, because a tank with no chart still has to be
 *     dippable tonight.
 */
class FuelDipChartTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $owner;

    /** Runs the forecourt. inventory.manage, and NOT settings.manage. */
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

        $this->owner = User::factory()->shopOwner($this->station)->create(['name' => 'Owner']);
        $this->manager = User::factory()
            ->tenantStaff($this->station, ['inventory.manage'])->create(['name' => 'Manager']);

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Petrol', 'price' => 200.00, 'unit' => 'Litre', 'sold_by' => 'weight',
            'track_inventory' => true, 'stock_quantity' => 10000, 'is_active' => true,
        ]);

        $this->tank = FuelTank::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'product_id' => $this->petrol->id, 'name' => 'Tank 1',
            'capacity_litres' => 30000, 'current_dip_litres' => 10000,
            'dead_stock_litres' => 0, 'is_active' => true,
        ]);

        $pump = FuelPump::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'name' => 'Pump 1', 'is_active' => true,
        ]);

        $this->nozzle = FuelNozzle::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $this->tank->id, 'name' => 'A1',
            'current_reading' => 100000, 'is_active' => true,
        ]);
    }

    // ── The chart itself ────────────────────────────────────────────

    public function test_a_station_loads_the_chart_that_came_with_its_tank(): void
    {
        $this->chart([[0, 0], [500, 8000], [1000, 20000], [1500, 30000]])->assertOk();

        $this->assertSame(4, $this->tank->dipPoints()->count());
    }

    public function test_a_chart_is_replaced_whole_and_never_merged_into(): void
    {
        // A chart belongs to a physical tank and arrives as one document.
        // Merging would leave a half-corrected chart looking complete, and the
        // tank would be measured against two certificates at different depths
        // with nothing saying so.
        $this->chart([[0, 0], [500, 8000], [1000, 20000]])->assertOk();
        $this->chart([[0, 0], [900, 18000]])->assertOk();

        $this->assertSame([0, 900], $this->tank->dipPoints()->pluck('mm')->map(fn ($m) => (int) $m)->all());
    }

    public function test_an_empty_chart_clears_it_so_a_bad_paste_can_be_undone(): void
    {
        $this->chart([[0, 0], [500, 8000]])->assertOk();
        $this->chart([])->assertOk();

        $this->assertSame(0, $this->tank->dipPoints()->count());
    }

    public function test_a_chart_that_holds_less_as_it_deepens_is_refused(): void
    {
        // The mistake that actually happens: two columns pasted the wrong way
        // round, or a row transcribed out of order. Everything else about the
        // curve belongs to the tank and not to us.
        $this->chart([[0, 0], [500, 20000], [1000, 8000]])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DIP_CHART_NOT_RISING');
    }

    public function test_one_lonely_point_is_refused_because_nothing_can_be_read_between_it(): void
    {
        $this->chart([[500, 8000]])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DIP_CHART_TOO_SHORT');
    }

    public function test_loading_a_chart_needs_settings_and_not_the_right_to_close_a_shift(): void
    {
        // The person who dips a tank at 2am does not get to redefine what its
        // depths mean.
        $this->actingAsUser($this->manager)
            ->putJson("/api/v1/fuel/tanks/{$this->tank->id}/dip-chart", ['points' => []])
            ->assertForbidden();
    }

    public function test_the_tank_list_says_which_tanks_can_be_dipped_in_millimetres(): void
    {
        // Two screens ask this and neither wants the chart itself: the setup
        // form draws "chart loaded", the close screen decides whether to offer
        // a millimetre box. A flag on the tank, counted rather than loaded.
        $before = collect($this->actingAsUser($this->owner)->getJson('/api/v1/fuel/tanks')
            ->assertOk()->json('data'))->firstWhere('id', $this->tank->id);
        $this->assertFalse($before['has_dip_chart']);

        $this->chart([[0, 0], [500, 8000]]);

        $after = collect($this->actingAsUser($this->owner)->getJson('/api/v1/fuel/tanks')
            ->assertOk()->json('data'))->firstWhere('id', $this->tank->id);
        $this->assertTrue($after['has_dip_chart']);
    }

    // ── Reading between the lines ───────────────────────────────────

    public function test_a_depth_on_the_chart_is_the_charted_figure_exactly(): void
    {
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);

        $this->assertSame(8000.0, $this->tank->fresh()->litresAtDip(500));
    }

    public function test_a_depth_between_two_lines_is_read_between_them(): void
    {
        // 750mm is half way from 500 (8,000) to 1000 (20,000) — 14,000. That is
        // what a shop does reading between two lines of the printed table.
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);

        $this->assertSame(14000.0, $this->tank->fresh()->litresAtDip(750));
    }

    public function test_the_curve_is_the_tanks_and_not_a_straight_line_through_it(): void
    {
        // A cylinder on its side gains litres slowly at the bottom, fast in the
        // middle and slowly again at the crown. Interpolating over the WHOLE
        // chart instead of between neighbours would read 750mm as 15,000 here
        // rather than 14,000 — and that difference is a variance the shop would
        // go looking for.
        $this->chart([[0, 0], [500, 8000], [1000, 20000], [1500, 30000]]);
        $tank = $this->tank->fresh();

        $this->assertSame(14000.0, $tank->litresAtDip(750));
        $this->assertSame(4000.0, $tank->litresAtDip(250));
        $this->assertSame(25000.0, $tank->litresAtDip(1250));
    }

    public function test_a_depth_past_the_end_of_the_chart_is_not_guessed_at(): void
    {
        // Extrapolating would invent a volume for a tank nobody has measured
        // that far up. This number is what the leak detection rests on, and a
        // confidently wrong one is worse than a refusal.
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);

        $this->assertNull($this->tank->fresh()->litresAtDip(1400));
    }

    public function test_a_tank_with_no_chart_converts_nothing(): void
    {
        $this->assertNull($this->tank->litresAtDip(500));
        $this->assertFalse($this->tank->hasDipChart());
    }

    // ── Closing a shift on a stick reading ──────────────────────────

    public function test_a_shift_closes_on_millimetres_and_records_both(): void
    {
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);
        $shift = $this->openShift();

        $this->closeWith($shift, ['fuel_tank_id' => $this->tank->id, 'closing_dip_mm' => 750])
            ->assertOk();

        $dip = ForecourtDip::withoutTenancy()->where('forecourt_shift_id', $shift['id'])->firstOrFail();

        $this->assertSame('14000.000', (string) $dip->closing_dip);
        // The reading itself is kept: a derived figure with no record of its
        // source cannot be re-checked months later.
        $this->assertSame(750, $dip->closing_dip_mm);
    }

    public function test_litres_still_work_because_a_tank_with_no_chart_must_still_be_dippable(): void
    {
        $shift = $this->openShift();

        $this->closeWith($shift, ['fuel_tank_id' => $this->tank->id, 'closing_dip' => 9000])
            ->assertOk();

        $dip = ForecourtDip::withoutTenancy()->where('forecourt_shift_id', $shift['id'])->firstOrFail();

        $this->assertSame('9000.000', (string) $dip->closing_dip);
        $this->assertNull($dip->closing_dip_mm);
    }

    public function test_millimetres_on_a_tank_with_no_chart_are_refused_and_say_where_to_go(): void
    {
        $shift = $this->openShift();

        $this->closeWith($shift, ['fuel_tank_id' => $this->tank->id, 'closing_dip_mm' => 750])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NO_DIP_CHART');
    }

    public function test_a_reading_off_the_end_of_the_chart_stops_the_close(): void
    {
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);
        $shift = $this->openShift();

        $this->closeWith($shift, ['fuel_tank_id' => $this->tank->id, 'closing_dip_mm' => 1400])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DIP_OFF_THE_CHART');
    }

    public function test_a_dip_given_both_ways_is_refused_rather_than_one_being_picked(): void
    {
        $this->chart([[0, 0], [500, 8000], [1000, 20000]]);
        $shift = $this->openShift();

        $this->closeWith($shift, [
            'fuel_tank_id' => $this->tank->id, 'closing_dip' => 9000, 'closing_dip_mm' => 750,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'DIP_GIVEN_TWICE');
    }

    public function test_a_dip_that_names_neither_is_still_refused(): void
    {
        // The rule the litres-only version already had, kept: a partial count
        // posted as stock would erase a tank.
        $shift = $this->openShift();

        $this->closeWith($shift, ['fuel_tank_id' => $this->tank->id])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DIP_MISSING');
    }

    // ── Fixtures ────────────────────────────────────────────────────

    /** @param  array<int, array{0: int, 1: float}>  $points */
    private function chart(array $points): TestResponse
    {
        return $this->actingAsUser($this->owner)
            ->putJson("/api/v1/fuel/tanks/{$this->tank->id}/dip-chart", [
                'points' => array_map(fn (array $p): array => ['mm' => $p[0], 'litres' => $p[1]], $points),
            ]);
    }

    /** @return array<string, mixed> */
    private function openShift(): array
    {
        return $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', [])->assertCreated()->json('data');
    }

    /**
     * @param  array<string, mixed>  $shift
     * @param  array<string, mixed>  $dip
     */
    private function closeWith(array $shift, array $dip): TestResponse
    {
        return $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [['fuel_nozzle_id' => $this->nozzle->id, 'closing_reading' => 100500]],
                'dips' => [$dip],
            ]);
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
