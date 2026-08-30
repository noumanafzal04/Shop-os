<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'name' => 'Widget',
            'price' => 100,
            'stock_quantity' => 10,
            'low_stock_threshold' => 3,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── A product sold in sizes holds no stock of its own ───────────

    /**
     * THE ADJUSTMENT THAT SAID "STOCK UPDATED" AND MOVED NOTHING.
     *
     * `products.stock_quantity` is an orphaned leftover once a product has
     * sizes — `effectiveStock()` sums the sizes and never reads it. Adjusting
     * the parent wrote twenty shirts into that column, answered 201 "Stock
     * updated", and left the till, the catalogue and the reorder list saying
     * exactly what they said before. Measured on the unfixed code:
     *
     *     status 201 · effectiveStock before 12, after 12
     *     products.stock_quantity 0 -> 20
     *
     * StartStockCountAction already stated this rule in a comment. The path a
     * shopkeeper actually presses did not enforce it.
     */
    public function test_adjusting_a_product_sold_in_sizes_is_refused(): void
    {
        $shirt = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Shirt',
            'price' => 1500, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        foreach (['S' => 5, 'M' => 7] as $name => $qty) {
            ProductVariant::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'product_id' => $shirt->id,
                'name' => $name, 'price' => 1500, 'stock_quantity' => $qty,
            ]);
        }

        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $shirt->id, 'type' => 'in', 'quantity' => 20,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');

        // Nothing moved, including the orphaned column it used to land in.
        $this->assertEquals(12, $shirt->fresh()->effectiveStock());
        $this->assertEquals(0, $shirt->fresh()->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()->where('product_id', $shirt->id)->count());
    }

    /**
     * The same rule reached through the OTHER door: a lot.
     *
     * A batch filed against the parent left the lot on the books and the size
     * at zero — a chemist books in fifty strips of 10mg and the 10mg still
     * cannot be dispensed. The refusal must also roll the lot back; a batch row
     * surviving a refused stock-in is the worse half of that bug.
     */
    public function test_a_lot_on_a_product_sold_in_sizes_must_name_the_size(): void
    {
        $syrup = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Augmentin',
            'price' => 500, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $ml250 = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $syrup->id,
            'name' => '250mg', 'price' => 500, 'stock_quantity' => 0,
        ]);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/products/{$syrup->id}/batches", [
                'batch_number' => 'NO-SIZE', 'quantity' => 50,
            ])->assertStatus(422)->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');

        $this->assertSame(0, ProductBatch::withoutTenancy()
            ->where('product_id', $syrup->id)->count(), 'a refused stock-in left its lot behind');

        // Denominator: with the size named it goes in, and onto that size.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/products/{$syrup->id}/batches", [
                'batch_number' => '250-A', 'quantity' => 50, 'variant_id' => $ml250->id,
            ])->assertCreated();

        $this->assertEquals(50, $ml250->fresh()->stock_quantity);
        $this->assertEquals(50, $syrup->fresh()->effectiveStock());
    }

    /** The denominator: naming the size adjusts that size, and only that one. */
    public function test_adjusting_one_size_moves_that_size(): void
    {
        $shirt = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Shirt',
            'price' => 1500, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $small = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $shirt->id,
            'name' => 'S', 'price' => 1500, 'stock_quantity' => 5,
        ]);
        $medium = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $shirt->id,
            'name' => 'M', 'price' => 1500, 'stock_quantity' => 7,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $shirt->id, 'variant_id' => $small->id, 'type' => 'in', 'quantity' => 20,
        ])->assertCreated();

        $this->assertEquals(25, $small->fresh()->stock_quantity);
        $this->assertEquals(7, $medium->fresh()->stock_quantity, 'a size that was not named moved');
        $this->assertEquals(32, $shirt->fresh()->effectiveStock());
    }

    // ── Stock in / out / set ────────────────────────────────────────

    public function test_stock_in_increases_and_records_movement(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'type' => 'in',
            'quantity' => 5,
            'reason' => 'Supplier delivery',
        ])->assertCreated()
            ->assertJsonPath('data.quantity_change', '5.000')
            ->assertJsonPath('data.quantity_after', '15.000');

        $this->assertEquals(15, $this->product->fresh()->stock_quantity);
    }

    public function test_stock_out_decreases(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'type' => 'out',
            'quantity' => 4,
        ])->assertCreated()->assertJsonPath('data.quantity_after', '6.000');
    }

    public function test_set_recounts_absolute_quantity(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'type' => 'set',
            'new_quantity' => 42,
            'reason' => 'Physical recount',
        ])->assertCreated()
            ->assertJsonPath('data.quantity_change', '32.000')
            ->assertJsonPath('data.quantity_after', '42.000');
    }

    public function test_stock_can_never_go_negative(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'type' => 'out',
            'quantity' => 11, // only 10 in stock
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        // Nothing was applied.
        $this->assertEquals(10, $this->product->fresh()->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_idempotency_key_replays_without_double_applying(): void
    {
        $payload = [
            'product_id' => $this->product->id,
            'type' => 'out',
            'quantity' => 3,
            'idempotency_key' => 'sale-abc-123',
        ];

        $first = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/adjust', $payload)
            ->assertCreated()
            ->json('data');

        // Retry (double-tap / network retry) — same movement, no re-apply.
        $second = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/adjust', $payload)
            ->assertCreated()
            ->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertEquals(7, $this->product->fresh()->stock_quantity);
        $this->assertSame(1, StockMovement::withoutTenancy()->count());
    }

    public function test_variant_stock_adjusts_independently(): void
    {
        $variant = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'product_id' => $this->product->id,
            'name' => 'Red / L',
            'price' => 100,
            'stock_quantity' => 5,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'variant_id' => $variant->id,
            'type' => 'in',
            'quantity' => 2,
        ])->assertCreated()->assertJsonPath('data.quantity_after', '7.000');

        // Variant changed, parent product untouched.
        $this->assertEquals(7, $variant->fresh()->stock_quantity);
        $this->assertEquals(10, $this->product->fresh()->stock_quantity);
    }

    public function test_service_items_cannot_be_adjusted(): void
    {
        $service = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'service',
            'name' => 'Haircut',
            'price' => 500,
            'track_inventory' => false,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $service->id,
            'type' => 'in',
            'quantity' => 5,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PRODUCT_NOT_TRACKED');
    }

    public function test_variant_of_other_product_rejected(): void
    {
        $otherProduct = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product',
            'name' => 'Other', 'price' => 10,
        ]);
        $foreignVariant = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $otherProduct->id,
            'name' => 'X', 'price' => 10,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id,
            'variant_id' => $foreignVariant->id,
            'type' => 'in',
            'quantity' => 1,
        ])->assertStatus(422);
    }

    // ── History / low stock ─────────────────────────────────────────

    public function test_movement_history_is_ordered_and_filterable(): void
    {
        foreach ([['in', 5], ['out', 2]] as [$type, $qty]) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
                'product_id' => $this->product->id, 'type' => $type, 'quantity' => $qty,
            ]);
        }

        $all = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/movements')
            ->assertOk()
            ->json('data');
        $this->assertCount(2, $all);

        $outs = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/movements?type=out')
            ->json('data');
        $this->assertCount(1, $outs);
        $this->assertEquals(-2, $outs[0]['quantity_change']);
    }

    public function test_low_stock_endpoint_and_dashboard_count(): void
    {
        // Drop Widget to its threshold.
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id, 'type' => 'set', 'new_quantity' => 3,
        ]);

        $low = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/low-stock')
            ->assertOk()
            ->json('data');
        $this->assertCount(1, $low);
        $this->assertSame('Widget', $low[0]['name']);

        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()
            ->assertJsonPath('data.low_stock_count', 1)
            ->assertJsonPath('data.products_count', 1);
    }

    // ── Authorization & isolation ───────────────────────────────────

    public function test_staff_without_inventory_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id, 'type' => 'in', 'quantity' => 1,
        ])->assertStatus(403);
    }

    public function test_staff_with_inventory_permission_allowed(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::INVENTORY_MANAGE])->create();

        $this->actingAsUser($staff)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id, 'type' => 'in', 'quantity' => 1,
        ])->assertCreated();
    }

    public function test_cannot_adjust_another_tenants_product(): void
    {
        $otherTenant = Tenant::factory()->provisioned()->create();
        $otherOwner = User::factory()->shopOwner($otherTenant)->create();

        $this->actingAsUser($otherOwner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id, // belongs to tenant A
            'type' => 'in',
            'quantity' => 5,
        ])->assertStatus(422); // fails validation — product invisible to tenant B

        $this->assertEquals(10, $this->product->fresh()->stock_quantity);
    }

    public function test_movements_are_tenant_isolated(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $this->product->id, 'type' => 'in', 'quantity' => 5,
        ]);

        $otherTenant = Tenant::factory()->provisioned()->create();
        $otherOwner = User::factory()->shopOwner($otherTenant)->create();

        $foreign = $this->actingAsUser($otherOwner)
            ->getJson('/api/v1/inventory/movements')
            ->assertOk()
            ->json('data');

        $this->assertCount(0, $foreign);
    }

    /**
     * A REFUSAL HAS TO SAY WHICH THING.
     *
     * "Insufficient stock: only 0 in stock." reached the counter, the order
     * form and the transfer screen with nothing in it anybody could act on. A
     * basket of nine items told the shop one of them was short and would not
     * say which, so the only way through was to pull lines out one at a time
     * until it stopped complaining.
     */
    public function test_a_stock_refusal_names_the_item_it_is_about(): void
    {
        $rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->product->tenant_id,
            'type' => 'product',
            'name' => 'Basmati Rice 1kg',
            'sku' => 'RICE-1',
            'price' => 520,
            'stock_quantity' => 2,
        ]);

        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $rice->id,
            'type' => 'out',
            'quantity' => 5,
            'reason' => 'Sold more than the shelf held',
        ])->assertStatus(422);

        $response->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');
        $this->assertStringContainsString(
            'Basmati Rice 1kg',
            $response->json('message'),
            'the refusal must name the item — a shop cannot act on "only 0 in stock"',
        );
        // …and it still says how many there are, which is the other half of
        // what makes it actionable.
        $this->assertStringContainsString('2', $response->json('message'));
    }
}
