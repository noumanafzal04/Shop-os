<?php

namespace Tests\Feature;

use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The car is in the bay and there is no bill yet.
 *
 * ── What was missing ────────────────────────────────────────────────────
 *
 * A workshop already had both ENDS. `CustomerVehicle` is the car's record, and
 * a quotation converts into a Sale — estimate to invoice. What had nowhere to
 * live was the several hours or days between them: the car on the ramp, parts
 * being fitted, labour accumulating, nothing billed, and the customer ringing
 * to ask if it is ready.
 *
 * That state is the whole of a workshop's day, and it was the one thing an
 * automotive shop could not record.
 *
 * ── Why the tests below are mostly about REUSE ──────────────────────────
 *
 * A job card is a third `kind` of sale document, not a new table. It
 * accumulates priced lines, takes an advance and becomes a sale — which is
 * exactly what a quotation and a layaway already do, through numbering, line
 * storage, deposits and `ConvertSaleDocumentAction`. So most of what needs
 * proving is that the shared machinery genuinely reaches it, rather than that a
 * second implementation behaves like the first.
 */
class JobCardTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Product $part;

    private CustomerVehicle $car;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'automotive',
            'features' => BusinessTypes::defaultFeatures('automotive'),
        ]);
        $this->cashier = User::factory()
            ->tenantStaff($this->tenant, ['sales.manage', 'customers.manage'])
            ->create();

        $this->part = Product::query()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Brake pads',
            'price' => 4500,
            'stock_quantity' => 20,
            'track_inventory' => true,
            'is_active' => true,
        ]);

        $this->car = CustomerVehicle::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'registration' => 'LEA-4291',
            'make' => 'Toyota',
            'model' => 'Corolla',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function open(array $over = []): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', array_merge([
            'kind' => 'job_card',
            'vehicle_id' => $this->car->id,
            'odometer_in' => 84000,
            'complaint' => 'Noise from front left when braking',
            'customer_name' => 'Ali',
            'items' => [['product_id' => $this->part->id, 'quantity' => 1]],
        ], $over));
    }

    // ── The advance, and the door it must go through ─────────────────

    public function test_an_advance_sent_with_the_job_card_is_refused_not_swallowed(): void
    {
        // "Layaway only" was a comment and nothing else. The create action reads
        // `deposit` inside `if ($isLayaway)`, so an advance sent with a job card
        // was validated, accepted, answered 201 — and dropped. Money a client
        // believed it had recorded.
        //
        // Nothing in the panel sends it, so no shop has lost anything. But an
        // API that swallows a figure it was given is worse than one that
        // refuses it.
        $this->open(['deposit' => ['amount' => 5000, 'method' => 'cash']])
            ->assertStatus(422)
            ->assertJsonValidationErrors('deposit');
    }

    public function test_the_advance_still_goes_in_through_its_own_door(): void
    {
        // The denominator. A workshop DOES take money up front — the Help Centre
        // says so — and this is where it goes. A refusal above would be a
        // regression if this stopped working.
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/deposits", [
                // Under the job's total — an advance is money toward the bill,
                // not more than it.
                'amount' => 1000, 'method' => 'cash',
            ])->assertCreated();
    }

    // ── Booking a car in ────────────────────────────────────────────

    public function test_a_car_can_be_booked_in_with_what_the_customer_said(): void
    {
        // The complaint is the first thing a mechanic reads and the last thing
        // that should be paraphrased. It is not a line item, a product or a
        // note on the invoice, which is exactly why software drops it.
        $doc = $this->open()->assertCreated()->json('data');

        $this->assertSame('job_card', $doc['kind']);
        $this->assertSame('Noise from front left when braking', $doc['complaint']);
        $this->assertSame($this->car->id, $doc['vehicle_id']);
        $this->assertSame(84000, $doc['odometer_in']);
    }

    public function test_a_job_card_is_numbered_as_one(): void
    {
        // JOB-, not QUO-. A workshop hands this number over the counter and
        // reads it back on the phone; sharing a quotation's series would make
        // two different things impossible to tell apart out loud.
        $this->assertStringStartsWith('JOB-', $this->open()->assertCreated()->json('data.number'));
    }

    public function test_a_car_that_has_just_arrived_is_in_the_bay(): void
    {
        // Defaulted rather than required: nobody should have to answer a
        // question at the moment they are holding somebody's keys.
        $this->assertSame('received', $this->open()->assertCreated()->json('data.work_status'));
    }

    public function test_the_card_carries_the_registration_so_a_screen_need_not_fetch_it(): void
    {
        $doc = $this->open()->assertCreated()->json('data');

        $this->assertSame('LEA-4291', $doc['vehicle']['registration']);
        $this->assertSame('Toyota', $doc['vehicle']['make']);
    }

    public function test_the_price_is_the_shops_and_the_card_cannot_name_it(): void
    {
        // The same rule the whole codebase runs on. A document freezes the
        // SERVER's price, and a job card sits open for days — a client-supplied
        // figure would survive a week before anybody looked at it.
        $doc = $this->open()->assertCreated()->json('data');

        $this->assertEqualsWithDelta(4500.0, (float) $doc['total'], 0.001);
    }

    public function test_a_car_from_another_shop_cannot_be_booked_in(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $theirCar = CustomerVehicle::withoutTenancy()->create([
            'tenant_id' => $other->id, 'registration' => 'ABC-123', 'make' => 'Honda',
        ]);

        $this->open(['vehicle_id' => $theirCar->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors('vehicle_id');
    }

    // ── The bay board ───────────────────────────────────────────────

    public function test_a_car_moves_along_the_board_in_one_tap(): void
    {
        // One tap from a phone, twenty times a day. Sending the whole document
        // back would let a mechanic marking a car READY change its price by
        // accident.
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'in_progress'])
            ->assertOk()->assertJsonPath('data.work_status', 'in_progress');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'ready'])
            ->assertOk()->assertJsonPath('data.work_status', 'ready');
    }

    public function test_a_car_can_go_backward_s_on_the_board(): void
    {
        // Deliberately not a one-way lifecycle. A job marked ready fails its
        // road test and goes back on the ramp. Software that refuses that
        // teaches people to keep the real state on a whiteboard, and then the
        // screen is decoration.
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'ready'])->assertOk();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'in_progress'])
            ->assertOk()->assertJsonPath('data.work_status', 'in_progress');
    }

    public function test_the_board_shows_only_what_is_in_the_shop(): void
    {
        $inBay = $this->open()->assertCreated()->json('data.id');
        $onRamp = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$onRamp}/work-status", ['work_status' => 'in_progress'])
            ->assertOk();

        $received = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/sale-documents?kind=job_card&work_status=received')
            ->assertOk()->json('data');

        $this->assertCount(1, $received);
        $this->assertSame($inBay, $received[0]['id']);
    }

    public function test_a_job_card_is_findable_as_its_own_kind(): void
    {
        // The filter was spelled out as `in:quotation,layaway` and a third kind
        // left it unfilterable — capability built, one link missing, nothing
        // failing. It reads the model's own list now.
        $this->open()->assertCreated();

        $this->assertCount(
            1,
            $this->actingAsUser($this->cashier)
                ->getJson('/api/v1/sale-documents?kind=job_card')->assertOk()->json('data'),
        );
    }

    public function test_a_quotation_does_not_move_through_the_workshop(): void
    {
        $id = $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'customer_name' => 'Ali',
            'items' => [['product_id' => $this->part->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'ready'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NOT_A_JOB_CARD');
    }

    public function test_a_quotation_carries_none_of_the_workshop_fields(): void
    {
        // Most documents are not job cards, and a quotation that quietly picked
        // up a work status would appear on a bay board holding no car.
        $doc = $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'customer_name' => 'Ali',
            'vehicle_id' => $this->car->id,
            'complaint' => 'should be ignored',
            'items' => [['product_id' => $this->part->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertNull($doc['work_status']);
        $this->assertNull($doc['vehicle_id']);
        $this->assertNull($doc['complaint']);
    }

    // ── The car leaves ──────────────────────────────────────────────

    public function test_a_finished_job_becomes_a_sale(): void
    {
        // The whole reason this is a document kind and not a new table:
        // ConvertSaleDocumentAction is the piece nobody should write twice.
        $id = $this->open()->assertCreated()->json('data.id');

        $result = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/convert", [
                'payment_method' => 'cash',
                'amount_paid' => 4500,
            ])->assertCreated()->json('data');

        $this->assertNotNull($result['sale']['invoice_number']);
        $this->assertEqualsWithDelta(4500.0, (float) $result['sale']['total'], 0.001);
        $this->assertSame('converted', $result['document']['status']);
    }

    public function test_a_billed_job_cannot_be_moved_back_onto_the_board(): void
    {
        // The car has gone. Putting it back would show a workshop a vehicle
        // that is not in the shop, which is the one thing a bay board must
        // never do.
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 4500,
            ])->assertCreated();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'in_progress'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'JOB_NOT_OPEN');
    }

    public function test_a_cancelled_job_cannot_be_moved_either(): void
    {
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/cancel", ['reason' => 'Customer took it elsewhere'])
            ->assertOk();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/work-status", ['work_status' => 'ready'])
            ->assertStatus(409);
    }

    public function test_a_workshop_can_take_an_advance_on_a_job(): void
    {
        // Parts get ordered before the work starts. The deposit machinery is
        // the layaway's, unchanged — proving it reaches a job card is the point.
        $id = $this->open()->assertCreated()->json('data.id');

        $doc = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/deposits", ['amount' => 2000, 'method' => 'cash'])
            ->assertCreated()->json('data.document');

        $this->assertEqualsWithDelta(2000.0, (float) $doc['deposit_paid'], 0.001);
        $this->assertEqualsWithDelta(2500.0, (float) $doc['balance'], 0.001);
    }

    public function test_the_cars_history_is_what_this_is_all_for(): void
    {
        // A year later somebody asks what was done to this registration. That
        // question is the reason a workshop keeps records at all, and it is
        // answered by the SALE the job card became.
        $id = $this->open()->assertCreated()->json('data.id');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$id}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 4500, 'vehicle_id' => $this->car->id,
            ])->assertCreated();

        $history = $this->actingAsUser($this->cashier)
            ->getJson("/api/v1/vehicles/{$this->car->id}/history")
            ->assertOk()->json('data');

        $this->assertNotEmpty($history['visits'], 'the job must reach the vehicle history');
    }
}
