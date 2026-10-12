<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * EACH BRANCH KEEPS ITS OWN STOCK — and nobody needs a warehouse.
 *
 * The owner's words, after the warehouse was built: "lazmi ni branches
 * warehouse main e stock rkhain — warehouse optional hai kuch bri shops k
 * liye — hr branch ka apna stock udhe b pra ho skta." Most shops with two
 * branches have no godown at all: the supplier's van comes to each shop, each
 * shop counts what it was handed, and each sells what is on its own shelf.
 *
 * `AWarehouseIsAPlaceTest` holds the shapes that HAVE a warehouse. This is the
 * one that does not — two shops, no godown, written out end to end so that
 * nothing built for the warehouse can quietly start requiring one.
 */
class EachBranchKeepsItsOwnStockTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $gulberg;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        // A second SHOP. No warehouse is made anywhere in this file.
        $this->gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
    }

    private function at(Branch $branch): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branch->id]);
    }

    private function onHand(string $productId, Branch $at): float
    {
        return (float) BranchStock::withoutTenancy()->where('branch_id', $at->id)->where('product_id', $productId)->sum('quantity');
    }

    /** A product carded while standing at a branch, with what is on that branch's shelf. */
    private function carded(Branch $at, string $name, float $opening): string
    {
        return $this->at($at)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => $name, 'price' => 1500, 'cost' => 1200,
            'track_inventory' => true, 'stock_quantity' => $opening,
        ])->assertCreated()->json('data.id');
    }

    public function test_the_business_has_two_shops_and_no_warehouse_and_nothing_asks_for_one(): void
    {
        $this->assertSame(0, Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('kind', Branch::KIND_WAREHOUSE)->count());
        $this->assertSame(Branch::KIND_SHOP, $this->main->fresh()->kind);
        $this->assertSame(Branch::KIND_SHOP, $this->gulberg->fresh()->kind);

        $this->at($this->main)->getJson('/api/v1/shop/settings')->assertOk()
            ->assertJsonPath('data.places.shops', 2)
            ->assertJsonPath('data.places.warehouses', 0);
    }

    public function test_what_is_carded_at_a_branch_is_on_that_branchs_shelf(): void
    {
        $rice = $this->carded($this->gulberg, 'Basmati 5kg', 40);

        $this->assertEqualsWithDelta(40, $this->onHand($rice, $this->gulberg), 0.001);
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001, 'Opening stock typed at Gulberg turned up at Main.');
    }

    public function test_each_shop_orders_for_itself_and_the_van_comes_to_that_shop(): void
    {
        $rice = $this->carded($this->main, 'Basmati 5kg', 0);
        $supplier = $this->at($this->main)->postJson('/api/v1/suppliers', ['name' => 'Rice Traders', 'phone' => '+923001112233'])->assertCreated()->json('data.id');

        $order = fn (Branch $from, float $qty): array => $this->at($from)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $rice, 'quantity' => $qty, 'unit_cost' => 1200]],
        ])->assertCreated()->json('data');

        // Raised at Gulberg: addressed to Gulberg. Nobody chose a place.
        $forGulberg = $order($this->gulberg, 30);
        $forMain = $order($this->main, 10);
        $this->assertSame($this->gulberg->id, $forGulberg['deliver_to_branch_id']);
        $this->assertSame($this->main->id, $forMain['deliver_to_branch_id']);

        // Counted in where it arrived — each at its own shop.
        $this->at($this->gulberg)->postJson("/api/v1/purchase-orders/{$forGulberg['id']}/receive")->assertOk();
        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->gulberg), 0.001);
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001, "Gulberg's delivery was put on Main's shelf.");

        $this->at($this->main)->postJson("/api/v1/purchase-orders/{$forMain['id']}/receive")->assertOk();
        $this->assertEqualsWithDelta(10, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->gulberg), 0.001);

        // The business as a whole has forty.
        $this->assertEqualsWithDelta(40, (float) Product::withoutTenancy()->findOrFail($rice)->stock_quantity, 0.001);
    }

    public function test_a_shop_sells_what_is_on_its_own_shelf_and_not_what_is_on_the_others(): void
    {
        $rice = $this->carded($this->gulberg, 'Basmati 5kg', 5);
        $sale = fn (Branch $at, float $qty) => $this->at($at)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $rice, 'quantity' => $qty]],
        ]);

        $sale($this->gulberg, 2)->assertCreated()->assertJsonPath('data.branch_id', $this->gulberg->id);
        $this->assertEqualsWithDelta(3, $this->onHand($rice, $this->gulberg), 0.001);

        // Main has none of it, whatever the business holds in all.
        $sale($this->main, 1)->assertStatus(422);
        $this->assertEqualsWithDelta(3, $this->onHand($rice, $this->gulberg), 0.001, "Main sold Gulberg's stock.");
    }

    public function test_stock_goes_from_one_shop_to_the_other_directly(): void
    {
        $rice = $this->carded($this->main, 'Basmati 5kg', 20);

        // Shop to shop. There is no godown for it to pass through.
        $sent = $this->at($this->main)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'send', 'from_branch_id' => $this->main->id, 'to_branch_id' => $this->gulberg->id,
            'items' => [['product_id' => $rice, 'quantity' => 8]],
        ])->assertCreated()->json('data');

        $this->at($this->gulberg)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk();

        $this->assertEqualsWithDelta(12, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(8, $this->onHand($rice, $this->gulberg), 0.001);
    }
}
