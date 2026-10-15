<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * AN ITEM'S OPENING STOCK IS IN ITS STOCK HISTORY.
 *
 * The user (2026-10-15): "inventory track ho rhi jb product create krty, us
 * product ki inventory and barcode b". A grocer carded a biscuit with 24 on
 * hand; its stock said 24 and its history said "No movements yet" — nothing
 * on the item explained where the 24 came from.
 */
class AnItemsOpeningStockIsInItsHistoryTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->actingAs($this->owner);
    }

    /** @return list<array{type: string, change: float, after: float, reason: ?string, ref: ?string, size: ?string}> */
    private function history(string $productId): array
    {
        return collect($this->getJson("/api/v1/inventory/movements?product_id={$productId}")->assertOk()->json('data'))
            ->map(fn (array $m): array => [
                'type' => $m['type'], 'change' => (float) $m['quantity_change'], 'after' => (float) $m['quantity_after'],
                'reason' => $m['reason'], 'ref' => $m['reference_type'], 'size' => $m['variant_id'],
            ])->all();
    }

    public function test_a_counted_item_opens_with_its_opening_stock(): void
    {
        $made = $this->postJson('/api/v1/products', [
            'name' => 'Biscuit 100g', 'item_type' => 'physical_product', 'price' => 120, 'cost' => 90,
            'track_inventory' => true, 'stock_quantity' => 24, 'barcode' => '8964000111222',
        ])->assertCreated()->json('data');

        $this->assertSame([['type' => 'in', 'change' => 24.0, 'after' => 24.0, 'reason' => 'Opening stock', 'ref' => 'opening', 'size' => null]], $this->history($made['id']));

        // And it moves on from there: a sale of 2 is the next line, after 22.
        $this->postJson('/api/v1/inventory/adjust', ['product_id' => $made['id'], 'type' => 'out', 'quantity' => 2, 'reason' => 'Damaged'])->assertSuccessful();
        $this->assertSame([24.0, 22.0], collect($this->history($made['id']))->pluck('after')->sort()->reverse()->values()->all());
    }

    public function test_nothing_is_written_for_nothing(): void
    {
        $untracked = $this->postJson('/api/v1/products', ['name' => 'Gift wrap', 'item_type' => 'physical_product', 'price' => 50, 'track_inventory' => false, 'stock_quantity' => 10])->assertCreated()->json('data.id');
        $empty = $this->postJson('/api/v1/products', ['name' => 'Rusk', 'item_type' => 'physical_product', 'price' => 80, 'track_inventory' => true, 'stock_quantity' => 0])->assertCreated()->json('data.id');

        $this->assertSame([], $this->history($untracked));
        $this->assertSame([], $this->history($empty));
    }

    public function test_each_size_opens_with_its_own_stock_and_so_does_one_added_later(): void
    {
        $made = $this->postJson('/api/v1/products', [
            'name' => 'Lawn Kurta', 'item_type' => 'physical_product', 'price' => 2950, 'track_inventory' => true,
            'variants' => [['name' => 'M', 'price' => 2950, 'stock_quantity' => 5], ['name' => 'L', 'price' => 2950, 'stock_quantity' => 3]],
        ])->assertCreated()->json('data');
        $sizes = collect($made['variants'])->pluck('id', 'name');

        $opened = collect($this->history($made['id']))->where('ref', 'opening');
        $this->assertSame([5.0, 3.0], [$opened->firstWhere('size', $sizes['M'])['change'] ?? null, $opened->firstWhere('size', $sizes['L'])['change'] ?? null]);
        $this->assertSame(8.0, $opened->sum('change'), 'the sizes\' opening stock was written more than once');

        // XL added on the edit form, with 4.
        $this->putJson("/api/v1/products/{$made['id']}", [
            'variants' => [
                ['id' => $sizes['M'], 'name' => 'M', 'price' => 2950],
                ['id' => $sizes['L'], 'name' => 'L', 'price' => 2950],
                ['name' => 'XL', 'price' => 2950, 'stock_quantity' => 4],
            ],
        ])->assertOk();
        $this->assertSame(12.0, collect($this->history($made['id']))->where('ref', 'opening')->sum('change'));
    }
}
