<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A petrol pump is the one business CartZe serves where the till is the LAST
 * thing to hear what was sold.
 *
 * Fuel leaves through a meter into a customer's tank whether or not anybody
 * rings it up, so the forecourt is run off two independent measurements and the
 * entire job is comparing them:
 *
 *   METER (closing − opening, less test litres)  what went into vehicles.
 *   DIP   (book vs actual)                       what is left in the ground.
 *
 * These tests exist to keep those two apart. Collapse them into a single
 * "variance" and the owner can no longer tell an attendant pocketing cash from
 * a hole in a tank — two problems chased by different people with very
 * different consequences.
 */
class FuelManagementTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $owner;

    /** Runs the forecourt: opens and closes shifts, no purchasing rights. */
    private User $manager;

    private Product $petrol;

    private Product $diesel;

    private FuelTank $petrolTank;

    private FuelTank $dieselTank;

    private FuelNozzle $nozzleA;

    private FuelNozzle $nozzleB;

    private FuelNozzle $dieselNozzle;

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
            ->tenantStaff($this->station, ['inventory.manage'])->create(['name' => 'Forecourt Manager']);

        $this->petrol = $this->fuelProduct('Petrol', 268.50, litres: 10000);
        $this->diesel = $this->fuelProduct('High Speed Diesel', 276.00, litres: 5000);

        $this->petrolTank = $this->tank('Tank 1 — Petrol', $this->petrol, capacity: 30000, dip: 10000);
        $this->dieselTank = $this->tank('Tank 2 — Diesel', $this->diesel, capacity: 20000, dip: 5000);

        $pump = FuelPump::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'name' => 'Pump 1', 'is_active' => true,
        ]);

        $this->nozzleA = $this->nozzle($pump, 'A1', $this->petrolTank, reading: 100000);
        $this->nozzleB = $this->nozzle($pump, 'A2', $this->petrolTank, reading: 50000);
        $this->dieselNozzle = $this->nozzle($pump, 'B1', $this->dieselTank, reading: 20000);
    }

    // ── Set up the way the panel sets up ────────────────────────────

    /**
     * The forecourt this test class builds by hand is not the forecourt a
     * station has.
     *
     * Every fixture above attaches `branch_id` explicitly — and the panel's own
     * setup form does not send it, because a single-site station has nothing to
     * pick from. So the tank was stored with a null branch, while opening a
     * shift resolved a missing branch to Main and looked for equipment THERE.
     * Two halves answering the same question in opposite directions, with the
     * result that a station which configured its forecourt through the UI was
     * told to "set up at least one tank and one nozzle" immediately after doing
     * exactly that, for ever.
     *
     * Twenty-five tests passed throughout, because every one of them supplied
     * the field the real client omits. This one goes through the HTTP endpoints
     * with the panel's payload and nothing else.
     */
    public function test_a_forecourt_built_through_the_api_without_a_branch_can_still_open_a_shift(): void
    {
        $petrol = $this->fuelProduct('Panel Petrol', 268.50, litres: 8000);

        // The panel's exact tank payload — note what is absent.
        $tank = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/tanks', [
                'name' => 'Panel Tank',
                'product_id' => $petrol->id,
                'capacity_litres' => 20000,
                'current_dip_litres' => 8000,
                'dead_stock_litres' => 0,
            ])
            ->assertCreated()
            ->json('data');

        $this->assertSame(
            $this->branchId(),
            FuelTank::withoutTenancy()->find($tank['id'])->branch_id,
            'A tank created without a branch must still stand at one, or no shift will ever find it.',
        );

        $pump = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/pumps', ['name' => 'Panel Pump'])
            ->assertCreated()
            ->json('data');

        $this->assertSame(
            $this->branchId(),
            FuelPump::withoutTenancy()->find($pump['id'])->branch_id,
        );

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/fuel/pumps/{$pump['id']}/nozzles", [
                'name' => 'P1',
                'fuel_tank_id' => $tank['id'],
                'current_reading' => 1000,
            ])
            ->assertCreated();

        // The equipment built above is enough on its own: this station is
        // opened with no branch named, exactly as the panel opens it.
        FuelTank::withoutTenancy()->whereIn('id', [
            $this->petrolTank->id, $this->dieselTank->id,
        ])->update(['is_active' => false]);

        $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', ['notes' => 'first shift'])
            ->assertCreated();
    }

    // ── The module gate ─────────────────────────────────────────────

    /**
     * A TANK WITHOUT A CAPACITY IS NOT PROTECTED FROM OVERFILLING.
     *
     * `capacity_litres` is `sometimes` on the request and defaults to 0 in the
     * column, and the gate that turns a tanker away reads
     * `capacity_litres > 0 && …`. So a tank created without one is not a tank
     * with an unknown capacity — it is a tank with **no gate at all**, and the
     * refusal this module exists for is silently absent.
     *
     * Found by `scripts/untested-absence.py`: all three of a tank's numbers are
     * supplied by the only test that creates one, so their absence was a branch
     * nobody had driven down.
     *
     * A capacity is not paperwork. Every physical tank has one, the whole
     * forecourt reconciles against it, and a station that does not know it
     * cannot be told a delivery will not fit.
     */
    public function test_a_tank_cannot_be_installed_without_saying_how_much_it_holds(): void
    {
        $petrol = $this->fuelProduct('Petrol', 272, 0);

        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/tanks', [
            'name' => 'Tank 9', 'product_id' => $petrol->id,
        ])->assertStatus(422)->assertJsonValidationErrors('capacity_litres');

        // With a capacity it goes in, and the gate it feeds now has something
        // to compare against.
        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/tanks', [
            'name' => 'Tank 9', 'product_id' => $petrol->id, 'capacity_litres' => 20000,
        ])->assertCreated();
    }

    /**
     * A NOZZLE WITHOUT ITS METER READING BOOKS THE METER'S WHOLE LIFE AS ONE DAY.
     *
     * `current_reading` is `sometimes` and the column defaults to 0. A pump
     * installed mid-life has a totaliser already reading, say, 482,000 — and a
     * nozzle carded without it starts at nought. The first shift then opens at
     * nought, closes at 482,050, and the forecourt books **the meter's entire
     * lifetime as that shift's sales**.
     *
     * That is the disaster `OpenForecourtShiftAction` already names in its own
     * comment — *"discovering at close that the shift 'sold' 400,000 litres"* —
     * reached by a different road. It guards a typed opening below the stored
     * reading, and cannot guard a stored reading that was never taken.
     */
    public function test_a_nozzle_cannot_be_carded_without_saying_where_its_meter_stands(): void
    {
        $petrol = $this->fuelProduct('Petrol', 272, 0);
        $tank = $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/tanks', [
            'name' => 'Tank 1', 'product_id' => $petrol->id, 'capacity_litres' => 20000,
        ])->assertCreated()->json('data.id');

        $pump = $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/pumps', [
            'name' => 'Pump 1',
        ])->assertCreated()->json('data.id');

        $this->actingAsUser($this->owner)->postJson("/api/v1/fuel/pumps/{$pump}/nozzles", [
            'name' => 'N1', 'fuel_tank_id' => $tank,
        ])->assertStatus(422)->assertJsonValidationErrors('current_reading');

        // Zero is a perfectly good answer for a brand-new pump — the rule is
        // that somebody has to SAY so, not that it cannot be nought.
        $this->actingAsUser($this->owner)->postJson("/api/v1/fuel/pumps/{$pump}/nozzles", [
            'name' => 'N1', 'fuel_tank_id' => $tank, 'current_reading' => 0,
        ])->assertCreated();
    }

    public function test_fuel_is_a_petroleum_module_and_off_for_everyone_else(): void
    {
        $this->assertTrue(BusinessTypes::defaultFeatures('petroleum')['fuel'] ?? false);

        foreach (['food', 'mart', 'pharmacy', 'retail', 'services'] as $type) {
            $this->assertFalse(
                BusinessTypes::defaultFeatures($type)['fuel'] ?? false,
                "A {$type} shop should not get the forecourt module.",
            );
        }
    }

    public function test_a_shop_without_the_module_cannot_reach_the_forecourt(): void
    {
        $features = $this->station->features;
        $features['fuel'] = false;
        $this->station->forceFill(['features' => $features])->save();

        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/fuel/shifts')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    // ── Opening ─────────────────────────────────────────────────────

    public function test_opening_a_shift_photographs_every_meter_and_every_tank(): void
    {
        $shift = $this->openShift();

        $this->assertStringStartsWith('FC-', $shift['number']);
        $this->assertSame('open', $shift['status']);

        // Three nozzles, two tanks — all of them, or the reconciliation is
        // built on a partial forecourt.
        $this->assertCount(3, $shift['readings']);
        $this->assertCount(2, $shift['dips']);

        $a1 = collect($shift['readings'])->firstWhere('nozzle_name', 'A1');
        $this->assertEquals(100000, $a1['opening_reading']);
        // The rate is frozen at open, so a midnight notification can't
        // retroactively revalue litres sold before it landed.
        $this->assertEquals(268.50, $a1['unit_price']);
    }

    public function test_a_second_shift_cannot_open_over_a_running_one(): void
    {
        $this->openShift();

        $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    public function test_a_forecourt_with_no_equipment_cannot_open_a_shift(): void
    {
        FuelNozzle::withoutTenancy()->where('tenant_id', $this->station->id)->forceDelete();

        $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', [])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NO_FORECOURT_CONFIGURED');
    }

    public function test_an_opening_reading_below_the_meters_last_number_is_refused(): void
    {
        // A totaliser only counts up. Catching the typo here is the difference
        // between a corrected keystroke and a shift that "sold" 400,000 litres.
        $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', [
                'readings' => [['fuel_nozzle_id' => $this->nozzleA->id, 'opening_reading' => 90000]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'READING_WENT_BACKWARDS');
    }

    // ── The meters ──────────────────────────────────────────────────

    public function test_litres_sold_come_from_the_meters_not_the_till(): void
    {
        $shift = $this->openShift();

        // 400 + 150 litres of petrol, 300 of diesel. Nothing rung up at all.
        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100400],
            [$this->nozzleB, 50150],
            [$this->dieselNozzle, 20300],
        ], [
            [$this->petrolTank, 10000 - 550],
            [$this->dieselTank, 5000 - 300],
        ]);

        $this->assertSame('closed', $closed['status']);
        $this->assertEquals(850, $closed['litres_sold']);
        // 550 × 268.50 + 300 × 276.00 = 147,675 + 82,800
        $this->assertEquals(230475, $closed['fuel_value']);

        // Nothing was billed, so every litre is unbilled — the number that
        // makes an attendant's shift worth reading.
        $this->assertEquals(0, $closed['pos_fuel_litres']);
        $this->assertEquals(850, $closed['unbilled_litres']);
        $this->assertEquals(230475, $closed['unbilled_value']);
    }

    public function test_a_meter_that_rolls_past_its_last_digit_is_not_read_as_a_recovery(): void
    {
        // A mechanical head rolls at 999999.999. Treat the smaller closing
        // number naively and the shift reports a million litres of phantom
        // GAIN — on the one report an owner reads to find losses.
        $this->nozzleA->update(['current_reading' => 999900]);

        $shift = $this->openShift();

        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 150],       // rolled: 100 to the roll + 150 after
            [$this->nozzleB, 50000],
            [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 10000 - 250],
            [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(250, $closed['litres_sold']);
    }

    public function test_test_litres_are_neither_sold_nor_missing_from_the_tank(): void
    {
        $shift = $this->openShift();

        // 100 litres crossed the meter into a calibration measure and were
        // tipped straight back. Miss the second half and every accuracy check
        // the inspector runs shows up as a theft.
        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100500, 100],
            [$this->nozzleB, 50000],
            [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 10000 - 400],
            [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(400, $closed['litres_sold']);
        $this->assertEquals(100, $closed['test_litres']);
        // The tank is short exactly the 400 that were sold — the tested litres
        // went back in, so there is no variance to explain.
        $this->assertEquals(0, $closed['tank_variance_litres']);
    }

    public function test_more_tested_than_pumped_is_a_keying_error_not_a_reading(): void
    {
        $shift = $this->openShift();

        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [
                    ['fuel_nozzle_id' => $this->nozzleA->id, 'closing_reading' => 100050, 'test_litres' => 200],
                    ['fuel_nozzle_id' => $this->nozzleB->id, 'closing_reading' => 50000],
                    ['fuel_nozzle_id' => $this->dieselNozzle->id, 'closing_reading' => 20000],
                ],
                'dips' => [
                    ['fuel_tank_id' => $this->petrolTank->id, 'closing_dip' => 10000],
                    ['fuel_tank_id' => $this->dieselTank->id, 'closing_dip' => 5000],
                ],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'TEST_EXCEEDS_THROUGHPUT');
    }

    // ── The two variances, kept apart ───────────────────────────────

    public function test_fuel_off_the_meter_but_not_off_the_till_is_reported_as_unbilled(): void
    {
        $shift = $this->openShift();

        // 400 litres through the meter, only 300 rung up.
        $this->ringUpFuel($this->petrol, litres: 300);

        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100400],
            [$this->nozzleB, 50000],
            [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 10000 - 400],
            [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(400, $closed['litres_sold']);
        $this->assertEquals(300, $closed['pos_fuel_litres']);
        $this->assertEquals(100, $closed['unbilled_litres']);

        // …and the tank agrees with the meters exactly. That is the point:
        // the fuel is accounted for underground, so this is a counter problem,
        // not a leak.
        $this->assertEquals(0, $closed['tank_variance_litres']);
    }

    public function test_fuel_missing_from_the_ground_is_a_separate_finding_from_unbilled_fuel(): void
    {
        $shift = $this->openShift();

        $this->ringUpFuel($this->petrol, litres: 400);

        // The meters and the till agree perfectly — and the tank is still 50
        // litres short of where the book says it should be. No meter moved
        // those litres, so this can only be a leak, evaporation, or a draw
        // straight from the tank.
        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100400],
            [$this->nozzleB, 50000],
            [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 10000 - 400 - 50],
            [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(0, $closed['unbilled_litres']);
        $this->assertEquals(50, $closed['tank_variance_litres']);
        $this->assertEquals(round(50 * 268.50, 2), (float) $closed['tank_variance_value']);
    }

    public function test_a_shift_cannot_close_on_a_nozzle_or_a_tank_it_opened_on(): void
    {
        $shift = $this->openShift();

        // A missing nozzle would take its litres out of the tank's book stock
        // and turn an ordinary night into a phantom loss.
        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [['fuel_nozzle_id' => $this->nozzleA->id, 'closing_reading' => 100400]],
                'dips' => [
                    ['fuel_tank_id' => $this->petrolTank->id, 'closing_dip' => 9600],
                    ['fuel_tank_id' => $this->dieselTank->id, 'closing_dip' => 5000],
                ],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'READING_MISSING');

        // A missing dip is worse still: the close would set the product's
        // stock to a partial count and silently erase a tank.
        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [
                    ['fuel_nozzle_id' => $this->nozzleA->id, 'closing_reading' => 100400],
                    ['fuel_nozzle_id' => $this->nozzleB->id, 'closing_reading' => 50000],
                    ['fuel_nozzle_id' => $this->dieselNozzle->id, 'closing_reading' => 20000],
                ],
                'dips' => [['fuel_tank_id' => $this->petrolTank->id, 'closing_dip' => 9600]],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DIP_MISSING');
    }

    public function test_a_closed_shift_cannot_be_closed_again(): void
    {
        $shift = $this->openShift();
        $this->closeShift($shift, [
            [$this->nozzleA, 100000], [$this->nozzleB, 50000], [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 10000], [$this->dieselTank, 5000],
        ]);

        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [
                    ['fuel_nozzle_id' => $this->nozzleA->id, 'closing_reading' => 100000],
                    ['fuel_nozzle_id' => $this->nozzleB->id, 'closing_reading' => 50000],
                    ['fuel_nozzle_id' => $this->dieselNozzle->id, 'closing_reading' => 20000],
                ],
                'dips' => [
                    ['fuel_tank_id' => $this->petrolTank->id, 'closing_dip' => 10000],
                    ['fuel_tank_id' => $this->dieselTank->id, 'closing_dip' => 5000],
                ],
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_CLOSED');
    }

    // ── Stock follows the dip ───────────────────────────────────────

    public function test_closing_sets_fuel_stock_to_what_is_actually_in_the_ground(): void
    {
        $shift = $this->openShift();

        // The till thinks 300 litres left. The dip says 400 did. The dip is a
        // measurement; the till was a guess.
        $this->ringUpFuel($this->petrol, litres: 300);
        $this->assertEquals(9700, $this->petrol->fresh()->stock_quantity);

        $this->closeShift($shift, [
            [$this->nozzleA, 100400], [$this->nozzleB, 50000], [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 9600], [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(9600, $this->petrol->fresh()->stock_quantity);
        $this->assertEquals(9600, $this->petrolTank->fresh()->current_dip_litres);

        $this->assertDatabaseHas('stock_movements', [
            'product_id' => $this->petrol->id,
            'reference_type' => 'forecourt_shift',
            'reference_id' => $shift['id'],
        ]);
    }

    public function test_the_meters_are_carried_forward_so_the_next_shift_opens_where_this_one_ended(): void
    {
        $first = $this->openShift();
        $this->closeShift($first, [
            [$this->nozzleA, 100400], [$this->nozzleB, 50000], [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 9600], [$this->dieselTank, 5000],
        ]);

        $second = $this->openShift();

        // A gap between one shift's closing number and the next one's opening
        // number is itself a finding, so there must never be one by accident.
        $a1 = collect($second['readings'])->firstWhere('nozzle_name', 'A1');
        $this->assertEquals(100400, $a1['opening_reading']);

        $petrolDip = collect($second['dips'])->firstWhere('tank_name', 'Tank 1 — Petrol');
        $this->assertEquals(9600, $petrolDip['opening_dip']);
    }

    // ── Tankers ─────────────────────────────────────────────────────

    public function test_a_delivery_is_received_by_dip_not_by_the_suppliers_invoice(): void
    {
        // The invoice says 10,000. The dips say 9,850 arrived. A station that
        // records only the invoice pays for 150 litres it never received.
        $delivery = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/deliveries', [
                'fuel_tank_id' => $this->petrolTank->id,
                'invoiced_litres' => 10000,
                'dip_before' => 10000,
                'dip_after' => 19850,
                'unit_cost' => 250,
            ])
            ->assertCreated()->json('data');

        $this->assertEquals(9850, $delivery['received_litres']);
        $this->assertEquals(150, $delivery['shortage_litres']);
        // Costed on what arrived, not on what was billed.
        $this->assertEquals(round(9850 * 250, 2), (float) $delivery['total_cost']);

        $this->assertEquals(19850, $this->petrolTank->fresh()->current_dip_litres);
        $this->assertEquals(19850, $this->petrol->fresh()->stock_quantity);
    }

    public function test_a_tanker_that_would_not_fit_is_refused_at_the_gate(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/deliveries', [
                'fuel_tank_id' => $this->petrolTank->id,
                'invoiced_litres' => 25000, // 10,000 already in a 30,000 tank
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'TANK_OVERFILL');
    }

    public function test_a_delivery_inside_a_shift_joins_that_shifts_book_stock(): void
    {
        $shift = $this->openShift();

        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/deliveries', [
            'fuel_tank_id' => $this->petrolTank->id,
            'invoiced_litres' => 5000,
            'dip_before' => 10000,
            'dip_after' => 15000,
        ])->assertCreated();

        // 10,000 opening + 5,000 delivered − 400 metered = 14,600 expected.
        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100400], [$this->nozzleB, 50000], [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 14600], [$this->dieselTank, 5000],
        ]);

        $this->assertEquals(0, $closed['tank_variance_litres']);

        $petrolDip = collect($closed['dips'])->firstWhere('tank_name', 'Tank 1 — Petrol');
        $this->assertEquals(5000, $petrolDip['delivered_litres']);
        $this->assertEquals(14600, $petrolDip['book_closing']);
    }

    // ── Rates ───────────────────────────────────────────────────────

    public function test_a_rate_change_is_logged_before_it_is_applied(): void
    {
        $change = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/prices', [
                'product_id' => $this->petrol->id,
                'new_price' => 275.00,
                'reason' => 'OGRA notification',
            ])
            ->assertCreated()->json('data');

        $this->assertEquals(268.50, $change['old_price']);
        $this->assertEquals(275.00, $change['new_price']);
        $this->assertEquals(275.00, $this->petrol->fresh()->price);
    }

    /**
     * TOMORROW'S RATE DOES NOT PRICE TONIGHT'S PETROL.
     *
     * A price notification arrives in the evening and takes effect at midnight.
     * Every station enters it when the fax comes, which is hours before it
     * applies — the request that carries `effective_at` says exactly this where
     * the field is declared.
     *
     * The action wrote the new price onto the product unconditionally, so a
     * station that entered tomorrow's rate at 8pm sold the whole night at it.
     * On the one night of the month when rates change, that is the busiest a
     * forecourt gets, and nothing anywhere errored.
     */
    public function test_a_rate_logged_for_tomorrow_does_not_move_the_pumps_tonight(): void
    {
        $tonight = (float) $this->petrol->price;

        $change = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/prices', [
                'product_id' => $this->petrol->id,
                'new_price' => 275.00,
                'effective_at' => now()->addDay()->startOfDay()->toIso8601String(),
                'reason' => 'OGRA notification, effective midnight',
            ])
            ->assertCreated()->json('data');

        $this->assertEquals(275.00, $change['new_price'], 'the rate is recorded');
        $this->assertNull($change['applied_at'], 'and not applied yet');
        $this->assertEquals($tonight, (float) $this->petrol->fresh()->price);

        // A litre sold tonight is still tonight's price. This is the half that
        // matters to a customer at the pump.
        $this->ringUpFuel($this->petrol->fresh(), 1);
        $sale = Sale::query()->latest('sold_at')->with('items')->first();
        $this->assertEquals($tonight, (float) $sale->items->first()->unit_price);
    }

    /** And at midnight it does arrive — a rate nobody applies is a rate nobody has. */
    public function test_a_rate_reaches_the_pumps_once_it_falls_due(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/prices', [
                'product_id' => $this->petrol->id,
                'new_price' => 275.00,
                'effective_at' => now()->addHours(4)->toIso8601String(),
            ])
            ->assertCreated();

        $this->assertEquals(268.50, (float) $this->petrol->fresh()->price);

        $this->travel(5)->hours();
        $this->artisan('fuel:apply-rates')->assertExitCode(0);

        $this->assertEquals(275.00, (float) $this->petrol->fresh()->price);

        // Idempotent: running again must not re-apply anything, or a rate that
        // somebody has since corrected by hand would be silently reinstated
        // every five minutes for ever.
        $this->petrol->fresh()->update(['price' => 280.00]);
        $this->artisan('fuel:apply-rates')->assertExitCode(0);
        $this->assertEquals(280.00, (float) $this->petrol->fresh()->price);
    }

    /** The ordinary case, and the one the old behaviour got right: apply now. */
    public function test_a_rate_with_no_effective_time_applies_at_once(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/prices', ['product_id' => $this->petrol->id, 'new_price' => 275.00])
            ->assertCreated()
            ->assertJsonPath('data.new_price', '275.00');

        $this->assertEquals(275.00, (float) $this->petrol->fresh()->price);
    }

    public function test_only_what_a_tank_holds_can_be_repriced_as_fuel(): void
    {
        $oil = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Engine Oil 4L', 'price' => 4500, 'track_inventory' => true,
            'stock_quantity' => 20, 'is_active' => true,
        ]);

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/fuel/prices', ['product_id' => $oil->id, 'new_price' => 4800])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NOT_A_FUEL_PRODUCT');
    }

    public function test_a_shift_that_straddled_a_rate_change_says_so_on_its_face(): void
    {
        $shift = $this->openShift();

        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/prices', [
            'product_id' => $this->petrol->id, 'new_price' => 275.00,
        ])->assertCreated();

        $closed = $this->closeShift($shift, [
            [$this->nozzleA, 100400], [$this->nozzleB, 50000], [$this->dieselNozzle, 20000],
        ], [
            [$this->petrolTank, 9600], [$this->dieselTank, 5000],
        ]);

        // The litres were valued at the opening rate, which is correct — but a
        // reader comparing this to the day's takings deserves to know why the
        // two don't line up to the rupee.
        $this->assertTrue($closed['price_changed_during']);
        $this->assertEquals(round(400 * 268.50, 2), (float) $closed['fuel_value']);
    }

    // ── Setup guards ────────────────────────────────────────────────

    public function test_equipment_cannot_be_removed_while_a_shift_holds_its_readings(): void
    {
        $this->openShift();

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/fuel/tanks/{$this->dieselTank->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'FORECOURT_SHIFT_OPEN');
    }

    public function test_a_meter_cannot_be_wound_back_by_editing_the_nozzle(): void
    {
        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/fuel/pumps/{$this->nozzleA->fuel_pump_id}/nozzles/{$this->nozzleA->id}", [
                'current_reading' => 90000,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'READING_WENT_BACKWARDS');
    }

    public function test_a_tank_reports_what_can_be_sold_rather_than_what_it_contains(): void
    {
        // 800 litres of the 10,000 is unpumpable sludge at the bottom. A
        // manager ordering against the raw dip runs the pump dry.
        $this->petrolTank->update(['dead_stock_litres' => 800]);

        $tanks = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/fuel/tanks')->assertOk()->json('data');

        $petrol = collect($tanks)->firstWhere('name', 'Tank 1 — Petrol');

        $this->assertEquals(9200, $petrol['sellable_litres']);
        $this->assertEquals(20000, $petrol['ullage_litres']);
    }

    public function test_running_the_forecourt_and_buying_fuel_are_different_authorities(): void
    {
        // The forecourt manager reconciles shifts all week and still cannot
        // sign for a tanker — that is a purchasing decision.
        $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/deliveries', [
                'fuel_tank_id' => $this->petrolTank->id, 'invoiced_litres' => 1000,
            ])
            ->assertForbidden();
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private function fuelProduct(string $name, float $price, float $litres): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => $name, 'price' => $price, 'cost' => $price * 0.93,
            'unit' => 'Litre', 'sold_by' => 'weight',
            'track_inventory' => true, 'stock_quantity' => $litres, 'is_active' => true,
        ]);
    }

    private function tank(string $name, Product $product, float $capacity, float $dip): FuelTank
    {
        return FuelTank::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->branchId(),
            'product_id' => $product->id, 'name' => $name,
            'capacity_litres' => $capacity, 'current_dip_litres' => $dip,
            'dead_stock_litres' => 0, 'is_active' => true,
        ]);
    }

    private function nozzle(FuelPump $pump, string $name, FuelTank $tank, float $reading): FuelNozzle
    {
        return FuelNozzle::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'name' => $name,
            'current_reading' => $reading, 'is_active' => true,
        ]);
    }

    /** @return array<string, mixed> */
    private function openShift(): array
    {
        return $this->actingAsUser($this->manager)
            ->postJson('/api/v1/fuel/shifts', [])
            ->assertCreated()->json('data');
    }

    /**
     * @param  array<int, array{0: FuelNozzle, 1: float, 2?: float}>  $readings
     * @param  array<int, array{0: FuelTank, 1: float}>  $dips
     * @return array<string, mixed>
     */
    private function closeShift(array $shift, array $readings, array $dips): array
    {
        return $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => array_map(fn (array $r) => array_filter([
                    'fuel_nozzle_id' => $r[0]->id,
                    'closing_reading' => $r[1],
                    'test_litres' => $r[2] ?? null,
                ], fn ($v) => $v !== null), $readings),
                'dips' => array_map(fn (array $d) => [
                    'fuel_tank_id' => $d[0]->id,
                    'closing_dip' => $d[1],
                ], $dips),
            ])
            ->assertOk()->json('data');
    }

    /** Rings fuel through the till the ordinary way — it is just a product. */
    private function ringUpFuel(Product $product, float $litres): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', [
            'opening_float' => 0,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $product->id, 'quantity' => $litres]],
            'payment_method' => 'cash',
            'amount_paid' => round($litres * (float) $product->price, 2),
        ])->assertCreated();
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

    // ── Whose nozzle it was ─────────────────────────────────────────
    //
    // The close already produces the number that matters most at a pump —
    // fuel that crossed a meter and was never rung up. It was computed
    // perfectly and owed by nobody: `opened_by` and `closed_by` are the manager
    // who ran the shift, not the men who worked the hoses.
    //
    // At a Pakistani pump the attendant IS the control. Each works assigned
    // nozzles and hands over cash for their litres, and that handover is
    // counted the same evening or not at all.

    public function test_a_nozzle_can_be_assigned_to_the_man_working_it(): void
    {
        $ali = User::factory()->tenantStaff($this->station, ['sales.manage'])->create(['name' => 'Ali']);

        $shift = $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'opening_reading' => 100000, 'attendant_id' => $ali->id],
            ],
        ])->assertCreated()->json('data');

        $reading = collect($shift['readings'])->firstWhere('fuel_nozzle_id', $this->nozzleA->id);
        $this->assertSame($ali->id, $reading['attendant_id']);
    }

    public function test_a_one_man_pump_assigns_nobody_and_still_runs(): void
    {
        // Most stations. Nothing about this feature may require an assignment
        // before a shift can open.
        $shift = $this->openShift();

        $this->assertNull(collect($shift['readings'])->first()['attendant_id']);
    }

    public function test_naming_the_man_does_not_require_restating_the_meter(): void
    {
        // The case every real screen has: a manager assigns four men to four
        // hoses and touches no meter, because the meters are already where the
        // last shift left them.
        //
        // If naming somebody obliged the caller to send a reading too, the only
        // number it could send is one it read a moment ago — and an echoed
        // reading is WRITTEN BACK to the nozzle. Assigning a person would
        // quietly move a totaliser.
        $ali = User::factory()->tenantStaff($this->station, ['sales.manage'])->create(['name' => 'Ali']);
        $before = $this->nozzleA->fresh()->current_reading;

        $shift = $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'attendant_id' => $ali->id],
            ],
        ])->assertCreated()->json('data');

        $reading = collect($shift['readings'])->firstWhere('fuel_nozzle_id', $this->nozzleA->id);
        $this->assertSame($ali->id, $reading['attendant_id']);

        // The meter opened where the equipment already stood, and did not move.
        $this->assertEqualsWithDelta((float) $before, (float) $reading['opening_reading'], 0.001);
        $this->assertEqualsWithDelta((float) $before, (float) $this->nozzleA->fresh()->current_reading, 0.001);
    }

    public function test_an_entry_that_says_nothing_at_all_is_refused(): void
    {
        // Neither a meter nor a man. The only way to send this is a mistyped
        // key, and accepting it would swallow the mistake in silence.
        $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors('readings.0.opening_reading');
    }

    public function test_an_attendant_from_another_station_is_refused(): void
    {
        // The figure this produces is a person's shortfall. It has to name
        // somebody the owner can actually go and ask.
        $stranger = User::factory()->create();

        $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'opening_reading' => 100000, 'attendant_id' => $stranger->id],
            ],
        ])->assertStatus(422)->assertJsonValidationErrors('readings.0.attendant_id');
    }

    public function test_the_close_says_what_each_man_must_hand_over(): void
    {
        // Straight off the meters — the figure an owner counts the handover
        // against.
        $ali = User::factory()->tenantStaff($this->station, ['sales.manage'])->create(['name' => 'Ali']);

        $shift = $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'opening_reading' => 100000, 'attendant_id' => $ali->id],
                ['fuel_nozzle_id' => $this->nozzleB->id, 'opening_reading' => 50000],
            ],
        ])->assertCreated()->json('data');

        $closed = $this->closeShift(
            $shift,
            [[$this->nozzleA, 100100], [$this->nozzleB, 50060], [$this->dieselNozzle, 20000]],
            [[$this->petrolTank, 10000 - 160], [$this->dieselTank, 5000]],
        );

        $totals = collect($closed['attendant_totals']);

        $mine = $totals->firstWhere('attendant_id', $ali->id);
        $this->assertNotNull($mine, 'the man on the nozzle must be named');
        $this->assertEqualsWithDelta(100.0, $mine['litres'], 0.001);

        // The unassigned nozzle is still there, under nobody. A shortfall no
        // one is named for is still a shortfall — hiding it would be worse
        // than not asking who was on the hose.
        $unnamed = $totals->firstWhere('attendant_id', null);
        $this->assertNotNull($unnamed);
        $this->assertEqualsWithDelta(60.0, $unnamed['litres'], 0.001);
    }

    public function test_the_unbilled_figure_is_no_t_split_between_them(): void
    {
        // It cannot be. A till sale of twenty litres does not record which
        // nozzle it came from, so the gap between meters and till is a STATION
        // figure. Dividing it by attendant would be inventing an accusation,
        // and a report that does that is one nobody can defend to a man who
        // says it was not him.
        $ali = User::factory()->tenantStaff($this->station, ['sales.manage'])->create(['name' => 'Ali']);

        $shift = $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'opening_reading' => 100000, 'attendant_id' => $ali->id],
                ['fuel_nozzle_id' => $this->nozzleB->id, 'opening_reading' => 50000],
            ],
        ])->assertCreated()->json('data');

        $closed = $this->closeShift(
            $shift,
            [[$this->nozzleA, 100100], [$this->nozzleB, 50060], [$this->dieselNozzle, 20000]],
            [[$this->petrolTank, 10000 - 160], [$this->dieselTank, 5000]],
        );

        foreach ($closed['attendant_totals'] as $row) {
            $this->assertArrayNotHasKey('unbilled_litres', $row);
        }

        // It stays where it honestly belongs.
        $this->assertArrayHasKey('unbilled_litres', $closed);
    }
}
