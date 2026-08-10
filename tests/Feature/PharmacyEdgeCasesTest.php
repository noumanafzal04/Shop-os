<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\SaleItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Pharmacy batch/FEFO edge cases: pack units (strips/boxes) drawing base
 * units across dated lots in FEFO order, the expired-stock fence under pack
 * conversion, variant-scoped restores (incl. the undated RESTOCK lot when a
 * variant's live lots are gone), null-expiry lots depleting last, and the
 * Rx capture contract at POS vs online.
 */
class PharmacyEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private function shop(array $overrides = []): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $tenant = Tenant::factory()->create(array_merge([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
            'timezone' => 'UTC',
        ], $overrides));
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function actingAsUser(User $user): static
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function medicine(Tenant $tenant, array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Medicine', 'price' => 10, 'stock_quantity' => 0, 'track_inventory' => true,
        ], $attrs));
    }

    private function addLot(User $owner, Product $product, array $payload): void
    {
        $this->actingAsUser($owner)
            ->postJson("/api/v1/inventory/products/{$product->id}/batches", $payload)
            ->assertCreated();
    }

    private function lot(string $batchNumber): ProductBatch
    {
        return ProductBatch::withoutTenancy()->where('batch_number', $batchNumber)->firstOrFail();
    }

    // ── Pack units × FEFO ────────────────────────────────────────────

    public function test_pack_sale_draws_base_units_fefo_across_two_dated_lots(): void
    {
        [$tenant, $owner] = $this->shop();
        $panadol = $this->medicine($tenant, ['name' => 'Panadol', 'unit' => 'tablet']);
        $strip = $panadol->units()->create(['tenant_id' => $tenant->id, 'name' => 'Strip', 'factor' => 10]);

        // Later-expiring lot entered FIRST — order must come from expiry,
        // not insertion.
        $this->addLot($owner, $panadol, [
            'batch_number' => 'LATE', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 15,
        ]);
        $this->addLot($owner, $panadol, [
            'batch_number' => 'SOON', 'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 15,
        ]);

        // 2 strips = 20 tablets: SOON's 15 drain first, the last 5 from LATE.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $panadol->id, 'product_unit_id' => $strip->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertSame('100.00', $sale['items'][0]['unit_price']); // base 10 × factor 10
        $this->assertSame('200.00', $sale['total']);
        $this->assertEquals(0, $this->lot('SOON')->quantity);
        $this->assertEquals(10, $this->lot('LATE')->quantity);
        $this->assertEquals(10, $panadol->fresh()->stock_quantity);
    }

    public function test_pack_sale_cannot_dip_into_expired_stock(): void
    {
        [$tenant, $owner] = $this->shop();
        $amoxil = $this->medicine($tenant, ['name' => 'Amoxil', 'unit' => 'capsule']);
        $strip = $amoxil->units()->create(['tenant_id' => $tenant->id, 'name' => 'Strip', 'factor' => 10]);

        $this->addLot($owner, $amoxil, [
            'batch_number' => 'GOOD', 'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ]);
        $this->addLot($owner, $amoxil, [
            'batch_number' => 'DEAD', 'expiry_date' => now()->subDay()->toDateString(), 'quantity' => 10,
        ]);

        // stock_quantity says 20, but only 10 are sellable — 2 strips
        // (20 base units) must refuse rather than sell expired medicine.
        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $amoxil->id, 'product_unit_id' => $strip->id, 'quantity' => 2]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'STOCK_EXPIRED');

        // One strip fits inside the live lot and sells fine.
        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $amoxil->id, 'product_unit_id' => $strip->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertEquals(0, $this->lot('GOOD')->quantity);
        $this->assertEquals(10, $this->lot('DEAD')->quantity); // expired stock stays fenced
    }

    // ── Variant medicines: lot-scoped restores ───────────────────────

    public function test_variant_return_restores_into_that_variants_own_live_lot(): void
    {
        [$tenant, $owner] = $this->shop();
        $aug = $this->medicine($tenant, ['name' => 'Augmentin', 'price' => 300]);
        $v250 = $aug->variants()->create(['tenant_id' => $tenant->id, 'name' => '250mg', 'sku' => 'AUG-250', 'price' => 300, 'stock_quantity' => 0]);
        $v500 = $aug->variants()->create(['tenant_id' => $tenant->id, 'name' => '500mg', 'sku' => 'AUG-500', 'price' => 500, 'stock_quantity' => 0]);

        $this->addLot($owner, $aug, [
            'variant_id' => $v250->id, 'batch_number' => '250-A',
            'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ]);
        $this->addLot($owner, $aug, [
            'variant_id' => $v500->id, 'batch_number' => '500-A',
            'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1200,
            'items' => [['product_id' => $aug->id, 'variant_id' => $v250->id, 'quantity' => 4]],
        ])->assertCreated()->json('data');
        $this->assertEquals(6, $this->lot('250-A')->quantity);

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 4]],
        ])->assertCreated();

        // Back into the 250mg lot — the sibling variant's lot never moves,
        // and no synthetic RESTOCK lot was needed.
        $this->assertEquals(10, $this->lot('250-A')->quantity);
        $this->assertEquals(10, $this->lot('500-A')->quantity);
        $this->assertEquals(10, $v250->fresh()->stock_quantity);
        $this->assertFalse(
            ProductBatch::withoutTenancy()->where('product_id', $aug->id)->where('batch_number', 'RESTOCK')->exists(),
        );
    }

    public function test_variant_return_with_only_dead_lots_creates_a_variant_scoped_restock_lot(): void
    {
        [$tenant, $owner] = $this->shop();
        $ventolin = $this->medicine($tenant, ['name' => 'Ventolin', 'price' => 400]);
        $inhaler = $ventolin->variants()->create(['tenant_id' => $tenant->id, 'name' => 'Inhaler', 'sku' => 'VEN-INH', 'price' => 400, 'stock_quantity' => 0]);

        $this->addLot($owner, $ventolin, [
            'variant_id' => $inhaler->id, 'batch_number' => 'V-1',
            'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 5,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 800,
            'items' => [['product_id' => $ventolin->id, 'variant_id' => $inhaler->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // The variant's ONLY lot expires before the customer comes back.
        ProductBatch::withoutTenancy()->where('batch_number', 'V-1')
            ->update(['expiry_date' => now()->subDay()->toDateString()]);

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();

        // A fresh RESTOCK lot appears — scoped to the VARIANT and undated,
        // so it sells last and the pharmacist can date or write it off.
        $restock = ProductBatch::withoutTenancy()
            ->where('product_id', $ventolin->id)->where('batch_number', 'RESTOCK')->first();
        $this->assertNotNull($restock);
        $this->assertSame($inhaler->id, $restock->variant_id);
        $this->assertNull($restock->expiry_date);
        $this->assertEquals(2, $restock->quantity);

        // Variant lot totals still equal variant stock: 3 expired + 2 restocked.
        $this->assertEquals(5, $inhaler->fresh()->stock_quantity);
        $this->assertEquals(5, ProductBatch::withoutTenancy()->where('variant_id', $inhaler->id)->sum('quantity'));
    }

    // ── Undated lots sell last, refill first-dated ───────────────────

    public function test_undated_lots_deplete_after_dated_lots(): void
    {
        [$tenant, $owner] = $this->shop();
        // Undated lots are only valid for non-medicine perishables — medicines
        // now require an expiry on entry (see test_medicine_batch_requires_expiry).
        // FEFO's undated-last ordering is a general batch behaviour, tested here
        // on a batch-tracked grocery item.
        $syrup = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cough Syrup', 'price' => 50, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);

        // The undated lot is entered FIRST — FEFO must still prefer the
        // dated lot, not insertion order.
        $this->addLot($owner, $syrup, ['batch_number' => 'NODATE', 'expiry_date' => null, 'quantity' => 10]);
        $this->addLot($owner, $syrup, [
            'batch_number' => 'DATED', 'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 600,
            'items' => [['product_id' => $syrup->id, 'quantity' => 12]],
        ])->assertCreated()->json('data');

        // Dated lot drains fully first; only the remainder leaves NODATE.
        $this->assertEquals(0, $this->lot('DATED')->quantity);
        $this->assertEquals(8, $this->lot('NODATE')->quantity);
        $this->assertEquals(8, $syrup->fresh()->stock_quantity);

        // Restore mirrors the ordering: a return refills the earliest DATED
        // live lot (the one FEFO emptied), never the undated one first.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();

        $this->assertEquals(2, $this->lot('DATED')->quantity);
        $this->assertEquals(8, $this->lot('NODATE')->quantity);
        $this->assertEquals(10, $syrup->fresh()->stock_quantity);
    }

    // ── Medicine batches must carry an expiry ────────────────────────

    public function test_medicine_batch_requires_an_expiry_date(): void
    {
        [$tenant, $owner] = $this->shop();
        $med = $this->medicine($tenant, ['name' => 'Amoxil 500mg', 'price' => 120]);

        // No expiry → rejected for a medicine.
        $this->actingAsUser($owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'AMX-1', 'quantity' => 100,
        ])->assertStatus(422)->assertJsonPath('errors.expiry_date.0', 'An expiry date is required for medicine batches.');

        // With an expiry → accepted.
        $this->actingAsUser($owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'AMX-1', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 100,
        ])->assertCreated();
    }

    public function test_medicine_opening_stock_requires_an_expiry_date(): void
    {
        [, $owner] = $this->shop();

        // Opening stock but no expiry → rejected (the day-one lot must be dated).
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Ciprofloxacin', 'price' => 300, 'stock_quantity' => 25,
        ])->assertStatus(422)->assertJsonPath('errors.expiry_date.0', 'An expiry date is required for medicine opening stock.');

        // With an expiry → created and the OPENING lot is dated.
        $created = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Ciprofloxacin', 'price' => 300, 'stock_quantity' => 25,
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertCreated()->json('data');
        $this->assertNotNull(ProductBatch::withoutTenancy()->where('product_id', $created['id'])->value('expiry_date'));

        // No opening stock → expiry optional (lots added later on the Batches screen).
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Metformin', 'price' => 150,
        ])->assertCreated();
    }

    public function test_medicine_captures_strength_dosage_form_and_opening_batch(): void
    {
        [, $owner] = $this->shop();

        $created = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Panadol', 'price' => 50,
            'generic_name' => 'Paracetamol', 'strength' => '500mg', 'dosage_form' => 'Tablet',
            'stock_quantity' => 40, 'opening_batch_number' => 'LOT-PANA-01',
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertCreated()->json('data');

        $product = Product::withoutTenancy()->find($created['id']);
        $this->assertSame('500mg', $product->strength);
        $this->assertSame('Tablet', $product->dosage_form);
        $this->assertSame('Paracetamol', $product->generic_name);

        // The opening lot carries the supplied batch number, not the "OPENING"
        // fallback, and is dated.
        $lot = ProductBatch::withoutTenancy()->where('product_id', $created['id'])->first();
        $this->assertSame('LOT-PANA-01', $lot->batch_number);
        $this->assertEquals(40, (float) $lot->quantity);
        $this->assertNotNull($lot->expiry_date);
    }

    public function test_opening_batch_number_defaults_when_omitted(): void
    {
        [, $owner] = $this->shop();

        $created = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Disprin', 'price' => 30,
            'stock_quantity' => 10, 'expiry_date' => now()->addYear()->toDateString(),
        ])->assertCreated()->json('data');

        $this->assertSame('OPENING', ProductBatch::withoutTenancy()->where('product_id', $created['id'])->value('batch_number'));
    }

    public function test_a_medicine_lots_expiry_cannot_be_cleared(): void
    {
        [$tenant, $owner] = $this->shop();
        $med = $this->medicine($tenant, ['name' => 'Brufen 400mg', 'price' => 80]);
        $this->addLot($owner, $med, [
            'batch_number' => 'BRF-1', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 50,
        ]);
        $lot = $this->lot('BRF-1');

        $this->actingAsUser($owner)->patchJson("/api/v1/inventory/batches/{$lot->id}", [
            'expiry_date' => null,
        ])->assertStatus(422);
    }

    // ── Rx contract: soft capture at POS, hard block online ──────────

    public function test_rx_sale_at_pos_records_the_prescription(): void
    {
        [$tenant, $owner] = $this->shop();
        $rx = $this->medicine($tenant, [
            'name' => 'Augmentin 625mg', 'price' => 500, 'stock_quantity' => 40,
            'requires_prescription' => true,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $rx->id, 'quantity' => 1]],
            'prescription_number' => 'RX-2201',
            'prescriber_name' => 'Dr. Sana Malik',
            'patient_name' => 'Hamza Iqbal',
            'prescription_notes' => 'One after each meal',
        ])->assertCreated()->json('data');

        $this->assertSame('RX-2201', $sale['prescription_number']);
        $this->assertSame('Dr. Sana Malik', $sale['prescriber_name']);
        $this->assertSame('Hamza Iqbal', $sale['patient_name']);
        $this->assertSame('One after each meal', $sale['prescription_notes']);
    }

    public function test_rx_capture_stays_optional_at_pos(): void
    {
        // The pharmacist sights the paper script in person — capture is a
        // soft record, so an Rx item still sells without it (fields null).
        [$tenant, $owner] = $this->shop();
        $rx = $this->medicine($tenant, [
            'name' => 'Antibiotic', 'price' => 300, 'stock_quantity' => 10,
            'requires_prescription' => true,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 300,
            'items' => [['product_id' => $rx->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertNull($sale['prescription_number']);
        $this->assertNull($sale['prescriber_name']);
    }

    public function test_rx_items_never_sell_online_even_for_an_online_pharmacy(): void
    {
        // Pharmacy that DOES sell online (admin enabled marketplace): OTC
        // ships, but prescription items stay in-person only.
        [$tenant] = $this->shop([
            'online_shop_enabled' => true,
            'features' => array_merge(BusinessTypes::defaultFeatures('pharmacy'), ['marketplace' => true]),
        ]);
        $rx = $this->medicine($tenant, [
            'name' => 'Tramadol', 'price' => 900, 'stock_quantity' => 10,
            'requires_prescription' => true,
        ]);
        $customer = User::factory()->create();

        $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $tenant->slug,
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $rx->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RX_IN_PERSON_ONLY');
    }

    // ── Dispensing directions ───────────────────────────────────────
    //
    // The label a patient reads. Rx capture records who prescribed and for
    // whom, but all of that sits on the SALE — and a prescription's directions
    // differ per medicine. One free-text note on the whole sale cannot say
    // "the antibiotic is a strict course" and "the painkiller is as-needed" at
    // the same time, which is exactly what a real script says.

    public function test_each_medicine_carries_its_own_directions(): void
    {
        [$tenant, $owner] = $this->shop();
        $antibiotic = $this->medicine($tenant, ['name' => 'Augmentin 625', 'stock_quantity' => 50, 'track_inventory' => false]);
        $painkiller = $this->medicine($tenant, ['name' => 'Panadol', 'stock_quantity' => 50, 'track_inventory' => false]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 500,
            'patient_name' => 'Bilal Ahmed',
            'items' => [
                ['product_id' => $antibiotic->id, 'quantity' => 1, 'directions' => '1 tablet twice daily after meals — finish the course'],
                ['product_id' => $painkiller->id, 'quantity' => 1, 'directions' => 'As needed for pain, max 3 a day'],
            ],
        ])->assertCreated()->json('data');

        $byName = collect($sale['items'])->keyBy('product_name');
        $this->assertSame(
            '1 tablet twice daily after meals — finish the course',
            $byName['Augmentin 625']['directions'],
        );
        $this->assertSame('As needed for pain, max 3 a day', $byName['Panadol']['directions']);
    }

    /** An empty box must not print a blank line on the label. */
    public function test_blank_directions_are_stored_as_nothing(): void
    {
        [$tenant, $owner] = $this->shop();
        $med = $this->medicine($tenant, ['stock_quantity' => 10, 'track_inventory' => false]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $med->id, 'quantity' => 1, 'directions' => '   ']],
        ])->assertCreated()->json('data');

        $this->assertNull($sale['items'][0]['directions']);
    }

    /**
     * Directions are a fact about THIS dispensing, not about the drug. The
     * same medicine goes out with different directions to different patients,
     * so a later catalog edit must not be able to rewrite what someone was
     * told — the value is snapshotted on the line like unit_price beside it.
     */
    public function test_directions_survive_the_product_being_renamed(): void
    {
        [$tenant, $owner] = $this->shop();
        $med = $this->medicine($tenant, ['name' => 'Brufen', 'stock_quantity' => 10, 'track_inventory' => false]);

        $saleId = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $med->id, 'quantity' => 1, 'directions' => 'One at night']],
        ])->assertCreated()->json('data.id');

        $med->forceFill(['name' => 'Brufen 400 (renamed)'])->save();

        $item = SaleItem::query()->where('sale_id', $saleId)->firstOrFail();
        $this->assertSame('One at night', $item->directions);
        $this->assertSame('Brufen', $item->product_name);
    }

    /** Long enough for a real sig, bounded so it cannot be abused as a notes field. */
    public function test_directions_are_length_bounded(): void
    {
        [$tenant, $owner] = $this->shop();
        $med = $this->medicine($tenant, ['stock_quantity' => 10, 'track_inventory' => false]);

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $med->id, 'quantity' => 1, 'directions' => str_repeat('x', 256)]],
        ])->assertStatus(422);
    }
}
