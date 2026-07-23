<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Regression coverage for the 2026-07-20 P0 launch-blocker fixes:
 *   1. Coupon-discounted online orders can complete into a Sale.
 *   2. Pharmacy batch loop: expired stock is fenced off, PO receipts create
 *      lots, returns restore lots.
 *   3. CreateProductAction persists sold_by / price_tiers / min_order_qty.
 *   4. Pricing is server-authoritative — a client-sent unit_price is ignored.
 *   5. Purchase-order receiving is retry-safe under an idempotency key.
 */
class P0RegressionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

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
            'delivery_fee' => 100,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
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
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 1000, 'cost' => 600, 'stock_quantity' => 20, 'track_inventory' => true,
        ], $attrs));
    }

    // ── CRIT-1: coupon orders complete ──────────────────────────────

    public function test_coupon_discounted_order_completes_into_a_sale(): void
    {
        $product = $this->makeProduct(['name' => 'Sneaker', 'price' => 5000, 'stock_quantity' => 5]);
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'SAVE20', 'type' => 'percent', 'value' => 20, 'is_active' => true,
        ]);

        $order = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main St',
            'coupon_code' => 'SAVE20',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // 10000 subtotal − 20% (2000) + 100 delivery = 8100.
        $this->assertSame('2000.00', $order['discount']);
        $this->assertSame('8100.00', $order['total']);

        // The whole lifecycle to completion must NOT throw PAYMENT_INSUFFICIENT.
        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $status) {
            $this->actingAsUser($this->owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $status])
                ->assertOk();
        }

        $sale = Sale::withoutTenancy()->where('channel', 'online')->firstOrFail();
        // Sale records GOODS revenue: subtotal 10000 − discount 2000 = 8000
        // (delivery fee stays on the order, not the sale).
        $this->assertSame('2000.00', $sale->discount);
        $this->assertSame('8000.00', $sale->total);
        $this->assertSame('8000.00', $sale->amount_paid);
        $this->assertSame('completed', Order::withoutTenancy()->find($order['id'])->status->value);
    }

    // ── CRIT-2: batch/expiry integrity ──────────────────────────────

    public function test_expired_stock_cannot_be_sold(): void
    {
        $med = $this->makeProduct(['name' => 'Panadol', 'item_type' => 'medicine', 'stock_quantity' => 0]);
        // 5 expired + 3 good = 8 in stock, but only 3 sellable.
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'OLD', 'expiry_date' => now()->subDay()->toDateString(), 'quantity' => 5,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'GOOD', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 3,
        ])->assertCreated();

        // Selling 4 (> 3 sellable) is blocked — expired stock is unsellable.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $med->id, 'quantity' => 4]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'STOCK_EXPIRED');

        // Selling the 3 good ones works and drains ONLY the non-expired batch.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $med->id, 'quantity' => 3]],
        ])->assertCreated();

        $this->assertEquals(5, ProductBatch::withoutTenancy()->where('batch_number', 'OLD')->first()->quantity);
        $this->assertEquals(0, ProductBatch::withoutTenancy()->where('batch_number', 'GOOD')->first()->quantity);
    }

    public function test_returned_stock_is_restored_into_a_batch(): void
    {
        $med = $this->makeProduct(['name' => 'Syrup', 'item_type' => 'medicine', 'stock_quantity' => 0]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/inventory/products/{$med->id}/batches", [
            'batch_number' => 'LOT1', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 10,
        ])->assertCreated();

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $med->id, 'quantity' => 4]],
        ])->assertCreated()->json('data');

        $this->assertEquals(6, ProductBatch::withoutTenancy()->where('batch_number', 'LOT1')->first()->quantity);

        // Return 2 → batch total climbs back to 8 (stock and batch stay in step).
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
            'refund_method' => 'cash',
        ])->assertCreated();

        $this->assertEquals(8, ProductBatch::withoutTenancy()->where('batch_number', 'LOT1')->first()->quantity);
        $this->assertEquals(8, $med->fresh()->stock_quantity);
    }

    // ── CRIT-3: product-create persists commerce fields ─────────────

    public function test_create_product_persists_sold_by_tiers_and_min_order_qty(): void
    {
        $created = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'Rice Bag',
            'price' => 100,
            'sold_by' => 'weight',
            'min_order_qty' => 5,
            'price_tiers' => [['min_qty' => 10, 'price' => 90], ['min_qty' => 50, 'price' => 80]],
        ])->assertCreated()->json('data');

        $product = Product::withoutTenancy()->find($created['id']);
        $this->assertSame('weight', $product->sold_by);
        $this->assertEquals(5, $product->min_order_qty);
        $this->assertCount(2, $product->price_tiers);
        // The deepest qualifying tier prices the line.
        $this->assertEquals(80.0, $product->priceForQty(50));
    }

    // ── CRIT-4: server-authoritative pricing ────────────────────────

    public function test_client_sent_unit_price_is_ignored(): void
    {
        $product = $this->makeProduct(['name' => 'Watch', 'price' => 5000, 'stock_quantity' => 5]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 10000,
            // Attempt to ring a 5000 item at 5 — must be ignored.
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 5]],
        ])->assertCreated()->json('data');

        $this->assertSame('5000.00', $sale['items'][0]['unit_price']);
        $this->assertSame('5000.00', $sale['total']);
    }

    // ── CRIT-5: PO receiving is retry-safe ──────────────────────────

    public function test_purchase_receipt_is_idempotent_and_creates_a_batch(): void
    {
        $med = $this->makeProduct(['name' => 'Tablets', 'item_type' => 'medicine', 'stock_quantity' => 0]);

        $supplierId = $this->actingAsUser($this->owner)->postJson('/api/v1/suppliers', [
            'name' => 'Acme', 'phone' => '+92300',
        ])->assertCreated()->json('data.id');

        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => '2026-07-01', 'status' => 'ordered',
            'items' => [['product_id' => $med->id, 'quantity' => 30, 'unit_cost' => 40]],
        ])->assertCreated()->json('data');

        $key = 'recv-attempt-1';
        $receive = fn () => $this->actingAsUser($this->owner)->postJson(
            "/api/v1/purchase-orders/{$po['id']}/receive",
            ['idempotency_key' => $key, 'items' => [[
                'id' => $po['items'][0]['id'], 'quantity' => 30,
                'batch_number' => 'PO-LOT', 'expiry_date' => now()->addYear()->toDateString(),
            ]]],
        );

        $receive()->assertOk();
        // A retry under the SAME key must not double-receive or double-batch.
        $receive()->assertOk();

        $this->assertEquals(30, $med->fresh()->stock_quantity);
        $this->assertSame(1, ProductBatch::withoutTenancy()->where('batch_number', 'PO-LOT')->count());
        $this->assertSame(1, StockMovement::withoutTenancy()
            ->where('product_id', $med->id)->where('reference_type', 'purchase_order')->count());
    }

    // ── CRIT-6: sale-reversal restores combo + pack stock ───────────

    public function test_cancelling_a_deal_sale_restores_component_stock(): void
    {
        $burger = $this->makeProduct(['name' => 'Burger', 'price' => 300, 'stock_quantity' => 10]);
        $drink = $this->makeProduct(['name' => 'Drink', 'price' => 100, 'stock_quantity' => 30]);

        $deal = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Combo', 'price' => 500,
            'combo_items' => [
                ['component_product_id' => $burger->id, 'quantity' => 1],
                ['component_product_id' => $drink->id, 'quantity' => 2],
            ],
        ])->assertCreated()->json('data');

        // Sell 2 deals → burger −2, drink −4.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $deal['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(8, $burger->fresh()->stock_quantity);
        $this->assertEquals(26, $drink->fresh()->stock_quantity);

        // Cancel must SUCCEED (not throw PRODUCT_NOT_TRACKED) and put the
        // components back — the whole point of the P0 fix.
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'void'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertEquals(10, $burger->fresh()->stock_quantity);
        $this->assertEquals(30, $drink->fresh()->stock_quantity);
    }

    public function test_cancelling_a_pack_sale_restores_base_units(): void
    {
        $p = $this->makeProduct(['name' => 'Tablets', 'stock_quantity' => 1000]);
        $strip = $p->units()->create(['tenant_id' => $this->shop->id, 'name' => 'Strip', 'factor' => 10]);

        // Sell 2 strips → 20 base units OUT (1000 → 980).
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $p->id, 'product_unit_id' => $strip->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(980, $p->fresh()->stock_quantity);

        // Cancel restores factor× the sold count → back to 1000 (not 998).
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'void'])
            ->assertOk();
        $this->assertEquals(1000, $p->fresh()->stock_quantity);
    }

    public function test_returning_a_deal_restores_component_stock(): void
    {
        $burger = $this->makeProduct(['name' => 'Burger', 'price' => 300, 'stock_quantity' => 10]);
        $drink = $this->makeProduct(['name' => 'Drink', 'price' => 100, 'stock_quantity' => 30]);

        $deal = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Combo', 'price' => 500,
            'combo_items' => [
                ['component_product_id' => $burger->id, 'quantity' => 1],
                ['component_product_id' => $drink->id, 'quantity' => 2],
            ],
        ])->assertCreated()->json('data');

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $deal['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(8, $burger->fresh()->stock_quantity);

        // Return 1 of the 2 deals → burger +1 (→9), drink +2 (→28).
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
        ])->assertCreated();
        $this->assertEquals(9, $burger->fresh()->stock_quantity);
        $this->assertEquals(28, $drink->fresh()->stock_quantity);
    }

    // ── CRIT-7: fractional PO receipts fully close ──────────────────

    public function test_fractional_purchase_order_can_be_fully_received(): void
    {
        $rice = $this->makeProduct(['name' => 'Loose Rice', 'sold_by' => 'weight', 'stock_quantity' => 0]);

        $supplierId = $this->actingAsUser($this->owner)->postJson('/api/v1/suppliers', [
            'name' => 'Grain Co', 'phone' => '+92311',
        ])->assertCreated()->json('data.id');

        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => '2026-07-01', 'status' => 'ordered',
            'items' => [['product_id' => $rice->id, 'quantity' => 2.5, 'unit_cost' => 100]],
        ])->assertCreated()->json('data');

        // Receive the full 2.5 kg → the PO must close to 'received' (before the
        // outstanding()→float fix, 2.5 truncated to 2 and the PO stuck open).
        $po2 = $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 2.5]],
        ])->assertOk()->json('data');

        $this->assertSame('received', $po2['status']);
        $this->assertEquals(2.5, $rice->fresh()->stock_quantity);
    }
}
