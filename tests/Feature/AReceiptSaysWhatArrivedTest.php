<?php

namespace Tests\Feature;

use App\Models\ProductVariant;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A RECEIPT THAT LISTS WHAT ARRIVED HAS SAID EVERYTHING.
 *
 * Found 2026-10-13 while mending old size costs from purchase receipts: an
 * order for Mediums and Larges where only the Mediums came. The stock keeper
 * sets Large to 0 on the receive sheet; the sheet leaves a 0 line out (the
 * server takes nothing below 0.001); and the server read "not listed" as "all
 * of it arrived". Ten Larges went into stock that were still at the mill, the
 * supplier was owed for them, and their price was blended into the cost.
 *
 * Sent with no list at all, a receipt still means "everything owed arrived".
 */
class AReceiptSaysWhatArrivedTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $m;

    private string $l;

    private array $po;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();

        $kurta = $this->as()->postJson('/api/v1/products', [
            'name' => 'Cotton Kurta', 'item_type' => 'physical_product', 'price' => 2950, 'cost' => 1600, 'track_inventory' => true,
            'variants' => [['name' => 'M', 'price' => 2950, 'stock_quantity' => 0], ['name' => 'L', 'price' => 2950, 'stock_quantity' => 0]],
        ])->assertCreated()->json('data');
        $this->m = collect($kurta['variants'])->firstWhere('name', 'M')['id'];
        $this->l = collect($kurta['variants'])->firstWhere('name', 'L')['id'];

        $supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
        $this->po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [
                ['product_id' => $kurta['id'], 'variant_id' => $this->m, 'quantity' => 10, 'unit_cost' => 1700],
                ['product_id' => $kurta['id'], 'variant_id' => $this->l, 'quantity' => 10, 'unit_cost' => 1800],
            ],
        ])->assertCreated()->json('data');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function line(string $size): string
    {
        return collect($this->po['items'])->firstWhere('variant_id', $size)['id'];
    }

    private function receivedOf(string $size): float
    {
        return (float) PurchaseOrderItem::withoutTenancy()->whereKey($this->line($size))->value('quantity_received');
    }

    private function stockOf(string $size): float
    {
        return (float) ProductVariant::withoutTenancy()->whereKey($size)->value('stock_quantity');
    }

    public function test_a_line_left_off_the_receipt_did_not_arrive(): void
    {
        // What the sheet sends with L set to 0: the Mediums only.
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", [
            'items' => [['id' => $this->line($this->m), 'quantity' => 10]],
        ])->assertOk();

        $this->assertSame(10.0, $this->receivedOf($this->m));
        $this->assertSame(0.0, $this->receivedOf($this->l), 'a size that never came was booked as received');
        $this->assertSame(10.0, $this->stockOf($this->m));
        $this->assertSame(0.0, $this->stockOf($this->l), 'goods still at the mill went into stock');
        $order = PurchaseOrder::withoutTenancy()->findOrFail($this->po['id']);
        $this->assertSame(17000.0, (float) $order->received_total, 'the supplier is owed for goods that never came');
        $this->assertSame('partially_received', $order->status->value);
    }

    public function test_a_receipt_listing_nothing_receives_nothing(): void
    {
        // Every line set to 0: the sheet sends an empty list.
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", ['items' => []])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'PO_NOTHING_TO_RECEIVE');

        $this->assertSame(0.0, $this->receivedOf($this->m));
        $this->assertSame(0.0, $this->stockOf($this->l));
    }

    public function test_with_no_list_at_all_everything_owed_arrived(): void
    {
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", [])->assertOk();

        $this->assertSame(10.0, $this->stockOf($this->m));
        $this->assertSame(10.0, $this->stockOf($this->l));
    }

    public function test_the_rest_comes_later_on_its_own_receipt(): void
    {
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", ['items' => [['id' => $this->line($this->m), 'quantity' => 10]]])->assertOk();
        $this->as()->postJson("/api/v1/purchase-orders/{$this->po['id']}/receive", ['items' => [['id' => $this->line($this->l), 'quantity' => 4]]])->assertOk();

        $this->assertSame(10.0, $this->stockOf($this->m), 'the second receipt booked the first line again');
        $this->assertSame(4.0, $this->stockOf($this->l));
    }
}
