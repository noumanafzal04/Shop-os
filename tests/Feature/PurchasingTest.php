<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class PurchasingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Widget', 'price' => 200, 'cost' => 120, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeSupplier(): string
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/suppliers', [
            'name' => 'Acme Traders', 'contact_person' => 'Ali', 'phone' => '+92300',
        ])->assertCreated()->json('data.id');
    }

    private function makePO(string $supplierId, int $qty = 20, float $cost = 100, string $status = 'ordered'): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId,
            'order_date' => '2026-07-01',
            'status' => $status,
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty, 'unit_cost' => $cost]],
        ])->assertCreated()->json('data');
    }

    // ── Suppliers ───────────────────────────────────────────────────

    public function test_supplier_crud(): void
    {
        $id = $this->makeSupplier();
        $this->actingAsUser($this->owner)->getJson('/api/v1/suppliers')->assertOk()
            ->assertJsonPath('meta.pagination.total', 1);

        $this->actingAsUser($this->owner)->putJson("/api/v1/suppliers/{$id}", ['name' => 'Acme Ltd'])
            ->assertOk()->assertJsonPath('data.name', 'Acme Ltd');

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/suppliers/{$id}")->assertOk();
        $this->assertSame(0, Supplier::withoutTenancy()->count());
    }

    // ── PO lifecycle ────────────────────────────────────────────────

    public function test_create_po_computes_totals(): void
    {
        $po = $this->makePO($this->makeSupplier(), qty: 20, cost: 100);
        $this->assertSame('PO-000001', $po['po_number']);
        $this->assertSame('ordered', $po['status']);
        $this->assertEquals(2000, $po['subtotal']);
        $this->assertEquals(2000, $po['total']);
    }

    public function test_draft_must_be_placed_before_receiving(): void
    {
        $po = $this->makePO($this->makeSupplier(), status: 'draft');
        $this->assertSame('draft', $po['status']);

        // Cannot receive a draft.
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'PO_NOT_RECEIVABLE');

        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/place")
            ->assertOk()->assertJsonPath('data.status', 'ordered');
    }

    public function test_receive_all_moves_stock_in_and_closes_po(): void
    {
        $po = $this->makePO($this->makeSupplier(), qty: 20);

        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertOk()->assertJsonPath('data.status', 'received');

        $this->assertEquals(30, $this->product->fresh()->stock_quantity); // 10 + 20
        $this->assertSame(1, StockMovement::withoutTenancy()->where('reference_type', 'purchase_order')->count());
    }

    public function test_partial_receipt_keeps_po_open(): void
    {
        $po = $this->makePO($this->makeSupplier(), qty: 20);
        $itemId = $po['items'][0]['id'];

        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $itemId, 'quantity' => 8]],
        ])->assertOk()->assertJsonPath('data.status', 'partially_received');

        $this->assertEquals(18, $this->product->fresh()->stock_quantity); // 10 + 8

        // Receive the rest → closes.
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertOk()->assertJsonPath('data.status', 'received');
        $this->assertEquals(30, $this->product->fresh()->stock_quantity);
    }

    public function test_non_inventory_item_receives_without_stock_move(): void
    {
        $food = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Sauce', 'price' => 50, 'track_inventory' => false,
        ]);
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->makeSupplier(), 'order_date' => '2026-07-01', 'status' => 'ordered',
            'items' => [['product_id' => $food->id, 'quantity' => 5, 'unit_cost' => 30]],
        ])->json('data');

        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")
            ->assertOk()->assertJsonPath('data.status', 'received');
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_buying_in_packs_stocks_base_units_and_lands_a_per_unit_batch(): void
    {
        // Panadol counted in tablets; bought in Boxes of 100.
        $panadol = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Panadol', 'price' => 12, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $box = $panadol->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'Box', 'factor' => 100]);

        // Order 5 boxes @ Rs 900/box.
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->makeSupplier(), 'order_date' => '2026-07-01', 'status' => 'ordered',
            'items' => [['product_id' => $panadol->id, 'product_unit_id' => $box->id, 'quantity' => 5, 'unit_cost' => 900]],
        ])->assertCreated()->json('data');

        $this->assertSame('4500.00', $po['items'][0]['line_total']); // 900 × 5 boxes
        $this->assertSame('Box', $po['items'][0]['unit_name']);

        // Medicine receipt must carry an expiry (dated lot).
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 5, 'expiry_date' => now()->addYear()->toDateString()]],
        ])->assertOk()->assertJsonPath('data.status', 'received');

        // 5 boxes × 100 = 500 tablets in stock.
        $this->assertEquals(500, $panadol->fresh()->stock_quantity);
        // Batch landed in base units, at per-tablet cost 900/100 = 9.00.
        $batch = $panadol->batches()->first();
        $this->assertEquals(500, $batch->quantity);
        $this->assertSame('9.00', (string) $batch->cost);
        $this->assertNotNull($batch->expiry_date);
    }

    public function test_receiving_a_medicine_without_an_expiry_is_rejected(): void
    {
        $med = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Ceftum', 'price' => 400, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->makeSupplier(), 'order_date' => '2026-07-01', 'status' => 'ordered',
            'items' => [['product_id' => $med->id, 'quantity' => 20, 'unit_cost' => 300]],
        ])->assertCreated()->json('data');

        // Receiving a medicine line with no expiry is blocked — nothing moves.
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 20]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'EXPIRY_REQUIRED');
        $this->assertEquals(0, $med->fresh()->stock_quantity);

        // With an expiry it receives into a dated lot.
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 20, 'expiry_date' => now()->addYear()->toDateString()]],
        ])->assertOk();
        $this->assertEquals(20, $med->fresh()->stock_quantity);
    }

    // ── Payments ────────────────────────────────────────────────────

    public function test_supplier_payment_updates_po_and_balance(): void
    {
        $supplierId = $this->makeSupplier();
        $po = $this->makePO($supplierId, qty: 20, cost: 100); // total 2000

        $this->actingAsUser($this->owner)->postJson("/api/v1/suppliers/{$supplierId}/payments", [
            'amount' => 500, 'method' => 'cash', 'purchase_order_id' => $po['id'],
        ])->assertCreated();

        $fresh = $this->actingAsUser($this->owner)->getJson("/api/v1/purchase-orders/{$po['id']}")->json('data');
        $this->assertEquals(500, $fresh['amount_paid']);
        $this->assertSame('partial', $fresh['payment_status']);

        // Supplier outstanding = 2000 - 500 = 1500.
        $supplier = $this->actingAsUser($this->owner)->getJson("/api/v1/suppliers/{$supplierId}")->json('data');
        $this->assertEquals(1500, $supplier['outstanding']);
    }

    public function test_overpayment_rejected(): void
    {
        $supplierId = $this->makeSupplier();
        $po = $this->makePO($supplierId, qty: 20, cost: 100); // total 2000

        $this->actingAsUser($this->owner)->postJson("/api/v1/suppliers/{$supplierId}/payments", [
            'amount' => 2500, 'purchase_order_id' => $po['id'],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_EXCEEDS_DUE');
    }

    public function test_cancel_po_voids_it(): void
    {
        $po = $this->makePO($this->makeSupplier());
        $this->actingAsUser($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Duplicate'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    // ── Authz / isolation ───────────────────────────────────────────

    public function test_staff_without_purchase_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/purchase-orders')->assertStatus(403);
        $this->actingAsUser($staff)->getJson('/api/v1/suppliers')->assertStatus(403);
    }

    public function test_suppliers_isolated_per_tenant(): void
    {
        $this->makeSupplier();
        $other = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($other)->getJson('/api/v1/suppliers')->json('meta.pagination.total'));
    }
}
