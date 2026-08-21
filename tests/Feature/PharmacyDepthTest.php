<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The three things a chemist does that no other shop does.
 *
 *  - SUBSTITUTION: the prescribed brand is out, and an equivalent is on the
 *    shelf. The question is asked by salt, not by brand.
 *  - THE DISPENSING REGISTER: what left the shop, against whose prescription,
 *    out of which lot. Derived from the sales themselves — a register that can
 *    disagree with the till is worse than no register.
 *  - RECALL: a manufacturer withdraws a lot and the shop must telephone the
 *    people who took it home. This was previously unanswerable: stock depleted
 *    FEFO correctly and then threw away which lots it had eaten.
 *
 * Plus the rule that makes the register worth keeping — a schedule-controlled
 * drug cannot be dispensed without recording the prescription it left on.
 */
class PharmacyDepthTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $counter;

    private Product $panadol;    // brand, paracetamol 500mg

    private Product $calpol;     // another brand, same salt + strength

    private Product $paraSyrup;  // same salt, different strength/form

    private Product $morphine;   // schedule-controlled

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->counter = User::factory()
            ->tenantStaff($this->shop, ['sales.manage', 'inventory.manage'])->create(['name' => 'Sana']);

        $this->panadol = $this->drug('Panadol 500mg', 'Paracetamol', '500mg', 'Tablet', 50, stock: 100);
        $this->calpol = $this->drug('Calpol 500mg', 'paracetamol', '500 MG', 'tablet', 45, stock: 60);
        $this->paraSyrup = $this->drug('Para Syrup', 'Paracetamol', '120mg/5ml', 'Syrup', 90, stock: 20);
        $this->morphine = $this->drug('Morphine 10mg', 'Morphine', '10mg', 'Tablet', 300, stock: 30, schedule: 'G');
    }

    // ── the two doors a medicine can leave by ────────────────────────

    public function test_a_controlled_drug_is_prescription_only_however_it_was_marked(): void
    {
        // The two fields were free-standing on the same form, and nothing tied
        // them. A controlled drug that does not need a prescription is not a
        // thing, so the model refuses to hold that state at all.
        $sneaked = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Marked Schedule Only', 'price' => 200,
            'track_inventory' => true, 'stock_quantity' => 10, 'is_active' => true,
            'drug_schedule' => 'G',
            'requires_prescription' => false,
        ]);

        $this->assertTrue((bool) $sneaked->fresh()->requires_prescription,
            'a schedule-controlled drug was saved as not needing a prescription');
    }

    public function test_a_controlled_drug_cannot_go_out_of_the_phone_order_door(): void
    {
        // THE BUG. The till refused this exact product and the phone order took
        // it — same shop, same shopkeeper, same medicine. A shopkeeper writing
        // down a telephone order dispensed a Schedule-G drug with no
        // prescription recorded and no line in the register a regulator reads.
        $this->actingAsUser($this->owner)->postJson('/api/v1/orders', [
            'customer_name' => 'Phone Caller', 'customer_phone' => '03001234567',
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RX_IN_PERSON_ONLY');
    }

    public function test_both_doors_say_the_same_thing_about_the_same_drug(): void
    {
        // Not that each refuses — that they AGREE. Two fences reading two
        // different fields is how they drifted apart in the first place.
        $order = $this->actingAsUser($this->owner)->postJson('/api/v1/orders', [
            'customer_name' => 'Phone Caller', 'customer_phone' => '03001234568',
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
        ]);

        $till = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 300,
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
        ]);

        $this->assertSame(422, $order->status(), 'the order door took a controlled drug');
        $this->assertSame(422, $till->status(), 'the till took a controlled drug');
    }

    public function test_the_order_door_refuses_a_drifted_row_on_its_own(): void
    {
        // Written past the model, the way a raw query, an old import or the
        // rows this fix had to migrate were written. `Product::booted()` never
        // ran for them, so the pairing it guarantees is absent — which is
        // precisely the state the order door has to be able to refuse BY
        // ITSELF, or it is a line no test holds down.
        //
        // Found by mutation: removing the schedule check from OrderService left
        // every test green, because the model hook was answering for it.
        DB::table('products')->where('id', $this->morphine->id)
            ->update(['requires_prescription' => false]);

        $this->assertFalse(
            (bool) Product::withoutTenancy()->find($this->morphine->id)->requires_prescription,
            'the drifted state could not be created, so this test proves nothing',
        );

        $this->actingAsUser($this->owner)->postJson('/api/v1/orders', [
            'customer_name' => 'Phone Caller', 'customer_phone' => '03001234570',
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RX_IN_PERSON_ONLY');
    }

    public function test_an_ordinary_medicine_still_goes_out_of_that_door(): void
    {
        // The denominator. A fence that refuses everything proves nothing about
        // the one thing it was built for — a chemist takes telephone orders for
        // paracetamol all day and must go on doing so.
        $this->actingAsUser($this->owner)->postJson('/api/v1/orders', [
            'customer_name' => 'Phone Caller', 'customer_phone' => '03001234569',
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->panadol->id, 'quantity' => 2]],
        ])->assertCreated();
    }

    private function drug(
        string $name,
        string $generic,
        string $strength,
        string $form,
        float $price,
        float $stock,
        ?string $schedule = null,
    ): Product {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => $name, 'generic_name' => $generic, 'strength' => $strength, 'dosage_form' => $form,
            'price' => $price, 'cost' => $price * 0.7,
            'track_inventory' => true, 'stock_quantity' => $stock, 'is_active' => true,
            'requires_prescription' => $schedule !== null,
            'drug_schedule' => $schedule,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->value('id');
    }

    private function batch(Product $product, string $number, string $expiry, float $qty): ProductBatch
    {
        // Batches carry the stock, so the product's own rollup must match them
        // or FEFO would be depleting a total it doesn't own.
        $product->forceFill(['stock_quantity' => (float) $product->stock_quantity])->save();

        return ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'branch_id' => $this->branchId(),
            'product_id' => $product->id,
            'batch_number' => $number,
            'expiry_date' => $expiry,
            'quantity' => $qty,
        ]);
    }

    private function sell(Product $product, float $qty, array $extra = []): array
    {
        return $this->actingAsUser($this->counter)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'payment_method' => 'cash',
            'items' => [['product_id' => $product->id, 'quantity' => $qty]],
            'amount_paid' => 100000,
            ...$extra,
        ])->assertCreated()->json('data');
    }

    // ── Substitution ────────────────────────────────────────────────

    public function test_an_equivalent_is_found_by_salt_not_by_brand(): void
    {
        $data = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}")
            ->assertOk()->json('data');

        $names = array_column($data['alternatives'], 'name');
        $this->assertContains('Calpol 500mg', $names);
        $this->assertNotContains('Panadol 500mg', $names, 'the source must not offer itself');
        $this->assertNotContains('Morphine 10mg', $names, 'a different salt is not an equivalent');
    }

    /** "500 MG" and "500mg" are the same box on a shelf. */
    public function test_strength_and_form_matching_ignores_spacing_and_case(): void
    {
        $data = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}")
            ->assertOk()->json('data');

        $calpol = collect($data['alternatives'])->firstWhere('name', 'Calpol 500mg');
        $this->assertTrue($calpol['same_strength']);
        $this->assertTrue($calpol['same_form']);
    }

    /**
     * A different strength is often still the right answer — 2 × 250mg is a
     * real thing a pharmacist can do — so it is flagged, never hidden.
     */
    public function test_a_different_strength_is_offered_but_marked(): void
    {
        $data = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}")
            ->assertOk()->json('data');

        $syrup = collect($data['alternatives'])->firstWhere('name', 'Para Syrup');
        $this->assertNotNull($syrup);
        $this->assertFalse($syrup['same_strength']);
        $this->assertFalse($syrup['same_form']);
    }

    public function test_an_out_of_stock_equivalent_is_hidden_by_default(): void
    {
        $this->calpol->forceFill(['stock_quantity' => 0])->save();

        $data = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}")
            ->assertOk()->json('data');

        $this->assertNotContains('Calpol 500mg', array_column($data['alternatives'], 'name'));

        // …but a pharmacist can still ask what exists, to order it in.
        $all = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}&in_stock_only=0")
            ->assertOk()->json('data');
        $this->assertContains('Calpol 500mg', array_column($all['alternatives'], 'name'));
    }

    /** "No generic recorded" and "no equivalents exist" are different answers. */
    public function test_a_drug_with_no_generic_name_says_so(): void
    {
        $unknown = $this->drug('Mystery Tonic', '', '', '', 100, 5);
        $unknown->forceFill(['generic_name' => null])->save();

        $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$unknown->id}")
            ->assertOk()
            ->assertJsonPath('data.reason', 'no_generic_name')
            ->assertJsonCount(0, 'data.alternatives');
    }

    public function test_another_shops_catalogue_is_never_offered(): void
    {
        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        Product::withoutTenancy()->create([
            'tenant_id' => $other->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Rival Paracetamol', 'generic_name' => 'Paracetamol', 'strength' => '500mg',
            'price' => 40, 'cost' => 20, 'track_inventory' => true, 'stock_quantity' => 100, 'is_active' => true,
        ]);

        $data = $this->actingAsUser($this->counter)
            ->getJson("/api/v1/pharmacy/alternatives?product_id={$this->panadol->id}")
            ->assertOk()->json('data');

        $this->assertNotContains('Rival Paracetamol', array_column($data['alternatives'], 'name'));
    }

    // ── Schedule-controlled dispensing ──────────────────────────────

    public function test_a_controlled_drug_cannot_be_sold_without_the_prescription_details(): void
    {
        $this->actingAsUser($this->counter)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
            'amount_paid' => 500,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PRESCRIPTION_REQUIRED');
    }

    public function test_a_prescription_number_alone_is_not_enough(): void
    {
        $this->actingAsUser($this->counter)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->morphine->id, 'quantity' => 1]],
            'amount_paid' => 500,
            'prescription_number' => 'RX-1',
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PRESCRIPTION_REQUIRED');
    }

    public function test_a_controlled_drug_sells_once_the_prescription_is_recorded(): void
    {
        $sale = $this->sell($this->morphine, 1, [
            'prescription_number' => 'RX-2291',
            'prescriber_name' => 'Dr Farooq',
            'patient_name' => 'Bilal Ahmed',
        ]);

        $this->assertSame('RX-2291', $sale['prescription_number']);
    }

    /** An ordinary medicine is unaffected — nothing changes for a mart. */
    public function test_an_unscheduled_drug_still_sells_freely(): void
    {
        $this->sell($this->panadol, 2);
        $this->assertTrue(true);
    }

    // ── The dispensing register ─────────────────────────────────────

    public function test_the_register_records_the_prescription_and_the_lot(): void
    {
        $this->batch($this->morphine, 'MOR-2291', now()->addYear()->toDateString(), 30);

        $this->sell($this->morphine, 2, [
            'prescription_number' => 'RX-77',
            'prescriber_name' => 'Dr Farooq',
            'patient_name' => 'Bilal Ahmed',
            'customer_phone' => '0300 1112222',
        ]);

        $rows = $this->actingAsUser($this->owner)->getJson('/api/v1/pharmacy/dispensing')
            ->assertOk()->json('data.rows');

        $this->assertCount(1, $rows);
        $row = $rows[0];
        $this->assertSame('Morphine 10mg', $row['drug']);
        $this->assertSame('G', $row['schedule']);
        $this->assertSame('RX-77', $row['prescription_number']);
        $this->assertSame('Dr Farooq', $row['prescriber_name']);
        $this->assertSame('Bilal Ahmed', $row['patient_name']);
        $this->assertEquals(2, $row['quantity']);
        // The lot it physically came out of — the link a recall walks back.
        $this->assertSame('MOR-2291', $row['batches'][0]['batch_number']);
    }

    /** Over-the-counter stock is not a dispensing record. */
    public function test_the_register_ignores_items_that_need_no_prescription(): void
    {
        $this->sell($this->panadol, 1);

        $this->actingAsUser($this->owner)->getJson('/api/v1/pharmacy/dispensing')
            ->assertOk()->assertJsonCount(0, 'data.rows');
    }

    public function test_the_register_can_narrow_to_controlled_drugs_only(): void
    {
        $rxOnly = $this->drug('Amoxil 500', 'Amoxicillin', '500mg', 'Capsule', 120, 40);
        $rxOnly->forceFill(['requires_prescription' => true])->save();

        $this->sell($rxOnly, 1);
        $this->sell($this->morphine, 1, ['prescription_number' => 'RX-9', 'prescriber_name' => 'Dr A']);

        $all = $this->actingAsUser($this->owner)->getJson('/api/v1/pharmacy/dispensing')
            ->assertOk()->json('data.rows');
        $this->assertCount(2, $all);

        $controlled = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pharmacy/dispensing?controlled_only=1')->assertOk()->json('data.rows');
        $this->assertCount(1, $controlled);
        $this->assertSame('Morphine 10mg', $controlled[0]['drug']);
    }

    public function test_the_register_can_be_searched_by_patient(): void
    {
        $this->sell($this->morphine, 1, [
            'prescription_number' => 'RX-1', 'prescriber_name' => 'Dr A', 'patient_name' => 'Ayesha Malik',
        ]);
        $this->sell($this->morphine, 1, [
            'prescription_number' => 'RX-2', 'prescriber_name' => 'Dr B', 'patient_name' => 'Usman Tariq',
        ]);

        $rows = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/pharmacy/dispensing?search=Ayesha')->assertOk()->json('data.rows');

        $this->assertCount(1, $rows);
        $this->assertSame('Ayesha Malik', $rows[0]['patient_name']);
    }

    public function test_the_register_needs_the_reports_permission(): void
    {
        $tillOnly = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->actingAsUser($tillOnly)->getJson('/api/v1/pharmacy/dispensing')->assertForbidden();
    }

    // ── Recall ──────────────────────────────────────────────────────

    /** FEFO has to write down what it ate, or a recall is unanswerable. */
    public function test_selling_records_which_lot_the_stock_came_from(): void
    {
        $this->batch($this->panadol, 'OLD-1', now()->addMonth()->toDateString(), 10);
        $this->batch($this->panadol, 'NEW-1', now()->addYear()->toDateString(), 90);

        $sale = $this->sell($this->panadol, 4);

        $movement = StockMovement::withoutTenancy()
            ->where('reference_type', 'sale')->where('reference_id', $sale['id'])->sole();

        // Earliest expiry first.
        $this->assertSame('OLD-1', $movement->batch_allocations[0]['batch_number']);
        $this->assertEquals(4, $movement->batch_allocations[0]['quantity']);
    }

    public function test_a_sale_spanning_two_lots_records_both(): void
    {
        $this->batch($this->panadol, 'OLD-1', now()->addMonth()->toDateString(), 3);
        $this->batch($this->panadol, 'NEW-1', now()->addYear()->toDateString(), 97);

        $sale = $this->sell($this->panadol, 5);

        $movement = StockMovement::withoutTenancy()
            ->where('reference_type', 'sale')->where('reference_id', $sale['id'])->sole();

        $this->assertCount(2, $movement->batch_allocations);
        $this->assertEquals(3, $movement->batch_allocations[0]['quantity']);
        $this->assertEquals(2, $movement->batch_allocations[1]['quantity']);
    }

    public function test_a_recall_finds_who_took_the_bad_lot_home(): void
    {
        $this->batch($this->panadol, 'BAD-77', now()->addYear()->toDateString(), 60);
        $this->batch($this->calpol, 'FINE-1', now()->addYear()->toDateString(), 60);

        $this->sell($this->panadol, 2, ['customer_name' => 'Ali Raza', 'customer_phone' => '0300 5556666']);
        $this->sell($this->calpol, 1, ['customer_name' => 'Someone Else', 'customer_phone' => '0300 7778888']);

        $data = $this->actingAsUser($this->counter)
            ->getJson('/api/v1/pharmacy/recall?batch_number=BAD-77')->assertOk()->json('data');

        $this->assertCount(1, $data['dispensed']);
        $this->assertSame('Ali Raza', $data['dispensed'][0]['customer_name']);
        $this->assertSame('0300 5556666', $data['dispensed'][0]['customer_phone']);
        $this->assertEquals(2, $data['dispensed'][0]['quantity']);

        // And what is still on the shelf to pull.
        $this->assertCount(1, $data['on_hand']);
        $this->assertEquals(58, $data['on_hand'][0]['quantity']);
    }

    public function test_a_recall_matches_the_lot_number_case_insensitively(): void
    {
        $this->batch($this->panadol, 'Bad-77', now()->addYear()->toDateString(), 60);
        $this->sell($this->panadol, 1, ['customer_name' => 'Ali', 'customer_phone' => '0300 1']);

        $this->actingAsUser($this->counter)
            ->getJson('/api/v1/pharmacy/recall?batch_number=BAD-77')
            ->assertOk()->assertJsonCount(1, 'data.dispensed');
    }

    /** A customer with no phone number cannot be told — say how many. */
    public function test_a_recall_counts_the_people_it_cannot_reach(): void
    {
        $this->batch($this->panadol, 'BAD-88', now()->addYear()->toDateString(), 60);
        $this->sell($this->panadol, 1, ['customer_name' => 'Walk-in']);

        $data = $this->actingAsUser($this->counter)
            ->getJson('/api/v1/pharmacy/recall?batch_number=BAD-88')->assertOk()->json('data');

        $this->assertSame(1, $data['unreachable']);
    }

    public function test_a_recall_needs_the_inventory_permission(): void
    {
        $tillOnly = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->actingAsUser($tillOnly)->getJson('/api/v1/pharmacy/recall?batch_number=X')->assertForbidden();
    }
}
