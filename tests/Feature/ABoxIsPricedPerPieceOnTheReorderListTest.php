<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE LAST PURCHASE IS PRICED PER PIECE ON THE REORDER LIST.
 *
 * Tester pass 2 (B32): Silk Dupatta was last bought as a "Box of 5" at 3,600
 * a box. The reorder list orders pieces and drafted 37 × 3,600 = 133,200 —
 * the box's price on every dupatta. 720 a piece is what one cost.
 */
class ABoxIsPricedPerPieceOnTheReorderListTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_line_bought_in_boxes_is_drafted_at_the_piece_price(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($shop)->create();
        $as = function () use ($owner): static {
            $this->app['auth']->forgetGuards();

            return $this->withToken($owner->createToken('t', ['access'])->plainTextToken);
        };

        $dupatta = $as()->postJson('/api/v1/products', [
            'name' => 'Silk Dupatta', 'item_type' => 'physical_product', 'price' => 1200, 'cost' => 700,
            'track_inventory' => true, 'stock_quantity' => 3, 'low_stock_threshold' => 10,
            'units' => [['name' => 'Box of 5', 'factor' => 5]],
        ])->assertCreated()->json('data');
        $box = $dupatta['units'][0]['id'];
        $mill = $as()->postJson('/api/v1/suppliers', ['name' => 'Gul Textile Mills'])->assertCreated()->json('data.id');

        $po = $as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $mill, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $dupatta['id'], 'product_unit_id' => $box, 'quantity' => 2, 'unit_cost' => 3600]],
        ])->assertCreated()->json('data');
        $as()->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])->assertOk();

        $drafted = $as()->postJson('/api/v1/purchase-orders/from-reorder-list', ['product_ids' => [$dupatta['id']]])
            ->assertSuccessful()->json('data');
        $line = collect($drafted['orders'] ?? $drafted)->flatMap(fn ($o) => $o['items'] ?? [])->firstWhere('product_id', $dupatta['id']);

        $this->assertNotNull($line, 'the dupatta was not drafted: '.json_encode($drafted));
        $this->assertEquals(720, (float) $line['unit_cost'], 'a box\'s price was put on each piece');
    }
}
