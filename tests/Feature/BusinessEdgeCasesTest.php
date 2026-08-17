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
 * Business-type edge cases: pharmacy batches/expiry (FEFO), wholesale tier
 * pricing + min order qty, weight-based decimal quantities, restaurant
 * order types, and login-gated shop phone numbers.
 */
class BusinessEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'phone' => '0300-1234567',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeProduct(array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Item', 'price' => 100, 'stock_quantity' => 0,
        ], $attrs));
    }

    // ── Pharmacy: batches + expiry + FEFO ───────────────────────────

    public function test_adding_a_batch_moves_stock_in(): void
    {
        $med = $this->makeProduct(['name' => 'Panadol', 'item_type' => 'medicine']);

        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'B-100', 'expiry_date' => now()->addMonths(6)->toDateString(), 'quantity' => 50,
        ])->assertCreated();

        $this->assertEquals(50, $med->fresh()->stock_quantity);
        $this->assertDatabaseHas('stock_movements', ['product_id' => $med->id, 'reference_type' => 'batch']);
    }

    public function test_sales_deplete_batches_fefo(): void
    {
        $med = $this->makeProduct(['name' => 'Amoxil', 'item_type' => 'medicine']);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'LATE', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 10,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'SOON', 'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ])->assertCreated();

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1500,
            'items' => [['product_id' => $med->id, 'quantity' => 12]],
        ])->assertCreated();

        // FEFO: the sooner-expiring batch drains first (10), remainder (2) from the later one.
        $soon = ProductBatch::withoutTenancy()->where('batch_number', 'SOON')->first();
        $late = ProductBatch::withoutTenancy()->where('batch_number', 'LATE')->first();
        $this->assertEquals(0, $soon->quantity);
        $this->assertEquals(8, $late->quantity);
        $this->assertEquals(8, $med->fresh()->stock_quantity);
    }

    public function test_variant_medicine_batches_deplete_fefo_per_variant(): void
    {
        $med = $this->makeProduct(['name' => 'Augmentin', 'item_type' => 'medicine', 'track_inventory' => true]);
        $v250 = $med->variants()->create(['tenant_id' => $this->shop->id, 'name' => '250mg', 'sku' => 'AUG-250', 'price' => 300, 'stock_quantity' => 0]);
        $v500 = $med->variants()->create(['tenant_id' => $this->shop->id, 'name' => '500mg', 'sku' => 'AUG-500', 'price' => 500, 'stock_quantity' => 0]);

        // 250mg gets two lots (different expiries); 500mg one lot.
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'variant_id' => $v250->id, 'batch_number' => '250-LATE', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 10,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'variant_id' => $v250->id, 'batch_number' => '250-SOON', 'expiry_date' => now()->addMonth()->toDateString(), 'quantity' => 10,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'variant_id' => $v500->id, 'batch_number' => '500-A', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 10,
        ])->assertCreated();

        // Batch IN lands on the VARIANT's stock.
        $this->assertEquals(20, $v250->fresh()->stock_quantity);
        $this->assertEquals(10, $v500->fresh()->stock_quantity);

        // Sell 12 of the 250mg variant → FEFO within its OWN lots only.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 5000,
            'items' => [['product_id' => $med->id, 'variant_id' => $v250->id, 'quantity' => 12]],
        ])->assertCreated();

        $soon = ProductBatch::withoutTenancy()->where('batch_number', '250-SOON')->first();
        $late = ProductBatch::withoutTenancy()->where('batch_number', '250-LATE')->first();
        $other = ProductBatch::withoutTenancy()->where('batch_number', '500-A')->first();
        $this->assertEquals(0, $soon->quantity);    // sooner-expiring drains first
        $this->assertEquals(8, $late->quantity);    // remainder
        $this->assertEquals(10, $other->quantity);  // the 500mg lot is untouched
        $this->assertEquals(8, $v250->fresh()->stock_quantity);
    }

    public function test_expired_variant_batch_blocks_that_variants_sale(): void
    {
        $med = $this->makeProduct(['name' => 'Ventolin', 'item_type' => 'medicine', 'track_inventory' => true]);
        $v = $med->variants()->create(['tenant_id' => $this->shop->id, 'name' => 'Inhaler', 'sku' => 'VEN-INH', 'price' => 400, 'stock_quantity' => 0]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'variant_id' => $v->id, 'batch_number' => 'EXP', 'expiry_date' => now()->subDay()->toDateString(), 'quantity' => 5,
        ])->assertCreated();

        // All the variant's stock sits in an expired lot → the fence blocks it.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 400,
            'items' => [['product_id' => $med->id, 'variant_id' => $v->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'STOCK_EXPIRED');
    }

    public function test_expiring_report_flags_near_expiry_batches(): void
    {
        $med = $this->makeProduct(['name' => 'Insulin', 'item_type' => 'medicine']);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'NEAR', 'expiry_date' => now()->addDays(10)->toDateString(), 'quantity' => 5,
        ]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'FAR', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 5,
        ]);

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/inventory/expiring?days=30')
            ->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertSame('NEAR', $data[0]['batch_number']);
    }

    public function test_removing_a_batch_writes_stock_out(): void
    {
        $med = $this->makeProduct(['name' => 'Syrup', 'item_type' => 'medicine']);
        $batchId = $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'EXP', 'expiry_date' => now()->subDay()->toDateString(), 'quantity' => 7,
        ])->json('data.id');

        // A lot with stock in it may not vanish unexplained — seven bottles of
        // syrup are binned or sent back, and those are opposite facts about the
        // same money. See StockDisposalTest.
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/inventory/batches/{$batchId}", [
            'disposition' => 'written_off', 'reason' => 'expired',
        ])->assertOk();

        $this->assertEquals(0, $med->fresh()->stock_quantity);
    }

    // ── Wholesale: tier pricing + min order qty ─────────────────────

    public function test_quantity_tier_price_applies_on_pos_sale(): void
    {
        $bulk = $this->makeProduct([
            'name' => 'Rice Bag', 'price' => 100, 'stock_quantity' => 500,
            'price_tiers' => [['min_qty' => 10, 'price' => 90], ['min_qty' => 50, 'price' => 80]],
        ]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 99999,
            'items' => [['product_id' => $bulk->id, 'quantity' => 50]],
        ])->assertCreated()->json('data');

        $this->assertEquals(4000, $sale['subtotal']); // 50 × 80, deepest tier
    }

    public function test_min_order_qty_enforced_on_online_orders(): void
    {
        $bulk = $this->makeProduct(['name' => 'Crate', 'stock_quantity' => 100, 'min_order_qty' => 12]);
        $customer = User::factory()->create();

        $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $bulk->id, 'quantity' => 5]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_QTY');
    }

    // ── Grocery/hardware: decimal (weight) quantities ───────────────

    public function test_weight_item_sells_fractional_quantity(): void
    {
        $loose = $this->makeProduct([
            'name' => 'Sugar (loose)', 'price' => 200, 'unit' => 'kg',
            'sold_by' => 'weight', 'stock_quantity' => 20,
        ]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $loose->id, 'quantity' => 2.5]],
        ])->assertCreated()->json('data');

        $this->assertEquals(500, $sale['total']); // 2.5 kg × 200
        $this->assertEquals(17.5, $loose->fresh()->stock_quantity);
    }

    // ── Restaurant: order types ─────────────────────────────────────

    public function test_pos_sale_stores_order_type_and_table(): void
    {
        $pizza = $this->makeProduct(['name' => 'Pizza', 'item_type' => 'food_item', 'track_inventory' => false]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'order_type' => 'dine_in', 'table_no' => 'T4',
            'items' => [['product_id' => $pizza->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('dine_in', $sale['order_type']);
        $this->assertSame('T4', $sale['table_no']);
    }

    // ── Services: contact number gated behind login ─────────────────

    public function test_shop_phone_hidden_for_anonymous_visitors(): void
    {
        $this->app['auth']->forgetGuards();
        $data = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->assertOk()->json('data');

        $this->assertNull($data['phone']);
        $this->assertTrue($data['phone_requires_login']);
    }

    public function test_shop_phone_visible_when_logged_in(): void
    {
        $customer = User::factory()->create();
        $data = $this->actingAsUser($customer)->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")
            ->assertOk()->json('data');

        $this->assertSame('0300-1234567', $data['phone']);
        $this->assertFalse($data['phone_requires_login']);
    }
}
