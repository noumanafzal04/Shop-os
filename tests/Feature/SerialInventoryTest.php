<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductSerial;
use App\Models\SaleItemSerial;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Serial inventory: capture IMEIs/serials when goods are RECEIVED, track them
 * in_stock → sold → back to in_stock on a per-serial return / cancel. The POS
 * can still type a serial that was never formally received (legacy) — the sale
 * records it either way.
 */
class SerialInventoryTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $phone; // serialized

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->phone = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Galaxy A55', 'price' => 50000, 'cost' => 40000, 'stock_quantity' => 0,
            'track_inventory' => true, 'tracks_serial' => true, 'warranty_months' => 12,
        ]);
    }

    private function req(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Create + receive a PO of $qty phones carrying $serials. */
    private function receive(int $qty, array $serials): TestResponse
    {
        $supplierId = $this->req()->postJson('/api/v1/suppliers', ['name' => 'Distributor'])->json('data.id');
        $po = $this->req()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->phone->id, 'quantity' => $qty, 'unit_cost' => 40000]],
        ])->json('data');

        return $this->req()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => $qty, 'serials' => $serials]],
        ]);
    }

    private function sell(array $serials): TestResponse
    {
        return $this->req()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 50000 * count($serials),
            'items' => [['product_id' => $this->phone->id, 'quantity' => count($serials), 'serials' => $serials]],
        ]);
    }

    // ── Receiving ────────────────────────────────────────────────────

    public function test_receiving_serials_puts_them_in_stock(): void
    {
        $this->receive(2, ['IMEI-1', 'IMEI-2'])->assertOk();

        $this->assertSame(2, ProductSerial::withoutTenancy()->where('product_id', $this->phone->id)->where('status', 'in_stock')->count());

        $listed = $this->req()->getJson("/api/v1/products/{$this->phone->id}/serials")->assertOk()->json('data');
        $this->assertCount(2, $listed);
        $this->assertEqualsCanonicalizing(['IMEI-1', 'IMEI-2'], collect($listed)->pluck('serial')->all());
    }

    public function test_cannot_receive_more_serials_than_units(): void
    {
        $this->receive(1, ['IMEI-1', 'IMEI-2'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'SERIAL_COUNT_EXCEEDS_QTY');
    }

    public function test_cannot_receive_the_same_serial_twice(): void
    {
        $this->receive(1, ['IMEI-DUP'])->assertOk();
        $this->receive(1, ['IMEI-DUP'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'SERIAL_ALREADY_REGISTERED');
    }

    public function test_cannot_receive_serials_for_a_non_serialized_product(): void
    {
        $plain = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cable', 'price' => 500, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $supplierId = $this->req()->postJson('/api/v1/suppliers', ['name' => 'D'])->json('data.id');
        $po = $this->req()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $plain->id, 'quantity' => 1, 'unit_cost' => 300]],
        ])->json('data');

        $this->req()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 1, 'serials' => ['X1']]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'SERIAL_NOT_TRACKED');
    }

    // ── Selling from stock ───────────────────────────────────────────

    public function test_selling_a_received_serial_marks_it_sold(): void
    {
        $this->receive(2, ['IMEI-1', 'IMEI-2'])->assertOk();

        $this->sell(['IMEI-1'])->assertCreated();

        $this->assertSame('sold', ProductSerial::withoutTenancy()->where('serial', 'IMEI-1')->first()->status);
        // One left in stock.
        $inStock = $this->req()->getJson("/api/v1/products/{$this->phone->id}/serials?status=in_stock")->json('data');
        $this->assertCount(1, $inStock);
        $this->assertSame('IMEI-2', $inStock[0]['serial']);
    }

    public function test_a_sold_registry_serial_cannot_be_sold_again(): void
    {
        $this->receive(1, ['IMEI-1'])->assertOk();
        $this->sell(['IMEI-1'])->assertCreated();

        $this->sell(['IMEI-1'])->assertStatus(422)->assertJsonPath('meta.error_code', 'SERIAL_ALREADY_SOLD');
    }

    // ── Per-serial return ────────────────────────────────────────────

    public function test_per_serial_return_frees_the_unit_for_resale(): void
    {
        $this->receive(2, ['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');

        // Return only IMEI-1.
        $this->req()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1, 'serials' => ['IMEI-1']]],
        ])->assertCreated();

        // IMEI-1 back in stock + its sale record marked returned; IMEI-2 still sold.
        $this->assertSame('in_stock', ProductSerial::withoutTenancy()->where('serial', 'IMEI-1')->first()->status);
        $this->assertSame('sold', ProductSerial::withoutTenancy()->where('serial', 'IMEI-2')->first()->status);
        $this->assertNotNull(SaleItemSerial::withoutTenancy()->where('serial', 'IMEI-1')->first()->returned_at);

        // And it can be sold again.
        $this->sell(['IMEI-1'])->assertCreated();
    }

    public function test_returning_a_serial_not_on_the_line_is_rejected(): void
    {
        $this->receive(1, ['IMEI-1'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');

        $this->req()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1, 'serials' => ['IMEI-NOPE']]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RETURN_SERIAL_INVALID');
    }

    public function test_returned_serial_count_must_match_quantity(): void
    {
        $this->receive(2, ['IMEI-1', 'IMEI-2'])->assertOk();
        $sale = $this->sell(['IMEI-1', 'IMEI-2'])->assertCreated()->json('data');

        // Returning qty 2 but only naming one serial.
        $this->req()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2, 'serials' => ['IMEI-1']]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RETURN_SERIAL_COUNT_MISMATCH');
    }

    public function test_cancelling_a_sale_frees_its_serials(): void
    {
        $this->receive(1, ['IMEI-1'])->assertOk();
        $sale = $this->sell(['IMEI-1'])->assertCreated()->json('data');

        $this->req()->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        $this->assertSame('in_stock', ProductSerial::withoutTenancy()->where('serial', 'IMEI-1')->first()->status);
        $this->sell(['IMEI-1'])->assertCreated(); // resellable
    }
}
