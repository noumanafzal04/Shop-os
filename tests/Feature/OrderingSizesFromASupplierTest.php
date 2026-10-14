<?php

namespace Tests\Feature;

use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A CLOTHING SHOP ORDERS SIZES, NOT DESIGNS.
 *
 * Zari, 2026-10-13: the order form offered "Men's Waistcoat" and nothing
 * more, so the order went to Faisalabad Mills for the design — and the
 * stockroom could never take it in, because a design in sizes holds no stock
 * of its own ("say which size"). The form now offers the sizes; the server
 * refuses an order line for a sized design that names none, and the reorder
 * list names such designs instead of drafting orders nobody could receive.
 */
class OrderingSizesFromASupplierTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private array $waistcoat;

    private string $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->waistcoat = $this->as()->postJson('/api/v1/products', [
            'name' => "Men's Waistcoat", 'item_type' => 'physical_product', 'price' => 4500, 'cost' => 2600, 'track_inventory' => true,
            'variants' => [['name' => 'M', 'price' => 4500, 'stock_quantity' => 0], ['name' => 'L', 'price' => 4500, 'stock_quantity' => 0]],
        ])->assertCreated()->json('data');
        $this->supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sizeId(string $name): string
    {
        return collect($this->waistcoat['variants'])->firstWhere('name', $name)['id'];
    }

    private function order(array $items): TestResponse
    {
        return $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-13', 'status' => 'ordered', 'items' => $items,
        ]);
    }

    public function test_an_order_for_the_design_is_refused_and_says_why(): void
    {
        $this->order([['product_id' => $this->waistcoat['id'], 'quantity' => 5, 'unit_cost' => 2700]])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED')
            ->assertJsonPath('message', "Men's Waistcoat is sold in sizes — order it size by size.");
    }

    public function test_an_order_for_sizes_is_received_into_those_sizes(): void
    {
        $po = $this->order([
            ['product_id' => $this->waistcoat['id'], 'variant_id' => $this->sizeId('M'), 'quantity' => 5, 'unit_cost' => 2700],
            ['product_id' => $this->waistcoat['id'], 'variant_id' => $this->sizeId('L'), 'quantity' => 3, 'unit_cost' => 2800],
        ])->assertCreated()->json('data');

        $this->assertSame('2026-10-13', $po['order_date'], 'a calendar day went out as a moment');

        $this->as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])->assertOk();

        $m = ProductVariant::withoutTenancy()->find($this->sizeId('M'));
        $l = ProductVariant::withoutTenancy()->find($this->sizeId('L'));
        $this->assertSame([5.0, 3.0], [(float) $m->stock_quantity, (float) $l->stock_quantity], 'the delivery did not reach the sizes');
        $this->assertSame([2700.0, 2800.0], [(float) $m->cost, (float) $l->cost], 'each size did not take what it cost');
    }

    public function test_the_reorder_list_names_a_sized_design_instead_of_drafting_it(): void
    {
        $this->as()->postJson('/api/v1/purchase-orders/from-reorder-list', ['product_ids' => [$this->waistcoat['id']]])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');
    }
}
