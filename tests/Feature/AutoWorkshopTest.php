<?php

namespace Tests\Feature;

use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\DotCode;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * The two things a tyre shop knows that the software did not.
 *
 * ── The vehicle ──────────────────────────────────────────────────────
 * A customer is remembered by phone number, which is right for a grocery and
 * wrong here. Ask a tyre shop about a regular and they answer with a plate:
 * LEA-1234, the white Corolla, 195/65 R15, fitted a set in March. Without that,
 * every visit starts by measuring a tyre again, a warranty claim has nothing to
 * hang off, and the shop can never say "your alignment was 11,000 km ago" —
 * which is the reason a customer comes back here rather than the next shop.
 *
 * ── The DOT code ─────────────────────────────────────────────────────
 * Four digits on the sidewall: 2224 is week 22 of 2024. Rubber ages sitting
 * still, so a tyre that has never touched a road is still not something to sell
 * after six years. It is an AGE, never an expiry — nothing becomes illegal on a
 * given day, and blocking a sale the shopkeeper is entitled to make would be
 * worse than useless.
 */
class AutoWorkshopTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $tyre;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create([
            'business_type' => 'automotive',
            'business_category' => 'tyre_shop',
            'setup_completed' => true,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->tyre = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'General 195/65 R15', 'price' => 15800, 'cost' => 12300,
            'track_inventory' => true, 'stock_quantity' => 20, 'is_active' => true,
        ]);
    }

    // ── The plate ────────────────────────────────────────────────────

    public function test_a_plate_is_stored_the_same_way_however_it_is_typed(): void
    {
        // "lea 1234", "LEA-1234" and "LEA1234" are one car. Three spellings
        // means three records and a history split across all of them.
        $id = $this->createVehicle(['registration' => 'lea-1234'])['id'];

        $this->assertSame('LEA1234', CustomerVehicle::withoutTenancy()->findOrFail($id)->registration);
    }

    public function test_the_same_car_cannot_be_registered_twice(): void
    {
        $this->createVehicle(['registration' => 'LEA-1234']);

        $this->login($this->owner)->postJson('/api/v1/vehicles', [
            'registration' => 'lea 1234',
        ])->assertStatus(422)->assertJsonValidationErrors('registration');
    }

    public function test_a_plate_is_findable_however_the_counter_types_it(): void
    {
        $this->createVehicle(['registration' => 'LEA-1234', 'make' => 'Toyota', 'model' => 'Corolla GLi']);

        foreach (['lea-1234', 'LEA 1234', 'lea1234', 'Corolla'] as $typed) {
            $found = $this->login($this->owner)->getJson('/api/v1/vehicles?search='.urlencode($typed))
                ->assertOk()->json('data');

            $this->assertCount(1, $found, "searching \"{$typed}\" should find the car");
        }
    }

    public function test_the_shop_remembers_what_the_car_takes(): void
    {
        $vehicle = $this->createVehicle([
            'registration' => 'LEA-1234', 'make' => 'Toyota', 'model' => 'Corolla GLi',
            'year' => 2018, 'tyre_size' => '195/65 R15',
        ]);

        // Written down once, so nobody crouches by the wheel arch next time.
        $this->assertSame('195/65 R15', $vehicle['tyre_size']);
        $this->assertSame('Toyota Corolla GLi (2018)', CustomerVehicle::withoutTenancy()->findOrFail($vehicle['id'])->describe());
    }

    // ── The history ──────────────────────────────────────────────────

    public function test_a_job_is_recorded_against_the_car_not_just_the_person(): void
    {
        $vehicle = $this->createVehicle(['registration' => 'LEA-1234']);
        $sale = $this->fitTyres($vehicle['id'], odometer: 48200);

        $history = $this->login($this->owner)->getJson("/api/v1/vehicles/{$vehicle['id']}/history")
            ->assertOk()->json('data');

        $this->assertCount(1, $history['visits']);
        $this->assertSame($sale['invoice_number'], $history['visits'][0]['invoice_number']);
        $this->assertEquals(48200, $history['visits'][0]['odometer']);
        $this->assertEquals(31600, $history['lifetime_value']);
    }

    public function test_a_fleet_can_tell_its_vans_apart(): void
    {
        // Ten vans on one account. "What did we do to THIS van" has to survive
        // that, which is why a sale points at the vehicle and not through the
        // customer.
        $vanA = $this->createVehicle(['registration' => 'TLA-101']);
        $vanB = $this->createVehicle(['registration' => 'TLA-102']);

        $this->fitTyres($vanA['id'], odometer: 90000);
        $this->fitTyres($vanB['id'], odometer: 12000);
        $this->fitTyres($vanB['id'], odometer: 15000);

        $this->assertCount(1, $this->login($this->owner)->getJson("/api/v1/vehicles/{$vanA['id']}/history")->json('data.visits'));
        $this->assertCount(2, $this->login($this->owner)->getJson("/api/v1/vehicles/{$vanB['id']}/history")->json('data.visits'));
    }

    public function test_the_odometer_only_ever_moves_forward(): void
    {
        $vehicle = $this->createVehicle(['registration' => 'LEA-1234']);

        $this->fitTyres($vehicle['id'], odometer: 48200);
        // A lower reading is a typo or a replaced cluster. Taking it would
        // silently reset every service reminder the shop has.
        $this->fitTyres($vehicle['id'], odometer: 4820);

        $this->assertEquals(48200, CustomerVehicle::withoutTenancy()->findOrFail($vehicle['id'])->odometer);
    }

    public function test_a_sale_with_no_vehicle_is_completely_unaffected(): void
    {
        $sale = $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 15800,
            'items' => [['product_id' => $this->tyre->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertNull($sale['vehicle_id']);
    }

    // ── The sidewall ─────────────────────────────────────────────────

    public function test_a_dot_code_reads_as_the_week_it_names(): void
    {
        $date = DotCode::toDate('2224');

        $this->assertSame(2024, $date->year);
        // Week 22 of 2024.
        $this->assertSame(22, (int) $date->isoWeek());
    }

    public function test_a_two_digit_year_cannot_be_read_as_the_future(): void
    {
        // "99" is a tyre from 1999, not one that will be built in 2099.
        $this->assertSame(1999, DotCode::toDate('0199')->year);
    }

    public function test_nonsense_reads_as_no_date_rather_than_a_wrong_one(): void
    {
        // Week 00 and week 61 do not exist. A typo must read as "unknown",
        // never as a date in January 1970.
        foreach (['0024', '6124', 'abcd', '224', ''] as $bad) {
            $this->assertNull(DotCode::toDate($bad), "\"{$bad}\" should not resolve");
        }
    }

    public function test_receiving_a_lot_by_its_sidewall_code_records_its_age(): void
    {
        $batch = $this->login($this->owner)->postJson("/api/v1/inventory/products/{$this->tyre->id}/batches", [
            'batch_number' => 'PO-4417',
            'dot_code' => '2224',
            'quantity' => 8,
        ])->assertCreated()->json('data');

        $this->assertSame('2224', $batch['dot_code']);
        $this->assertSame('2024', Carbon::parse($batch['manufactured_on'])->format('Y'));
    }

    public function test_the_shelf_sweep_says_how_old_each_lot_is(): void
    {
        $this->batchAged('FRESH-1', months: 6);
        $this->batchAged('OLD-1', months: 74);   // 6 yr 2 mo

        $rows = collect($this->login($this->owner)->getJson("/api/v1/inventory/products/{$this->tyre->id}/batches")
            ->assertOk()->json('data'))->keyBy('batch_number');

        // Computed, never stored — the age changes every day on its own.
        $this->assertSame('fresh', $rows['FRESH-1']['age_status']);
        $this->assertSame('old', $rows['OLD-1']['age_status']);
        $this->assertSame('6 yr 2 mo', $rows['OLD-1']['age']);
    }

    public function test_an_ageing_lot_is_flagged_before_it_is_old(): void
    {
        // The whole point: sell this one BEFORE the newer pallet, while it is
        // still perfectly saleable. A pure expiry model hides exactly this case.
        $this->batchAged('AGEING-1', months: 63); // 5 yr 3 mo

        $row = collect($this->login($this->owner)->getJson("/api/v1/inventory/products/{$this->tyre->id}/batches")->json('data'))
            ->firstWhere('batch_number', 'AGEING-1');

        $this->assertSame('ageing', $row['age_status']);
    }

    public function test_an_old_tyre_can_still_be_sold(): void
    {
        // A warning, not a fence. Nothing becomes illegal on a given day, and
        // refusing the sale would block a shopkeeper who has priced the age in.
        $this->batchAged('OLD-1', months: 90);

        $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 15800,
            'items' => [['product_id' => $this->tyre->id, 'quantity' => 1]],
        ])->assertCreated();
    }

    public function test_a_lot_with_no_code_reads_as_unknown_not_as_fresh(): void
    {
        $this->login($this->owner)->postJson("/api/v1/inventory/products/{$this->tyre->id}/batches", [
            'batch_number' => 'NO-CODE', 'quantity' => 4,
        ])->assertCreated();

        $row = collect($this->login($this->owner)->getJson("/api/v1/inventory/products/{$this->tyre->id}/batches")->json('data'))
            ->firstWhere('batch_number', 'NO-CODE');

        // "We don't know" and "it's new" are different facts.
        $this->assertNull($row['age_status']);
        $this->assertNull($row['age']);
    }

    public function test_a_mistyped_sidewall_code_is_refused(): void
    {
        $this->login($this->owner)->postJson("/api/v1/inventory/products/{$this->tyre->id}/batches", [
            'batch_number' => 'PO-1', 'dot_code' => '22-24', 'quantity' => 4,
        ])->assertStatus(422)->assertJsonValidationErrors('dot_code');
    }

    public function test_the_shop_sets_what_counts_as_old(): void
    {
        // A fleet contract may be stricter; a hot climate has its own view.
        $this->shop->forceFill([
            'settings' => ['stock_age_warn_years' => 2, 'stock_age_old_years' => 3],
        ])->save();

        $this->batchAged('THREE-YEAR', months: 40);

        $row = collect($this->login($this->owner)->getJson("/api/v1/inventory/products/{$this->tyre->id}/batches")->json('data'))
            ->firstWhere('batch_number', 'THREE-YEAR');

        $this->assertSame('old', $row['age_status']);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function createVehicle(array $attrs): array
    {
        return $this->login($this->owner)->postJson('/api/v1/vehicles', $attrs)
            ->assertCreated()->json('data');
    }

    /** @return array<string, mixed> */
    private function fitTyres(string $vehicleId, int $odometer): array
    {
        return $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'payment_method' => 'cash',
            'amount_paid' => 31600,
            'vehicle_id' => $vehicleId,
            'odometer' => $odometer,
            'items' => [['product_id' => $this->tyre->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
    }

    private function batchAged(string $number, int $months): ProductBatch
    {
        return ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'product_id' => $this->tyre->id,
            'batch_number' => $number,
            'manufactured_on' => now()->subMonths($months)->toDateString(),
            'quantity' => 4,
        ]);
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
