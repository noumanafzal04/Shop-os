<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT IS RUNNING OUT — asked twice, answered two different ways.
 *
 * `ProductController` (the catalogue's `?low_stock=1` filter) sums a product's
 * SIZES before comparing:
 *
 *     (select coalesce(sum(pv.stock_quantity), 0) from product_variants pv
 *      where pv.product_id = products.id and pv.deleted_at is null)
 *          <= low_stock_threshold
 *
 * `InventoryController::lowStock` — the **Needs reordering** list, the screen a
 * buyer actually orders from — reads `products.stock_quantity` instead. For a
 * product with sizes that column is what `Product::effectiveStock()` calls an
 * orphaned leftover that must not be read as truth: the stock lives on the
 * variants, and the parent keeps whatever it was created with, usually nought.
 *
 * So a shirt shop with two hundred shirts in stock is told to reorder every one
 * of them, every day, for ever — and the list that is meant to say what to buy
 * says everything. A trader stops reading it in a week, which is the same as
 * not having it.
 *
 * It bites exactly the trades built on sizes: retail (size/colour), pharmacy
 * (strength), a diner (portion).
 */
class ReorderListSeesSizesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /**
     * A product sold in sizes. `stock_quantity` on the PARENT is deliberately
     * left at nought — that is what the catalogue does for a varianted item,
     * and it is the whole point: the truth is on the rows below.
     */
    private function sized(string $name, float $threshold, array $sizes): Product
    {
        $product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'item_type' => 'physical_product', 'name' => $name, 'price' => 1500,
            'track_inventory' => true, 'stock_quantity' => 0,
            'low_stock_threshold' => $threshold,
        ]);

        foreach ($sizes as $size => $onHand) {
            ProductVariant::withoutTenancy()->create([
                'tenant_id' => $this->shop->id, 'product_id' => $product->id,
                'name' => $size, 'price' => 1500, 'stock_quantity' => $onHand,
            ]);
        }

        return $product;
    }

    /** @return list<string> the names the reorder list came back with */
    private function reorderList(): array
    {
        return collect(
            $this->actingAsUser($this->owner)
                ->getJson('/api/v1/inventory/low-stock')
                ->assertOk()
                ->json('data')
        )->pluck('name')->all();
    }

    public function test_a_well_stocked_shirt_is_not_on_the_reorder_list(): void
    {
        // 200 shirts across three sizes, against a threshold of 10.
        $this->sized('Oxford Shirt', 10, ['Small' => 60, 'Medium' => 80, 'Large' => 60]);

        $this->assertNotContains(
            'Oxford Shirt',
            $this->reorderList(),
            'a shirt with 200 in stock was put on the list of things to buy — '
            .'the reorder list read the parent column instead of the sizes',
        );
    }

    public function test_a_shirt_that_really_is_running_out_still_appears(): void
    {
        // THE DENOMINATOR. A fix that simply drops every varianted product
        // would satisfy the test above and destroy the feature.
        $this->sized('Linen Shirt', 10, ['Small' => 2, 'Medium' => 3, 'Large' => 1]);

        $this->assertContains(
            'Linen Shirt',
            $this->reorderList(),
            'six shirts left against a threshold of ten, and the list stayed quiet',
        );
    }

    public function test_a_plain_product_is_unaffected(): void
    {
        // The regression guard: most shops have no sizes at all.
        Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'item_type' => 'physical_product', 'name' => 'Leather Belt', 'price' => 900,
            'track_inventory' => true, 'stock_quantity' => 2, 'low_stock_threshold' => 10,
        ]);

        $this->assertContains('Leather Belt', $this->reorderList());
    }

    public function test_the_dashboard_count_matches_the_list_it_links_to(): void
    {
        // The number a shopkeeper sees first. It had the bug twice over: the
        // shop-wide arm read the parent column, and the branch arm joined
        // `branch_stock` with `whereNull(variant_id)` — which skips precisely
        // the rows a sized product's stock lives on.
        $this->sized('Oxford Shirt', 10, ['Small' => 60, 'Medium' => 80]);
        $this->sized('Linen Shirt', 10, ['Small' => 2, 'Medium' => 1]);

        $dashboard = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')
            ->assertOk()
            ->json('data.low_stock_count');

        $this->assertSame(
            count($this->reorderList()),
            $dashboard,
            'the dashboard counted a different number of items than the list it sends you to',
        );
        $this->assertSame(1, $dashboard, 'only the Linen Shirt is actually low');
    }

    public function test_an_order_raised_for_a_sized_product_asks_for_the_right_number(): void
    {
        // `threshold - onHand`, and `onHand` was the parent's orphaned nought —
        // so a shop three shirts short was sent an order for ten.
        $shirt = $this->sized('Linen Shirt', 10, ['Small' => 4, 'Medium' => 3]);

        // The list only orders from somebody the shop has bought from before —
        // correctly, so a real order never lands in front of a stranger.
        $supplier = Supplier::withoutTenancy()
            ->create(['tenant_id' => $this->shop->id, 'name' => 'Ravi Textiles']);
        $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier->id,
            'order_date' => now()->modify('-2 months')->toDateString(),
            'items' => [['product_id' => $shirt->id, 'quantity' => 5, 'unit_cost' => 800]],
        ])->assertCreated();

        $order = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/purchase-orders/from-reorder-list', ['product_ids' => [$shirt->id]])
            ->assertCreated()
            ->json('data');

        $po = PurchaseOrder::query()->with('items')->findOrFail($order[0]['id']);

        // 7 on hand against a threshold of 10 → 3 short, not 10.
        $this->assertEqualsWithDelta(
            3.0,
            (float) $po->items->first()->quantity_ordered,
            0.001,
            'the order asked for a full threshold instead of the shortfall',
        );
    }

    public function test_the_catalogue_and_the_reorder_list_agree(): void
    {
        // One question, one answer, whichever screen asks it. This is the check
        // that stops the two drifting apart again.
        $this->sized('Oxford Shirt', 10, ['Small' => 60, 'Medium' => 80]);
        $this->sized('Linen Shirt', 10, ['Small' => 2, 'Medium' => 1]);

        $catalogue = collect(
            $this->actingAsUser($this->owner)
                ->getJson('/api/v1/products?low_stock=1')
                ->assertOk()
                ->json('data')
        )->pluck('name')->sort()->values()->all();

        $reorder = collect($this->reorderList())->sort()->values()->all();

        $this->assertSame(
            $catalogue,
            $reorder,
            'the catalogue and the reorder list disagree about what is running out',
        );
    }
}
