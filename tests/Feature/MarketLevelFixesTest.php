<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Regression locks for the 2026-07-24 per-business-type audit fixes:
 * khata ledger symmetry, tax-inclusive refunds, 86-proof dine-in settlement,
 * batch integrity (variant opening lots, RESTOCK lots, CSV stock audit),
 * business-type item constraints, Rx online gating, CSV duplicate guards,
 * POS min-order, and capability validations.
 */
class MarketLevelFixesTest extends TestCase
{
    use RefreshDatabase;

    private function shop(string $businessType = 'retail', array $overrides = []): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $tenant = Tenant::factory()->create(array_merge([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => $businessType,
            'features' => BusinessTypes::defaultFeatures($businessType),
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

    // ── P0: khata return / cancel symmetry ───────────────────────────

    public function test_return_of_a_credit_sale_reduces_the_khata_balance(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Rice Bag', 'price' => 1000, 'stock_quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'credit', 'amount_paid' => 2000,
            'customer_phone' => '03001234567', 'customer_name' => 'Khata Karim',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $customer = Customer::withoutTenancy()->where('tenant_id', $tenant->id)->first();
        $this->assertSame('2000.00', (string) $customer->credit_balance);

        // Return ONE of the two — the khata drops by that item's refund.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        $customer->refresh();
        $this->assertSame('1000.00', (string) $customer->credit_balance);

        // The reversal is on the ledger, tied to the sale.
        $this->assertTrue(
            $customer->ledgerEntries()->where('type', 'payment')->where('sale_id', $sale['id'])->exists(),
        );

        // Returning the second one clears the debt entirely — and repeated
        // partial returns can never push the reversal past what was charged.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        $this->assertSame('0.00', (string) $customer->refresh()->credit_balance);
    }

    public function test_cancelling_a_credit_sale_wipes_its_charge(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Oil Tin', 'price' => 500, 'stock_quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'credit', 'amount_paid' => 500,
            'customer_phone' => '03007654321',
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        $customer = Customer::withoutTenancy()->where('tenant_id', $tenant->id)->first();
        $this->assertSame('0.00', (string) $customer->credit_balance);
    }

    public function test_exchange_of_a_credit_sale_keeps_the_khata_debt_intact(): void
    {
        [$tenant, $owner] = $this->shop();
        $rice = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Rice Bag', 'price' => 1000, 'stock_quantity' => 10,
        ]);
        $oil = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Oil Tin', 'price' => 1000, 'stock_quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'credit', 'amount_paid' => 1000,
            'customer_phone' => '03009998877', 'customer_name' => 'Exchange Essa',
            'items' => [['product_id' => $rice->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $customer = Customer::withoutTenancy()->where('tenant_id', $tenant->id)->first();
        $this->assertSame('1000.00', (string) $customer->credit_balance);

        // Even exchange: rice back, oil out. The returned value funds the
        // replacement sale — so the 1000 debt must SURVIVE. Reversing it here
        // too would hand the customer the new goods for free.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $oil->id, 'quantity' => 1]],
        ])->assertCreated();

        $this->assertSame('1000.00', (string) $customer->refresh()->credit_balance);
        $this->assertFalse(
            $customer->ledgerEntries()->where('type', 'payment')->exists(),
            'Exchange must not write a khata reversal — the value funded the new sale.',
        );

        // The old sale is now fully refunded — no second dip possible.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertStatus(409); // SALE_NOT_RETURNABLE

        // And the flag can never arrive over HTTP: a normal return posting it
        // is stripped by validation, so the reversal still happens.
        $sale2 = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'credit', 'amount_paid' => 1000,
            'customer_phone' => '03009998877',
            'items' => [['product_id' => $rice->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertSame('2000.00', (string) $customer->refresh()->credit_balance);

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale2['id']}/returns", [
            'items' => [['sale_item_id' => $sale2['items'][0]['id'], 'quantity' => 1]],
            'skip_credit_reversal' => true, // hostile client — must be ignored
        ])->assertCreated();
        $this->assertSame('1000.00', (string) $customer->refresh()->credit_balance);
    }

