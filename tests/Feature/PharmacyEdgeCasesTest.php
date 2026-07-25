<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
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
        $syrup = $this->medicine($tenant, ['name' => 'Cough Syrup', 'price' => 50]);

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
        [$tenant, ] = $this->shop([
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
}
