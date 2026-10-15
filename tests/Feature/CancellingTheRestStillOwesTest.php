<?php

namespace Tests\Feature;

use App\Models\PurchaseOrder;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * CANCELLING THE REST OF AN ORDER DOES NOT CANCEL WHAT CAME.
 *
 * Zari, 2026-10-13: PO-000001 for waistcoats and dupattas; the ten dupattas
 * came (6,000), the rest was cancelled. The 6,000 vanished — from the
 * supplier's balance, the dashboard's "you owe", the payment allocator and the
 * purchases report — because every one of them left a cancelled order out
 * whole. The dupattas were on the shelf, unpaid for, and owed to nobody.
 */
class CancellingTheRestStillOwesTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $supplier;

    private array $po;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $dupatta = $this->as()->postJson('/api/v1/products', ['name' => 'Chiffon Dupatta', 'item_type' => 'physical_product', 'price' => 990, 'cost' => 450, 'track_inventory' => true, 'stock_quantity' => 0])->assertCreated()->json('data.id');
        $scarf = $this->as()->postJson('/api/v1/products', ['name' => 'Silk Scarf', 'item_type' => 'physical_product', 'price' => 1450, 'cost' => 900, 'track_inventory' => true, 'stock_quantity' => 0])->assertCreated()->json('data.id');
        $this->supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
        $this->po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-13', 'status' => 'ordered',
            'items' => [['product_id' => $dupatta, 'quantity' => 10, 'unit_cost' => 600], ['product_id' => $scarf, 'quantity' => 15, 'unit_cost' => 900]],
        ])->assertCreated()->json('data');
        $dupattaLine = collect($this->po['items'])->firstWhere('product_id', $dupatta)['id'];
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", ['items' => [['id' => $dupattaLine, 'quantity' => 10]]])->assertOk();
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/cancel", ['reason' => 'The scarves are not coming'])->assertOk();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function outstanding(): float
    {
        return (float) $this->as()->getJson("/api/v1/suppliers/{$this->supplier}")->assertOk()->json('data.outstanding');
    }

    public function test_the_supplier_is_still_owed_for_what_came(): void
    {
        $this->assertSame('cancelled', PurchaseOrder::withoutTenancy()->find($this->po['id'])->status->value);
        $this->assertSame(6000.0, $this->outstanding(), 'the dupattas on the shelf are owed to nobody');
    }

    public function test_the_dashboard_says_the_same(): void
    {
        $this->assertSame(6000.0, (float) $this->as()->getJson('/api/v1/dashboard')->assertOk()->json('data.money_owed.payable.total'));
    }

    public function test_a_payment_lands_on_the_cancelled_order_it_pays_for(): void
    {
        $this->as()->postJson("/api/v1/suppliers/{$this->supplier}/payments", ['amount' => 6000, 'method' => 'bank_transfer'])->assertSuccessful();

        $this->assertSame(0.0, $this->outstanding());
        $this->assertSame(6000.0, (float) PurchaseOrder::withoutTenancy()->find($this->po['id'])->amount_paid, 'the payment was not set against the order it paid for');
    }

    public function test_the_purchases_report_counts_what_was_kept(): void
    {
        $totals = $this->as()->getJson('/api/v1/reports/purchases?from=2026-10-01&to=2026-10-31')->assertOk()->json('data.totals');

        $this->assertSame(6000.0, (float) $totals['ordered_value'], 'the scarves the shop withdrew were counted as ordered');
        $this->assertSame(6000.0, (float) $totals['outstanding']);
    }

    public function test_a_cancelled_order_with_nothing_received_owes_nothing(): void
    {
        $other = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-13', 'status' => 'ordered',
            'items' => [['product_id' => $this->po['items'][0]['product_id'], 'quantity' => 3, 'unit_cost' => 600]],
        ])->assertCreated()->json('data');
        $this->as()->postJson("/api/v1/purchase-orders/{$other['id']}/cancel", ['reason' => 'Changed our mind'])->assertOk();

        $this->assertSame(6000.0, $this->outstanding());
    }

    public function test_it_can_be_paid_by_naming_the_cancelled_order(): void
    {
        // Tester pass 2 (B33): the Pay sheet offered this order — it still owes
        // for the dupattas that came — and the server refused PO_NOT_PAYABLE.
        $this->as()->postJson("/api/v1/suppliers/{$this->supplier}/payments", [
            'amount' => 2000, 'method' => 'cash', 'purchase_order_id' => $this->po['id'],
        ])->assertCreated();

        $this->assertSame(2000.0, (float) PurchaseOrder::withoutTenancy()->find($this->po['id'])->amount_paid);
        $this->assertSame(4000.0, $this->outstanding());
    }

    public function test_a_cancelled_order_that_took_nothing_is_still_not_paid_against(): void
    {
        $other = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-13', 'status' => 'ordered',
            'items' => [['product_id' => $this->po['items'][0]['product_id'], 'quantity' => 3, 'unit_cost' => 600]],
        ])->assertCreated()->json('data');
        $this->as()->postJson("/api/v1/purchase-orders/{$other['id']}/cancel", ['reason' => 'Changed our mind'])->assertOk();

        $this->as()->postJson("/api/v1/suppliers/{$this->supplier}/payments", [
            'amount' => 500, 'method' => 'cash', 'purchase_order_id' => $other['id'],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PO_NOT_PAYABLE');
        $this->assertSame(6000.0, $this->outstanding());
    }
}
