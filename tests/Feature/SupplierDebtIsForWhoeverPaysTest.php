<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT THE SHOP OWES ITS SUPPLIERS IS FOR WHOEVER BUYS, PAYS OR READS THE BOOKS.
 *
 * Tester pass 2 (Q9): anyone with inventory.manage — the stock keeper, the
 * pharmacist, the forecourt attendant — read every supplier's balance (29,400)
 * and every order's total and payment status. The owner (2026-10-14): they see
 * the lines and the quantities, never the debt; the server does not send it.
 *
 * And (B46) a supplier read inside an order said it was owed 0 — its two sums
 * were never loaded. Unknown is now null, not zero.
 */
class SupplierDebtIsForWhoeverPaysTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private PurchaseOrder $po;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        User::factory()->shopOwner($this->shop)->create();

        $rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Basmati 5kg', 'price' => 2400, 'cost' => 1500,
            'track_inventory' => true, 'stock_quantity' => 10, 'is_active' => true,
        ]);
        $mill = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Rehmat Traders', 'is_active' => true]);
        $this->po = PurchaseOrder::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'supplier_id' => $mill->id, 'po_number' => 'PO-000001', 'status' => 'received',
            'order_date' => '2026-10-14', 'subtotal' => 15000, 'total' => 15000, 'received_total' => 15000, 'amount_paid' => 0,
        ]);
        PurchaseOrderItem::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'purchase_order_id' => $this->po->id, 'product_id' => $rice->id,
            'product_name' => 'Basmati 5kg', 'quantity_ordered' => 10, 'quantity_received' => 10, 'unit_cost' => 1500, 'line_total' => 15000,
        ]);
    }

    private function as(string $preset): static
    {
        $user = User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff',
            'permissions' => collect(StaffPresets::all())->firstWhere('code', $preset)['permissions'],
        ]);
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private const DEBT = ['outstanding', 'advance', 'po_total', 'paid_total', 'payments'];

    private const ORDER_MONEY = ['subtotal', 'total', 'amount_paid', 'received_total', 'payment_status'];

    public function test_the_stock_keeper_reads_the_delivery_not_the_debt(): void
    {
        $supplier = $this->as('stock_keeper')->getJson('/api/v1/suppliers')->assertOk()->json('data.0');
        foreach (self::DEBT as $key) {
            $this->assertArrayNotHasKey($key, $supplier, "the supplier list gave the stock keeper {$key}");
        }
        $this->assertSame('Rehmat Traders', $supplier['name']);

        $detail = $this->as('stock_keeper')->getJson("/api/v1/suppliers/{$supplier['id']}")->assertOk()->json('data');
        foreach (self::DEBT as $key) {
            $this->assertArrayNotHasKey($key, $detail, "a supplier's page gave the stock keeper {$key}");
        }

        $order = $this->as('stock_keeper')->getJson("/api/v1/purchase-orders/{$this->po->id}")->assertOk()->json('data');
        foreach (self::ORDER_MONEY as $key) {
            $this->assertArrayNotHasKey($key, $order, "an order gave the stock keeper its {$key}");
        }
        // What taking the delivery in needs is all still there.
        $this->assertEquals(10, $order['items'][0]['quantity_ordered']);
        $this->assertEquals(1500, $order['items'][0]['unit_cost'], 'the stock keeper types the cost on a receipt and lost it');
    }

    public function test_the_buyer_reads_the_debt(): void
    {
        $supplier = $this->as('buyer')->getJson('/api/v1/suppliers')->assertOk()->json('data.0');
        $this->assertEquals(15000, $supplier['outstanding']);

        $order = $this->as('buyer')->getJson("/api/v1/purchase-orders/{$this->po->id}")->assertOk()->json('data');
        $this->assertEquals(15000, $order['total']);
        $this->assertSame('unpaid', $order['payment_status']);
    }

    public function test_a_supplier_inside_an_order_does_not_say_it_is_owed_nothing(): void
    {
        $listed = $this->as('buyer')->getJson('/api/v1/purchase-orders')->assertOk()->json('data.0.supplier');

        $this->assertNotSame(0.0, $listed['outstanding'] ?? null, 'a supplier owed 15,000 read as owed 0');
        $this->assertNull($listed['outstanding'], 'the balance was not worked out here and must say so');
    }
}
