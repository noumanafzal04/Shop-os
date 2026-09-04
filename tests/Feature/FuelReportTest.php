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
 * A MONTH OF THE FORECOURT.
 *
 * Every figure here was already written at close, once, and could only be read
 * one shift at a time. A manager could see that Tuesday was short and could
 * not see that every Tuesday was — which is the only form in which that fact
 * is worth acting on.
 *
 * What this file is really guarding is what the report REFUSES to do:
 *
 *   - it does not recompute a signed-off variance from today's prices;
 *   - it does not add the two variances together;
 *   - it does not split the unbilled litres between the attendants;
 *   - it does not silently leave an open shift out of the count.
 */
class FuelReportTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $owner;

    /** Runs the forecourt. Holds inventory.manage, and NOT reports.view. */
    private User $manager;

    /** Reads how the shop did. Holds reports.view, and no write rights at all. */
    private User $analyst;

    private Product $petrol;

    private FuelTank $tank;

    private FuelNozzle $nozzleA;

    private FuelNozzle $nozzleB;

    private User $attendantOne;

    private User $attendantTwo;

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
        $this->analyst = User::factory()
            ->tenantStaff($this->station, ['reports.view'])->create(['name' => 'Analyst']);
        $this->attendantOne = User::factory()
            ->tenantStaff($this->station, [])->create(['name' => 'Aslam']);
        $this->attendantTwo = User::factory()
            ->tenantStaff($this->station, [])->create(['name' => 'Bashir']);

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product',
            'name' => 'Petrol', 'price' => 200.00, 'cost' => 186.00,
            'unit' => 'Litre', 'sold_by' => 'weight',
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

        $this->nozzleA = $this->nozzle($pump, 'A1', 100000);
        $this->nozzleB = $this->nozzle($pump, 'A2', 50000);
    }

    // ── It adds up the nights ───────────────────────────────────────

    public function test_two_closed_shifts_are_one_months_litres(): void
    {
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);
        $this->runShift(closingA: 100900, closingB: 50700, dip: 8400);

        $totals = $this->report()['totals'];

        // 600 + 400, then 300 + 300.
        $this->assertSame(1600.0, (float) $totals['litres_sold']);
        $this->assertSame(2, $totals['shifts']);
    }

    public function test_it_counts_the_shift_still_open_rather_than_leaving_it_out_in_silence(): void
    {
        // A shift with no closing meter and no dip would be all zeros, and a
        // zero reads as "nothing happened" rather than "not counted yet".
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);
        $this->openShift();

        $totals = $this->report()['totals'];

        $this->assertSame(1, $totals['shifts']);
        $this->assertSame(1, $totals['shifts_open']);
    }

    public function test_a_shift_whose_rate_moved_mid_way_is_named(): void
    {
        // The litres are exact and the MONEY is an approximation. A reader
        // comparing two months has to know which figures are which.
        $shift = $this->openShift();
        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/prices', [
            'product_id' => $this->petrol->id, 'new_price' => 210.00,
        ])->assertCreated();
        $this->close($shift, 100600, 50400, 9000);

        $this->assertSame(1, $this->report()['totals']['shifts_repriced']);
    }

    // ── The two variances stay apart ────────────────────────────────

    public function test_the_pump_variance_and_the_tank_variance_are_never_added_together(): void
    {
        // One says fuel left the PUMP unbilled — an attendant question. The
        // other says fuel left the GROUND without crossing a meter — a leak.
        // A single number covering both destroys the only distinction the
        // owner is trying to make, which is whether to talk to a person or
        // call an engineer.
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000, ringLitres: 900);

        $totals = $this->report()['totals'];

        $this->assertArrayHasKey('unbilled_litres', $totals);
        $this->assertArrayHasKey('tank_variance_litres', $totals);
        $this->assertArrayNotHasKey('total_variance_litres', $totals);
        $this->assertArrayNotHasKey('variance_litres', $totals);

        // 1000 metered, 900 rung.
        $this->assertSame(100.0, (float) $totals['unbilled_litres']);
    }

    public function test_the_unbilled_litres_are_not_split_between_the_attendants(): void
    {
        // A till sale does not record which nozzle it came out of, so
        // meters-minus-till is a STATION figure. Splitting it would invent an
        // accusation nobody could defend. The report names who pumped what and
        // stops there.
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000, ringLitres: 900);

        $rows = $this->report()['by_attendant'];

        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertArrayHasKey('litres', $row);
            $this->assertArrayNotHasKey('unbilled_litres', $row);
            $this->assertArrayNotHasKey('unbilled_value', $row);
        }
    }

    public function test_it_says_who_pumped_what(): void
    {
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);

        $rows = collect($this->report()['by_attendant'])->keyBy('attendant');

        $this->assertSame(600.0, (float) $rows['Aslam']['litres']);
        $this->assertSame(400.0, (float) $rows['Bashir']['litres']);
    }

    // ── It reports what was recorded ────────────────────────────────

    public function test_a_rate_that_changed_since_does_not_rewrite_a_signed_off_month(): void
    {
        // The whole reason the shift columns are written once. A reconciliation
        // somebody put their name to in March must read the same in April, or
        // the report is quietly editing history every time a price moves.
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);
        $before = $this->report()['totals']['fuel_value'];

        $this->actingAsUser($this->owner)->postJson('/api/v1/fuel/prices', [
            'product_id' => $this->petrol->id, 'new_price' => 400.00,
        ])->assertCreated();

        $this->assertSame($before, $this->report()['totals']['fuel_value']);
    }

    public function test_a_product_renamed_since_still_appears_under_what_it_was_called(): void
    {
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);
        $this->petrol->forceFill(['name' => 'Super Petrol'])->save();

        $this->assertSame('Petrol', $this->report()['by_product'][0]['product']);
    }

    public function test_a_shift_outside_the_range_is_not_in_it(): void
    {
        // The denominator for every total above: a report that ignored its own
        // dates would agree with all of them and mean none of them.
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);

        $totals = $this->actingAsUser($this->analyst)
            ->getJson('/api/v1/reports/fuel?period=custom&from=2020-01-01&to=2020-01-31')
            ->assertOk()->json('data.totals');

        $this->assertSame(0, $totals['shifts']);
        $this->assertSame(0.0, (float) $totals['litres_sold']);
    }

    // ── Who may read it ─────────────────────────────────────────────

    public function test_reading_the_report_needs_reports_view_and_not_the_right_to_close_a_shift(): void
    {
        // The `*.manage` bug class. Closing a shift is a stock correction and
        // needs the right to make one; reading how the forecourt performed is a
        // report. Gating the read on the write hands the owner's own manager a
        // screen they may run and never look back at.
        $this->runShift(closingA: 100600, closingB: 50400, dip: 9000);

        $this->actingAsUser($this->analyst)->getJson($this->url())->assertOk();
        $this->actingAsUser($this->manager)->getJson($this->url())->assertForbidden();
    }

    public function test_a_shop_with_no_pumps_is_refused_rather_than_shown_a_page_of_zeros(): void
    {
        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $reader = User::factory()->tenantStaff($shop, ['reports.view'])->create();

        $this->actingAsUser($reader)->getJson($this->url())->assertStatus(403);
    }

    // ── Fixtures ────────────────────────────────────────────────────
    //
    // Figures are cast on the way out of the JSON: 1600.0 crosses the wire as
    // `1600` and comes back an int. Casting keeps the assertions strict without
    // pretending the transport preserves a type it does not.

    private function url(): string
    {
        return '/api/v1/reports/fuel?period=custom&from='
            .now()->subDays(2)->toDateString().'&to='.now()->addDay()->toDateString();
    }

    /** @return array<string, mixed> */
    private function report(): array
    {
        return $this->actingAsUser($this->analyst)->getJson($this->url())->assertOk()->json('data');
    }

    private function runShift(float $closingA, float $closingB, float $dip, ?float $ringLitres = null): void
    {
        $shift = $this->openShift();

        if ($ringLitres !== null) {
            $this->ringUpFuel($ringLitres);
        }

        $this->close($shift, $closingA, $closingB, $dip);
    }

    /** @return array<string, mixed> */
    private function openShift(): array
    {
        return $this->actingAsUser($this->manager)->postJson('/api/v1/fuel/shifts', [
            'readings' => [
                ['fuel_nozzle_id' => $this->nozzleA->id, 'attendant_id' => $this->attendantOne->id],
                ['fuel_nozzle_id' => $this->nozzleB->id, 'attendant_id' => $this->attendantTwo->id],
            ],
        ])->assertCreated()->json('data');
    }

    /** @param  array<string, mixed>  $shift */
    private function close(array $shift, float $closingA, float $closingB, float $dip): void
    {
        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/fuel/shifts/{$shift['id']}/close", [
                'readings' => [
                    ['fuel_nozzle_id' => $this->nozzleA->id, 'closing_reading' => $closingA],
                    ['fuel_nozzle_id' => $this->nozzleB->id, 'closing_reading' => $closingB],
                ],
                'dips' => [['fuel_tank_id' => $this->tank->id, 'closing_dip' => $dip]],
            ])->assertOk();
    }

    private function ringUpFuel(float $litres): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0]);
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->petrol->id, 'quantity' => $litres]],
            'payment_method' => 'cash',
            'amount_paid' => round($litres * (float) $this->petrol->price, 2),
        ])->assertCreated();
    }

    private function nozzle(FuelPump $pump, string $name, float $reading): FuelNozzle
    {
        return FuelNozzle::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $this->tank->id, 'name' => $name,
            'current_reading' => $reading, 'is_active' => true,
        ]);
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');
    }

    /**
     * Signed in the way the API is signed in to — a Sanctum token, not
     * `actingAs`. The routes here run behind `auth:sanctum`, which does not see
     * a session guard at all: every request came back 401 and the report looked
     * broken when only the login was.
     */
    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
