<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * "These are running out" → orders somebody can send.
 *
 * ── The link that was missing ───────────────────────────────────────────
 *
 * The reorder list has always known what is running out. Purchase Orders has
 * always known how to buy. Nothing joined them, so the buyer read one screen
 * and typed every line into the other by hand — the work the list exists to
 * save, done twice.
 *
 * ── The assertion that carries this ─────────────────────────────────────
 *
 * Not that it makes an order. That it makes **one per supplier**.
 *
 * The obvious version is wrong in a way that only shows up in a real shop: a
 * grocer's Monday reorder list holds twenty lines from five distributors, and
 * a single purchase order containing all twenty is not an order anybody can
 * send. `test_one_order_per_supplier` is the whole feature.
 */
class ReorderToPurchaseOrderTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $mart;

    private User $owner;

    private Supplier $wholesaler;

    private Supplier $dairy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->mart = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->mart)->create();

        $this->wholesaler = $this->supplier('City Wholesalers');
        $this->dairy = $this->supplier('Green Valley Dairy');
    }

    private function supplier(string $name): Supplier
    {
        return Supplier::withoutTenancy()->create(['tenant_id' => $this->mart->id, 'name' => $name]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /** A stocked product sitting below its own reorder level. */
    private function lowItem(string $name, float $onHand = 2, float $threshold = 10): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->mart->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 500, 'track_inventory' => true,
            'stock_quantity' => $onHand, 'low_stock_threshold' => $threshold,
        ]);
    }

    /** Record that this shop once bought this item from this supplier. */
    private function boughtBefore(Product $product, Supplier $from, float $cost, string $on = '-2 months'): PurchaseOrder
    {
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $from->id,
            'order_date' => now()->modify($on)->toDateString(),
            'items' => [['product_id' => $product->id, 'quantity' => 5, 'unit_cost' => $cost]],
        ])->assertCreated();

        return PurchaseOrder::query()->findOrFail($po->json('data.id'));
    }

    private function raise(array $products): TestResponse
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders/from-reorder-list', [
            'product_ids' => collect($products)->pluck('id')->all(),
        ]);
    }

    public function test_one_order_per_supplier(): void
    {
        // THE assertion. Twenty lines from five distributors is five orders,
        // not one — a single order containing all of them is not something a
        // shop can send to anybody.
        $sugar = $this->lowItem('Sugar 1kg');
        $rice = $this->lowItem('Rice 5kg');
        $milk = $this->lowItem('Milk 1L');

        $this->boughtBefore($sugar, $this->wholesaler, 180);
        $this->boughtBefore($rice, $this->wholesaler, 1300);
        $this->boughtBefore($milk, $this->dairy, 200);

        $orders = $this->raise([$sugar, $rice, $milk])->assertCreated()->json('data');

        $this->assertCount(2, $orders);

        $bySupplier = collect($orders)->keyBy('supplier_id');
        $this->assertCount(2, $bySupplier->get($this->wholesaler->id)['items']);
        $this->assertCount(1, $bySupplier->get($this->dairy->id)['items']);
    }

    public function test_the_supplier_is_the_one_it_was_last_bought_from(): void
    {
        // Last, not cheapest and not most frequent. "Cheapest ever" quotes a
        // price nobody will honour today; "most often" keeps proposing the
        // distributor the shop stopped using in March.
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->dairy, 150, '-6 months');
        $this->boughtBefore($sugar, $this->wholesaler, 190, '-1 week');

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertSame($this->wholesaler->id, $orders[0]['supplier_id']);
    }

    public function test_the_last_price_paid_comes_with_it(): void
    {
        // Not a quote — a defensible starting figure on a draft. A blank cost
        // means the whole order gets typed by hand anyway, which is the thing
        // this exists to stop.
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->wholesaler, 187.50);

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertEquals(187.50, $orders[0]['items'][0]['unit_cost']);
    }

    public function test_it_orders_enough_to_get_back_above_the_reorder_level(): void
    {
        // The shortfall, and nothing cleverer. Ordering "double" or "a month's
        // cover" would be a number invented here rather than chosen by the
        // shop, and an invented number on a real order is a guess dressed as
        // advice.
        $sugar = $this->lowItem('Sugar 1kg', onHand: 2, threshold: 10);
        $this->boughtBefore($sugar, $this->wholesaler, 180);

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertEquals(8, $orders[0]['items'][0]['quantity_ordered']);
    }

    public function test_an_item_exactly_on_its_threshold_still_orders_one(): void
    {
        // Shortfall zero. It is on the list because the shop said this is the
        // level at which it buys more, and an order line for nothing is not an
        // order line.
        $sugar = $this->lowItem('Sugar 1kg', onHand: 10, threshold: 10);
        $this->boughtBefore($sugar, $this->wholesaler, 180);

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertEquals(1, $orders[0]['items'][0]['quantity_ordered']);
    }

    public function test_nothing_is_ever_placed_only_drafted(): void
    {
        // Every quantity and price here is a suggestion built from history.
        // The one thing this must never do is commit a shop to buying.
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->wholesaler, 180);

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertSame('draft', $orders[0]['status']);
    }

    public function test_an_item_never_bought_before_is_named_not_guessed(): void
    {
        // Putting it on somebody's order because they were first in the list
        // would send a real order to a stranger.
        $sugar = $this->lowItem('Sugar 1kg');
        $newThing = $this->lowItem('Imported olive oil');
        $this->boughtBefore($sugar, $this->wholesaler, 180);

        $res = $this->raise([$sugar, $newThing])->assertCreated();

        $this->assertCount(1, $res->json('data'));
        $this->assertStringContainsString('Imported olive oil', $res->json('message'));
    }

    public function test_a_list_with_no_history_at_all_refuses_and_says_why(): void
    {
        $newThing = $this->lowItem('Imported olive oil');

        $this->raise([$newThing])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NO_SUPPLIER_HISTORY');
    }

    public function test_a_cancelled_order_is_not_a_relationship(): void
    {
        // It says what somebody intended once and then thought better of.
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->wholesaler, 180, '-6 months');
        $abandoned = $this->boughtBefore($sugar, $this->dairy, 999, '-1 week');

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/purchase-orders/{$abandoned->id}/cancel")
            ->assertOk();

        $orders = $this->raise([$sugar])->assertCreated()->json('data');

        $this->assertSame($this->wholesaler->id, $orders[0]['supplier_id']);
    }

    public function test_the_reorder_list_itself_says_who_to_buy_from(): void
    {
        // Without this the screen can offer the button and not explain it, and
        // a buyer pressing a button that names no supplier is guessing.
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->wholesaler, 187.50);

        $row = collect(
            $this->actingAsUser($this->owner)
                ->getJson('/api/v1/inventory/low-stock')
                ->assertOk()
                ->json('data'),
        )->firstWhere('id', $sugar->id);

        $this->assertSame('City Wholesalers', $row['last_supplier_name']);
        $this->assertEquals(187.50, $row['last_unit_cost']);
    }

    public function test_a_product_never_bought_shows_no_supplier_rather_than_a_wrong_one(): void
    {
        $newThing = $this->lowItem('Imported olive oil');

        $row = collect(
            $this->actingAsUser($this->owner)
                ->getJson('/api/v1/inventory/low-stock')
                ->assertOk()
                ->json('data'),
        )->firstWhere('id', $newThing->id);

        $this->assertNull($row['last_supplier_id']);
    }

    public function test_a_cashier_cannot_raise_orders(): void
    {
        $cashier = User::factory()->tenantStaff($this->mart, ['sales.manage'])->create();
        $sugar = $this->lowItem('Sugar 1kg');
        $this->boughtBefore($sugar, $this->wholesaler, 180);

        $this->actingAsUser($cashier)
            ->postJson('/api/v1/purchase-orders/from-reorder-list', ['product_ids' => [$sugar->id]])
            ->assertForbidden();
    }
}