    // ── P1: tax-inclusive refunds ────────────────────────────────────

    public function test_return_refunds_the_tax_the_customer_paid(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Charger', 'price' => 100, 'tax_rate' => 10, 'stock_quantity' => 5,
        ]);

        // Paid 100 + 10 tax.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 110,
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertSame('10.00', $sale['tax']);

        $ret = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // Full 110 back — not the pre-tax 100.
        $this->assertSame('110.00', $ret['refund_total']);
        $this->assertSame('10.00', $ret['refund_tax']);
    }

    // ── P1: 86-proof dine-in settlement ──────────────────────────────

    public function test_tab_settles_at_its_snapshot_even_after_menu_edits(): void
    {
        [$tenant, $owner] = $this->shop('restaurant');
        $pizza = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Zinger Pizza', 'price' => 1000, 'track_inventory' => false,
        ]);
        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'name' => 'T1', 'seats' => 4,
        ]);

        // Menu with a required modifier; order "Stuffed" (+200) to the tab.
        $groups = $this->actingAsUser($owner)->putJson("/api/v1/products/{$pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Thin', 'price_delta' => 0],
                    ['name' => 'Stuffed', 'price_delta' => 200],
                ]],
            ],
        ])->assertOk()->json('data.modifier_groups');
        $stuffed = collect($groups[0]['options'])->firstWhere('name', 'Stuffed');

        $ticket = $this->actingAsUser($owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table->id,
        ])->assertCreated()->json('data');

        $this->actingAsUser($owner)->postJson("/api/v1/restaurant/tickets/{$ticket['id']}/items", [
            'items' => [['product_id' => $pizza->id, 'quantity' => 1, 'modifier_option_ids' => [$stuffed['id']]]],
        ])->assertOk();

        // Mid-service mayhem: modifier groups rewritten (all option ids
        // change), price doubled, AND the item is 86'd.
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust v2', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Regular', 'price_delta' => 50],
                ]],
            ],
        ])->assertOk();
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$pizza->id}", ['price' => 2000, 'is_active' => false])
            ->assertOk();

        // The customer still pays exactly what the tab showed: 1000 + 200.
        $settled = $this->actingAsUser($owner)->postJson("/api/v1/restaurant/tickets/{$ticket['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1200,
        ])->assertCreated()->json('data');

        $this->assertSame('1200.00', $settled['sale']['total']);
        $this->assertSame('closed', $settled['ticket']['status']);
    }

    // ── P1: POS honors min_order_qty ─────────────────────────────────

    public function test_pos_enforces_minimum_order_quantity(): void
    {
        [$tenant, $owner] = $this->shop();
        $bulk = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Wholesale Soap', 'price' => 50, 'stock_quantity' => 100, 'min_order_qty' => 6,
        ]);

        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 50,
            'items' => [['product_id' => $bulk->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_QTY');
    }

    // ── P1: business type constrains item types ──────────────────────

    public function test_item_type_must_match_the_business_type(): void
    {
        [, $martOwner] = $this->shop('mart');
        $this->actingAsUser($martOwner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Karahi', 'price' => 800,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);

        [, $servicesOwner] = $this->shop('services');
        $this->actingAsUser($servicesOwner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Panadol', 'price' => 50,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['item_type']]);

        // The type's own item types stay allowed.
        [, $foodOwner] = $this->shop('food');
        $this->actingAsUser($foodOwner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Biryani', 'price' => 400,
        ])->assertCreated();
    }

    // ── P1: Rx is dispensed in person only ───────────────────────────

    public function test_prescription_items_cannot_be_ordered_online(): void
    {
        [$tenant] = $this->shop('retail', ['online_shop_enabled' => true]);
        $rx = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Antibiotic', 'price' => 300, 'stock_quantity' => 10,
            'requires_prescription' => true,
        ]);
        $customer = User::factory()->create();

        $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $tenant->slug,
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $rx->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RX_IN_PERSON_ONLY');
    }

    // ── P1: batch integrity ──────────────────────────────────────────

    public function test_variant_medicine_opening_stock_is_batch_backed(): void
    {
        [, $owner] = $this->shop('pharmacy');
        $created = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Augmentin', 'price' => 100,
            'expiry_date' => now()->addYear()->toDateString(),
            'variants' => [
                ['name' => '250mg', 'price' => 100, 'stock_quantity' => 20],
                ['name' => '500mg', 'price' => 180, 'stock_quantity' => 10],
            ],
        ])->assertCreated()->json('data');

        $lots = ProductBatch::withoutTenancy()->where('product_id', $created['id'])->get();
        $this->assertCount(2, $lots);
        $this->assertNotNull($lots[0]->variant_id);
        $this->assertSame(30.0, (float) $lots->sum('quantity'));
    }

    public function test_return_with_only_expired_lots_creates_a_restock_lot(): void
    {
        [, $owner] = $this->shop('pharmacy');
        $med = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'medicine', 'name' => 'Syrup', 'price' => 100, 'stock_quantity' => 5,
            'expiry_date' => now()->addYear()->toDateString(),
        ])->assertCreated()->json('data');

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $med['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // The whole remaining lot expires before the customer comes back.
        ProductBatch::withoutTenancy()->where('product_id', $med['id'])
            ->update(['expiry_date' => now()->subDay()->toDateString()]);

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();

        // Returned units landed in a fresh RESTOCK lot — lot totals still
        // equal stock, nothing sits outside batch accounting.
        $product = Product::withoutTenancy()->find($med['id']);
        $lots = ProductBatch::withoutTenancy()->where('product_id', $med['id'])->get();
        $this->assertSame(5.0, (float) $product->stock_quantity);
        $this->assertSame(5.0, (float) $lots->sum('quantity'));
        $this->assertTrue($lots->contains(fn ($l) => $l->batch_number === 'RESTOCK' && (float) $l->quantity === 2.0));
    }

    // ── P1: CSV import guards ────────────────────────────────────────

    private function importCsv(User $owner, string $csv)
    {
        return $this->actingAsUser($owner)->postJson('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.csv', $csv),
        ]);
    }

    public function test_csv_duplicate_barcode_fails_the_row_not_the_file(): void
    {
        [, $owner] = $this->shop('mart');

        $csv = "name,price,barcode\nSugar,100,111222\nSalt,50,111222\nFlour,80,333444";
        $res = $this->importCsv($owner, $csv)->assertOk()->json('data');

        // Row 3 (Salt) failed for the duplicate; the rest imported.
        $this->assertSame(2, $res['created']);
        $this->assertSame(1, $res['failed']);
        $this->assertStringContainsString('already in use', $res['errors'][0]['messages'][0]);
    }

    public function test_csv_duplicate_plu_fails_the_row_not_the_file(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Loose Rice', 'price' => 300, 'plu_code' => '2001', 'stock_quantity' => 50,
        ]);

        // Row reuses an existing PLU → that row errors, no 500, next row lands.
        $csv = "name,price,plu_code\nLoose Daal,250,2001\nLoose Atta,120,2002";
        $res = $this->importCsv($owner, $csv)->assertOk()->json('data');

        $this->assertSame(1, $res['created']);
        $this->assertSame(1, $res['failed']);
    }

    public function test_csv_reimport_stock_change_goes_through_inventory_audit(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Milk', 'sku' => 'MILK-1', 'price' => 200, 'stock_quantity' => 10,
        ]);

        $csv = "name,sku,price,stock_quantity\nMilk,MILK-1,220,25";
        $res = $this->importCsv($owner, $csv)->assertOk()->json('data');
        $this->assertSame(1, $res['updated']);

        $product = Product::withoutTenancy()->where('sku', 'MILK-1')->first();
        $this->assertSame(25.0, (float) $product->stock_quantity);

        // The recount left an audit trail (no silent mass-assignment).
        $this->assertTrue(
            StockMovement::withoutTenancy()
                ->where('product_id', $product->id)
                ->where('reason', 'CSV import recount')
                ->exists(),
        );
    }

    // ── P2: capability validations ───────────────────────────────────

    public function test_half_set_serving_window_is_rejected(): void
    {
        [, $owner] = $this->shop('food');
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Halwa Puri', 'price' => 350,
            'available_from' => '07:00',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['available_until']]);
    }

    public function test_combo_items_only_allowed_on_deals(): void
    {
        [$tenant, $owner] = $this->shop();
        $component = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'name' => 'Cola', 'price' => 100,
        ]);

        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Not a deal', 'price' => 100,
            'combo_items' => [['component_product_id' => $component->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['combo_items']]);
    }

    public function test_deals_cannot_carry_variants(): void
    {
        [, $owner] = $this->shop();
        $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Family Deal', 'price' => 999,
            'variants' => [['name' => 'Large', 'price' => 1200]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['variants']]);
    }

    public function test_duration_stays_service_only_on_update(): void
    {
        [$tenant, $owner] = $this->shop();
        $physical = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'name' => 'Fan', 'price' => 3000,
        ]);

        $this->actingAsUser($owner)->putJson("/api/v1/products/{$physical->id}", [
            'duration_minutes' => 30,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['duration_minutes']]);
    }

    // ── P1: services no longer default a feature they can't use ──────

    public function test_services_type_defaults_reservations_off(): void
    {
        $this->assertFalse(BusinessTypes::defaultFeatures('services')['reservations']);
        // Retail keeps product reservations — those genuinely work there.
        $this->assertTrue(BusinessTypes::defaultFeatures('retail')['reservations']);
    }

    // ── Verification repros: money & stock invariants ────────────────

    public function test_cancel_is_blocked_once_a_sale_has_returns(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Soap', 'price' => 100, 'stock_quantity' => 10,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $product->id, 'quantity' => 5]],
        ])->assertCreated()->json('data');

        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();
        $this->assertSame(7.0, (float) $product->refresh()->stock_quantity);

        // Void-after-refund would restore the 2 returned units AGAIN (12 on
        // the shelf when only 10 exist) — the cancel must refuse.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'SALE_HAS_RETURNS');

        $this->assertSame(7.0, (float) $product->refresh()->stock_quantity);
    }

    public function test_taxed_online_order_completes_at_the_quoted_total(): void
    {
        [$tenant, $owner] = $this->shop('retail', ['online_shop_enabled' => true, 'delivery_fee' => 150]);
        $customer = User::factory()->create();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Sneaker', 'price' => 5000, 'stock_quantity' => 5, 'tax_rate' => 17,
        ]);

        $order = $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $tenant->slug,
            'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $status) {
            $this->actingAsUser($owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $status])
                ->assertOk();
        }

        // The sale mirrors the checkout money exactly: 2 × 5000, and no tax
        // the customer was never quoted.
        $sale = Sale::withoutTenancy()->where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame('10000.00', (string) $sale->total);
        $this->assertSame('0.00', (string) $sale->tax);

        // And the sale lines carry a 0% rate — NOT the product's catalog 17% —
        // so a return refunds exactly what was paid, no phantom tax. (The sale
        // was rung by an internal customer; refund via the owner.)
        $item = $sale->items()->first();
        $this->assertSame('0.00', (string) $item->tax_rate);
        $return = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale->id}/returns", [
            'items' => [['sale_item_id' => $item->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertSame('10000.00', (string) $return['refund_total']);
        $this->assertSame('0.00', (string) $return['refund_tax']);
    }

    public function test_reservation_pickup_honors_the_promised_price(): void
    {
        [$tenant, $owner] = $this->shop('retail', ['online_shop_enabled' => true]);
        $customer = User::factory()->create();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Watch', 'price' => 5000, 'stock_quantity' => 3, 'tax_rate' => 17,
        ]);

        $reservation = $this->actingAsUser($customer)->postJson('/api/v1/customer/reservations', [
            'shop_slug' => $tenant->slug, 'product_id' => $product->id, 'quantity' => 1,
        ])->assertCreated()->json('data');

        $this->actingAsUser($owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/accept")->assertOk();

        // Pickup collects exactly the promised 5000 — not 5000 + GST.
        $this->actingAsUser($owner)
            ->postJson("/api/v1/reservations/{$reservation['id']}/complete", [
                'payment_method' => 'cash', 'amount_paid' => 5000,
            ])->assertOk()->assertJsonPath('data.status', 'completed');

        $sale = Sale::withoutTenancy()->where('tenant_id', $tenant->id)->firstOrFail();
        $this->assertSame('5000.00', (string) $sale->total);
        $this->assertSame('0.00', (string) $sale->tax);
    }

    public function test_cancel_restores_what_was_decremented_not_the_edited_recipe(): void
    {
        [$tenant, $owner] = $this->shop();
        $burger = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Burger', 'price' => 200, 'stock_quantity' => 10,
        ]);
        $pizza = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Pizza', 'price' => 200, 'stock_quantity' => 10,
        ]);
        $deal = $this->actingAsUser($owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Combo', 'price' => 250,
            'combo_items' => [['component_product_id' => $burger->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // Sell the deal: burger 10 → 9.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 250,
            'items' => [['product_id' => $deal['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertSame(9.0, (float) $burger->refresh()->stock_quantity);

        // Owner reformulates the deal to a Pizza AFTER the sale.
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$deal['id']}", [
            'combo_items' => [['component_product_id' => $pizza->id, 'quantity' => 1]],
        ])->assertOk();

        // Cancel the sale: the BURGER (what was sold) must come back, not the
        // pizza (the live recipe). Reading the edited recipe would leave burger
        // at 9 and mint a phantom pizza (11).
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();
        $this->assertSame(10.0, (float) $burger->refresh()->stock_quantity);
        $this->assertSame(10.0, (float) $pizza->refresh()->stock_quantity);
    }

    public function test_order_with_two_lines_of_the_same_product_holds_both(): void
    {
        [$tenant, $owner] = $this->shop('retail', ['online_shop_enabled' => true, 'delivery_fee' => 0]);
        $customer = User::factory()->create();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Mug', 'price' => 100, 'stock_quantity' => 10,
        ]);

        // Same product on two separate lines (2 + 3). The stock hold must cover
        // BOTH (5 held) — a per-product idempotency key would collapse them and
        // only hold the first line's 2.
        $order = $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $tenant->slug, 'fulfillment_type' => 'pickup',
            'items' => [
                ['product_id' => $product->id, 'quantity' => 2],
                ['product_id' => $product->id, 'quantity' => 3],
            ],
        ])->assertCreated()->json('data');

        $this->assertSame(5.0, (float) $product->refresh()->stock_quantity);

        // Cancelling releases exactly what was held — back to 10, no phantom units.
        $this->actingAsUser($owner)
            ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'cancelled'])
            ->assertOk();
        $this->assertSame(10.0, (float) $product->refresh()->stock_quantity);
    }

    public function test_credit_tender_cannot_exceed_what_is_owed(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Fan', 'price' => 300, 'stock_quantity' => 10,
        ]);

        // Fat-fingered credit amount (1300 on a 300 bill): would tell the
        // cashier to hand out 1000 cash change against the khata. Refused.
        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'customer_phone' => '03001234567', 'customer_name' => 'Karim',
            'payments' => [['method' => 'credit', 'amount' => 1300]],
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'CREDIT_EXCEEDS_DUE');

        // The exact credit amount is fine — the whole bill goes on the khata.
        $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'customer_phone' => '03001234567',
            'payments' => [['method' => 'credit', 'amount' => 300]],
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated();

        $customer = Customer::withoutTenancy()->where('tenant_id', $tenant->id)->first();
        $this->assertSame('300.00', (string) $customer->credit_balance);
    }

    public function test_return_rejects_duplicate_rows_for_one_line(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Bulb', 'price' => 300, 'stock_quantity' => 20,
        ]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1200,
            'items' => [['product_id' => $product->id, 'quantity' => 4]],
        ])->assertCreated()->json('data');
        $this->assertSame(16.0, (float) $product->refresh()->stock_quantity);

        // Two rows for the SAME line would refund twice but restock once
        // (colliding restore key). The distinct rule refuses the request.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [
                ['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2],
                ['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2],
            ],
        ])->assertStatus(422);

        // Nothing moved — stock and sale are untouched.
        $this->assertSame(16.0, (float) $product->refresh()->stock_quantity);
    }

    public function test_csv_reimport_cannot_flip_an_existing_products_item_type(): void
    {
        [$tenant, $owner] = $this->shop('pharmacy');
        $med = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Amoxil', 'sku' => 'AMX-1', 'price' => 50, 'stock_quantity' => 100,
        ]);

        // A bare re-import (no item_type column) must NOT silently reset the
        // medicine to physical_product — item_type is immutable after create.
        $csv = "name,sku,price\nAmoxil,AMX-1,55";
        $this->importCsv($owner, $csv)->assertOk();

        $med->refresh();
        $itemType = $med->item_type instanceof \BackedEnum ? $med->item_type->value : $med->item_type;
        $this->assertSame('medicine', $itemType);
        $this->assertSame('55.00', (string) $med->price); // the price DID update
    }

    public function test_shift_close_accounts_for_a_cash_refund_rung_on_the_drawer(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Soap', 'price' => 300, 'stock_quantity' => 10,
        ]);

        $session = $this->actingAsUser($owner)->postJson('/api/v1/pos/session/open', [
            'opening_float' => 0,
        ])->assertCreated()->json('data');

        // Cash sale of 2 (600 in the drawer), rung on this shift.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 600,
            'cash_session_id' => $session['id'],
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // Refund one unit in cash (300 out) on the same drawer — this flips the
        // sale to partially_refunded, but its 600 must still count and the 300
        // payout must be subtracted → true drawer = 300.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash', 'cash_session_id' => $session['id'],
        ])->assertCreated();

        $closed = $this->actingAsUser($owner)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 300,
        ])->assertOk()->json('data');

        $this->assertEquals(300, $closed['cash_sales']);
        $this->assertEquals(300, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']); // honest cashier balances
    }

    public function test_cash_return_of_a_khata_sale_records_the_credit_settled_split(): void
    {
        [$tenant, $owner] = $this->shop();
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'name' => 'Ghee Tin', 'price' => 1000, 'stock_quantity' => 10,
        ]);

        // 1000 total: 600 cash + 400 on the khata.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'customer_phone' => '03004445566', 'customer_name' => 'Split Sana',
            'payments' => [
                ['method' => 'cash', 'amount' => 600],
                ['method' => 'credit', 'amount' => 400],
            ],
            'items' => [['product_id' => $product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $customer = Customer::withoutTenancy()->where('tenant_id', $tenant->id)->first();
        $this->assertSame('400.00', (string) $customer->credit_balance);

        // Full return "for cash": 400 settles the khata, only 600 goes out of
        // the drawer — refund_credit records the split for the cashier.
        $return = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
        ])->assertCreated()->json('data');

        $this->assertSame('1000.00', (string) $return['refund_total']);
        $this->assertSame('400.00', (string) $return['refund_credit']);
        $this->assertSame('0.00', (string) $customer->refresh()->credit_balance);
    }
}
