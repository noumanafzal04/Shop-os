<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockDisposal;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT THE BROKEN CARTON COST.
 *
 * Every shop was given the Disposals module and only a pharmacy could put
 * anything in it. The one writer of a disposal row was deleting a BATCH, and a
 * mart, a clothing shop, a hardware store or a tyre shop keeps most of its
 * stock in no batch at all.
 *
 * Those shops were not unable to take the stock off the shelf — Inventory →
 * Adjust → out, reason "Damaged" has always worked. They were unable to record
 * what it COST, because `stock_movements` has no money column of any kind. So
 * the register the shop was handed, whose own words are "Stock that left
 * without being sold", stayed empty for ever, and the year's shrinkage could
 * not be totalled from anything the product stored.
 *
 * These are the claims that fail if that reopens.
 */
class WhatTheBrokenCartonCostTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => Modules::defaultsFor('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking Oil 5L', 'price' => 2800, 'cost' => 2400,
            'stock_quantity' => 40, 'track_inventory' => true,
        ], $attrs));
    }

    public function test_a_mart_can_write_off_damaged_stock_and_the_loss_carries_its_cost(): void
    {
        $product = $this->product();

        $row = $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id,
            'quantity' => 3,
            'disposition' => StockDisposal::WRITTEN_OFF,
            'reason' => 'damaged',
            'notes' => 'Carton fell off the trolley.',
        ])->assertCreated()->json('data');

        // THE WHOLE POINT. Not "a row exists" — a row that says what it cost.
        $this->assertSame(2400.0, (float) $row['unit_cost']);
        $this->assertSame(7200.0, (float) $row['total_cost']);

        // And the shelf moved by exactly the same three.
        $this->assertSame(37.0, (float) $product->fresh()->stock_quantity);
    }

    public function test_the_loss_appears_on_the_register_that_claims_to_list_it(): void
    {
        $product = $this->product();

        $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 2,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertCreated();

        $rows = $this->as()->getJson('/api/v1/inventory/disposals?disposition=written_off')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame(4800.0, (float) $rows[0]['total_cost']);
        $this->assertSame('Cooking Oil 5L', $rows[0]['product_name']);
    }

    /**
     * A stock movement with no money on it is what the shop had INSTEAD. This
     * asserts the two halves are joined, so a write-off can be traced from the
     * shelf to the loss and back.
     */
    public function test_the_write_off_and_the_stock_movement_point_at_each_other(): void
    {
        $product = $this->product();

        $row = $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 1,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertCreated()->json('data');

        $this->assertNotNull($row['stock_movement_id']);
        $this->assertDatabaseHas('stock_movements', [
            'id' => $row['stock_movement_id'],
            'reference_type' => 'stock_disposal',
            'reference_id' => $row['id'],
            'type' => 'out',
        ]);
    }

    public function test_stock_sent_back_for_credit_is_not_counted_as_a_loss(): void
    {
        $product = $this->product();
        $supplier = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Metro Wholesale'])
            ->assertCreated()->json('data.id');

        $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 5,
            'disposition' => StockDisposal::RETURNED, 'reason' => 'damaged',
            'supplier_id' => $supplier, 'credit_expected' => 12000,
        ])->assertCreated();

        // Written-off is the loss. A return is money not yet lost and not yet
        // back — summing the two overstates the loss by the whole claim.
        $this->assertCount(0, $this->as()->getJson('/api/v1/inventory/disposals?disposition=written_off')
            ->assertOk()->json('data'));
        $this->assertCount(1, $this->as()->getJson('/api/v1/inventory/disposals?awaiting_credit=1')
            ->assertOk()->json('data'));
    }

    /**
     * THE REFUSAL, AND WHY IT IS NOT A GAP.
     *
     * A disposal row carries one batch number and one expiry. Writing off six
     * strips of a medicine held in four lots would have to pick a lot or
     * invent one, and the figure a pharmacist needs — which lot went in the
     * bin — would be wrong with nothing downstream able to tell.
     */
    public function test_an_item_held_in_lots_is_sent_to_the_lot(): void
    {
        $product = $this->product(['name' => 'Paracetamol 500mg']);

        $this->as()->postJson("/api/v1/inventory/products/{$product->id}/batches", [
            'batch_number' => 'B-114', 'quantity' => 20, 'cost' => 12,
        ])->assertCreated();

        $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 2,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'expired',
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WRITE_OFF_IS_LOT_TRACKED');

        // Nothing was written off and nothing left the shelf.
        $this->assertSame(0, StockDisposal::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
    }

    /**
     * THE DENOMINATOR for that refusal: it must be about LOTS, not about this
     * endpoint refusing everybody. The same shop, the same call, an item with
     * no lot — and it goes through.
     */
    public function test_the_lot_refusal_is_about_lots_and_not_about_the_door(): void
    {
        $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $this->product(['name' => 'Floor Cleaner'])->id, 'quantity' => 2,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertCreated();
    }

    /** A shop cannot bin more than it has — the one rule stock arithmetic owns. */
    public function test_more_cannot_be_written_off_than_is_on_the_shelf(): void
    {
        $product = $this->product(['stock_quantity' => 4]);

        $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 9,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertStatus(422);

        $this->assertSame(4.0, (float) $product->fresh()->stock_quantity);
    }

    /**
     * Nothing recorded is NULL, not zero. Zero is a claim that the carton was
     * free, and a shrinkage total built on it would read as a smaller loss
     * than the shop really took.
     */
    public function test_an_unknown_cost_stays_unknown(): void
    {
        $product = $this->product(['name' => 'Gift Wrap', 'cost' => null]);

        $row = $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'quantity' => 2,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertCreated()->json('data');

        $this->assertNull($row['unit_cost']);
        $this->assertNull($row['total_cost']);
    }

    /** A sized item loses a SIZE. The parent holds no stock of its own. */
    public function test_a_size_is_what_gets_written_off(): void
    {
        $product = $this->product(['name' => 'Kurta', 'cost' => 900, 'stock_quantity' => 0]);
        $small = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $product->id,
            'name' => 'Small', 'price' => 1800, 'cost' => 950, 'stock_quantity' => 10,
        ]);

        $row = $this->as()->postJson('/api/v1/inventory/disposals', [
            'product_id' => $product->id, 'variant_id' => $small->id, 'quantity' => 2,
            'disposition' => StockDisposal::WRITTEN_OFF, 'reason' => 'damaged',
        ])->assertCreated()->json('data');

        // The SIZE's own cost, not the parent's.
        $this->assertSame(950.0, (float) $row['unit_cost']);
        $this->assertSame('Kurta — Small', $row['product_name']);
        $this->assertSame(8.0, (float) $small->fresh()->stock_quantity);
    }
}
