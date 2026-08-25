<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHICH BRANCH FILLS AN ONLINE ORDER.
 *
 * Until this, always the default one — because nothing on `orders` named a
 * branch and `InventoryService` falls back to Main. A chain with ten in
 * Gulberg and none in Main refused the order and told the customer "only 0 in
 * stock" about a shelf the goods were never going to come off.
 *
 * The rule now: **the nearest branch that actually holds the whole basket.**
 * Nearest alone would turn a customer away whenever the shop round the corner
 * happened to be out of one line, which is precisely what having a second shop
 * is meant to prevent.
 *
 * Distances below are real coordinates roughly 4 km and 12 km from the pin, so
 * the ordering is a property of the geography and not of the row order.
 */
class NearestBranchFillsTheOrderTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $customer;

    private Product $product;

    /** The customer's pin — Gulberg, Lahore. */
    private const PIN = ['lat' => 31.5204, 'lng' => 74.3587];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'delivery_fee' => 0,
        ]);
        User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Sneaker', 'price' => 5000, 'cost' => 3000,
            'track_inventory' => true, 'stock_quantity' => 0, 'is_active' => true,
        ]);
    }

    /** The tenant's own default branch, created with the shop. */
    private function main(): Branch
    {
        return Branch::withoutTenancy()->where('tenant_id', $this->shop->id)
            ->where('is_default', true)->firstOrFail();
    }

    private function branch(string $name, float $lat, float $lng): Branch
    {
        return Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => $name,
            'is_default' => false, 'is_active' => true,
            'latitude' => $lat, 'longitude' => $lng,
        ]);
    }

    private function stock(Branch $branch, float $qty): void
    {
        BranchStock::withoutTenancy()->updateOrCreate(
            ['tenant_id' => $this->shop->id, 'branch_id' => $branch->id,
                'product_id' => $this->product->id, 'variant_id' => null],
            ['quantity' => $qty],
        );
        // The denormalised rollup every non-branch read still uses.
        $this->product->forceFill([
            'stock_quantity' => (float) BranchStock::withoutTenancy()
                ->where('product_id', $this->product->id)->sum('quantity'),
        ])->save();
    }

    /** @return array<string, mixed>|null */
    private function place(int $qty = 2, bool $withPin = true): ?array
    {
        $token = $this->customer->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main Boulevard',
            'latitude' => $withPin ? self::PIN['lat'] : null,
            'longitude' => $withPin ? self::PIN['lng'] : null,
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
        ])->json('data');
    }

    // ── The market scenario ─────────────────────────────────────────

    public function test_the_nearest_branch_fills_it(): void
    {
        // NAMED AGAINST THE ALPHABET ON PURPOSE. The fallback ordering is
        // default-first then by name, so a near branch called "Gulberg" and a
        // far one called "Johar Town" would come out in the right order even
        // with the distance sort switched off — and this test passed exactly
        // that mutation before the names were changed. The near one now sorts
        // LAST by name, so only geography can produce the expected answer.
        $near = $this->branch('Zamzama', 31.5150, 74.3500);   // ~1 km
        $far = $this->branch('Airport Road', 31.4600, 74.2700);  // ~11 km
        $this->stock($near, 10);
        $this->stock($far, 10);

        $order = $this->place();

        $this->assertSame($near->id, $order['branch_id'] ?? Order::query()->find($order['id'])->branch_id);
        $this->assertEquals(8, BranchStock::withoutTenancy()
            ->where('branch_id', $near->id)->value('quantity'), 'the near branch gave up the stock');
        $this->assertEquals(10, BranchStock::withoutTenancy()
            ->where('branch_id', $far->id)->value('quantity'), 'the far branch was untouched');
    }

    public function test_the_nearest_one_that_can_actually_fill_it(): void
    {
        // The whole point of a chain. The nearest shop is out; the next one
        // along has it, and a customer who would have been turned away is not.
        $near = $this->branch('Zamzama', 31.5150, 74.3500);
        $far = $this->branch('Airport Road', 31.4600, 74.2700);
        $this->stock($near, 1);   // not enough for a basket of two
        $this->stock($far, 10);

        $order = $this->place(2);

        $this->assertNotNull($order, 'the order was refused even though the chain had the stock');
        $this->assertSame($far->id, Order::query()->find($order['id'])->branch_id);
        $this->assertEquals(1, BranchStock::withoutTenancy()
            ->where('branch_id', $near->id)->value('quantity'), 'the short branch kept its one');
        $this->assertEquals(8, BranchStock::withoutTenancy()
            ->where('branch_id', $far->id)->value('quantity'));
    }

    public function test_with_no_pin_it_falls_back_to_the_default_branch(): void
    {
        // A phone order, or a customer who never shared a location. Distance is
        // unanswerable, so the shop gets exactly the behaviour it had before
        // rather than a silent reshuffle.
        $other = $this->branch('Airport Road', 31.4600, 74.2700);
        $this->stock($this->main(), 10);
        $this->stock($other, 10);

        $order = $this->place(2, withPin: false);

        $this->assertSame($this->main()->id, Order::query()->find($order['id'])->branch_id);
    }

    public function test_a_single_branch_shop_is_unchanged(): void
    {
        $this->stock($this->main(), 10);

        $order = $this->place();

        $this->assertSame($this->main()->id, Order::query()->find($order['id'])->branch_id);
        $this->assertEquals(8, BranchStock::withoutTenancy()
            ->where('branch_id', $this->main()->id)->value('quantity'));
    }

    public function test_no_branch_holds_it_all_and_the_refusal_names_the_item(): void
    {
        // Two branches with one each: the chain owns two, and no single shop
        // can fill a basket of two. Refused — and the message names the thing,
        // because "no branch has all of this" is true and useless to anybody.
        $near = $this->branch('Zamzama', 31.5150, 74.3500);
        $far = $this->branch('Airport Road', 31.4600, 74.2700);
        $this->stock($near, 1);
        $this->stock($far, 1);

        $token = $this->customer->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $res = $this->withToken($token)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main Boulevard',
            'latitude' => self::PIN['lat'], 'longitude' => self::PIN['lng'],
            'items' => [['product_id' => $this->product->id, 'quantity' => 2]],
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('stock', strtolower((string) $res->json('message')));
        $this->assertSame(0, Order::query()->count(), 'a refused order must not be left half-placed');
    }

    public function test_a_collecting_customer_is_told_which_shop_to_walk_to(): void
    {
        // The obligation this feature creates. A pickup used to come from the
        // default branch every time, so nobody had to be told; now the system
        // chooses, and a customer holding an order for collection has no way of
        // knowing which of five shops to stand outside.
        $near = $this->branch('Zamzama', 31.5150, 74.3500);
        $near->forceFill(['address' => '5 Zamzama Boulevard', 'phone' => '042-111-2222'])->save();
        $far = $this->branch('Airport Road', 31.4600, 74.2700);
        $this->stock($near, 10);
        $this->stock($far, 10);

        $token = $this->customer->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $order = $this->withToken($token)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'pickup',
            'latitude' => self::PIN['lat'], 'longitude' => self::PIN['lng'],
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('Zamzama', $order['branch']['name'] ?? null,
            'a collecting customer was not told which shop is holding their order');
        $this->assertSame('5 Zamzama Boulevard', $order['branch']['address']);
        $this->assertSame('042-111-2222', $order['branch']['phone']);
    }

    // ── And the way back ────────────────────────────────────────────

    public function test_cancelling_returns_the_stock_to_the_branch_it_came_from(): void
    {
        // The half that would go wrong quietly. A hold taken from the far branch and
        // released onto Main leaves both counts wrong in opposite directions,
        // and every shelf in the chain drifts a little further every cancel.
        $near = $this->branch('Zamzama', 31.5150, 74.3500);
        $far = $this->branch('Airport Road', 31.4600, 74.2700);
        $this->stock($near, 1);
        $this->stock($far, 10);

        $order = $this->place(2);
        $this->assertEquals(8, BranchStock::withoutTenancy()->where('branch_id', $far->id)->value('quantity'));

        $owner = User::query()->where('tenant_id', $this->shop->id)->firstOrFail();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token)
            ->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'customer changed their mind'])
            ->assertOk();

        $this->assertEquals(10, BranchStock::withoutTenancy()->where('branch_id', $far->id)->value('quantity'),
            'the release did not go back to the branch the hold came from');
        $this->assertEquals(1, BranchStock::withoutTenancy()->where('branch_id', $near->id)->value('quantity'),
            'stock appeared at a branch that never gave any up');

        $this->assertSame($far->id, StockMovement::query()
            ->where('reference_type', 'order_release')->value('branch_id'));
    }
}
