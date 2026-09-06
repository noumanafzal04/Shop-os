<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A BUSINESS THAT SELLS ONLINE AND NOWHERE ELSE.
 *
 * Every other type assumes a counter: somebody at a till, a drawer to open, a
 * shift to close. An Instagram shop, a home baker, a boutique that only takes
 * orders through the marketplace has none of that — and until this type
 * existed it was handed all of it.
 *
 * The thing this file has to prove is not that the type exists. It is that the
 * MONEY still works: an online sale has to land in the ledger exactly as it
 * does everywhere else, with no special case for this type anywhere.
 */
class OnlineStoreTypeTest extends TestCase
{
    use RefreshDatabase;

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function test_an_online_store_is_offered_at_signup(): void
    {
        $types = BusinessTypes::all();

        $this->assertArrayHasKey('online', $types);
        $this->assertTrue($types['online']['available']);
        $this->assertSame('Online Store', $types['online']['label']);
    }

    public function test_it_gets_the_shop_and_not_the_shop_floor(): void
    {
        $m = BusinessTypes::defaultFeatures('online');

        // What selling online IS — and nothing else. Four.
        foreach (['products', 'marketplace', 'delivery', 'images'] as $on) {
            $this->assertTrue($m[$on], "{$on} should be on for an online store");
        }

        // …and what it is not. `pos` is the one that matters: the default is ON
        // for every other type in the product, because almost every shop has a
        // counter. This one does not, and a till it can never open is a whole
        // menu of screens that refuse.
        // INVENTORY is here on purpose. A home baker does not count stock, and
        // a stock figure nobody maintains is a number everybody learns to
        // distrust. An admin grants it the day a shop wants it.
        foreach ([
            'pos', 'dine_in', 'kitchen', 'reservations', 'stocktake', 'labels', 'fuel',
            'inventory', 'customers', 'purchasing', 'expenses', 'promotions', 'disposals',
        ] as $off) {
            $this->assertFalse($m[$off], "{$off} should be off for an online store");
        }
    }

    public function test_no_other_type_lost_its_till(): void
    {
        // The denominator. `pos` is stated by exactly one type, and the way it
        // is stated — merging the type's own map last — could just as easily
        // have switched it off for everybody.
        foreach (['food', 'mart', 'pharmacy', 'retail', 'grocery'] as $code) {
            $this->assertTrue(
                BusinessTypes::defaultFeatures($code)['pos'],
                "{$code} must keep its POS",
            );
        }
    }

    public function test_an_online_sale_still_lands_in_the_ledger(): void
    {
        // THE POINT OF THE WHOLE TYPE. Completing an online order writes a
        // Sale, which is what the reports, the cashbook and the day summary
        // read. If that needed a special case for this type, the type would be
        // a business nobody could account for.
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'online', 'features' => BusinessTypes::defaultFeatures('online'),
            'delivery_fee' => 0,
        ]);
        $owner = User::factory()->shopOwner($shop)->create();
        $customer = User::factory()->create();

        $product = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Hand-poured Candle', 'price' => 1500, 'cost' => 600,
            'stock_quantity' => 10, 'track_inventory' => true,
        ]);

        $order = $this->as($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $to) {
            $this->as($owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
        }

        $done = Order::withoutTenancy()->find($order['id']);
        $this->assertSame('completed', $done->status->value);
        $this->assertNotNull($done->sale_id, 'an online sale must write a Sale like any other');
        $this->assertSame('paid', $done->payment_status);

        // And the stock moved, once.
        $this->assertSame(8.0, (float) $product->fresh()->stock_quantity);

        $this->assertDatabaseHas('sales', ['id' => $done->sale_id, 'tenant_id' => $shop->id]);
    }

    /**
     * THE WHOLE POINT, WALKED.
     *
     * Four modules — products, images, marketplace, delivery — and nothing
     * else. No inventory, no POS, no customers, no purchasing, no expenses.
     * That is what an Instagram shop actually is: one person with a phone who
     * lists what they sell and takes orders.
     *
     * So the question is not whether the type exists. It is whether a shop
     * given only those four can do the entire job without hitting a single
     * screen that refuses — because a type that offers work it cannot do is a
     * defect this product has already met.
     */
    public function test_the_smallest_online_shop_can_do_the_whole_job(): void
    {
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'online', 'features' => BusinessTypes::defaultFeatures('online'),
            'delivery_fee' => 150,
        ]);
        $owner = User::factory()->shopOwner($shop)->create();
        $customer = User::factory()->create();

        // Exactly four. If this drifts, everything below is testing a bigger
        // shop than the one the type describes.
        $this->assertSame(
            ['delivery', 'images', 'marketplace', 'products'],
            collect($shop->features)->filter()->keys()->sort()->values()->all(),
        );

        // ① LIST WHAT YOU SELL.
        $product = $this->as($owner)->postJson('/api/v1/products', [
            'name' => 'Chocolate Fudge Cake',
            'type' => 'product',
            'item_type' => 'physical_product',
            'price' => 2500,
        ])->assertCreated()->json('data');

        // No inventory module, so it does not pretend to count stock. That is
        // the difference between "we have 0 left" and "we do not count".
        $this->assertFalse((bool) Product::withoutTenancy()->find($product['id'])->track_inventory);

        $this->as($owner)->putJson("/api/v1/products/{$product['id']}", [
            'name' => 'Chocolate Fudge Cake',
            'price' => 2500,
            'visible_in_marketplace' => true,
        ])->assertOk();

        // ② A CUSTOMER FINDS IT AND ORDERS.
        $this->getJson("/api/v1/marketplace/shops/{$shop->slug}")
            ->assertOk()->assertJsonPath('data.business_name', $shop->business_name);

        $order = $this->as($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 4, Gulberg, Lahore',
            'items' => [['product_id' => $product['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertSame('5150.00', $order['total']); // 2 × 2500 + 150 delivery

        // ③ THE SHOP SEES IT AND WORKS IT.
        $this->as($owner)->getJson('/api/v1/orders')
            ->assertOk()->assertJsonPath('data.0.order_number', $order['order_number']);

        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $to) {
            $this->as($owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])
                ->assertOk();
        }

        // ④ AND THE MONEY IS THERE.
        //
        // The sales ledger is gated ANY-of `pos,marketplace,products,services`
        // — so a shop with no till still has a history, which is exactly right:
        // it can never RING a sale and it certainly makes them.
        $sales = $this->as($owner)->getJson('/api/v1/sales')->assertOk()->json('data');
        $this->assertCount(1, $sales);
        $this->assertSame('5000.00', $sales[0]['total']); // goods; delivery is not sale revenue

        $this->assertDatabaseHas('orders', [
            'id' => $order['id'], 'status' => 'completed', 'payment_status' => 'paid',
        ]);
    }

    public function test_the_screens_it_was_not_given_are_closed_rather_than_broken(): void
    {
        // The other half of the same rule. A module that is off must REFUSE,
        // with a reason — not answer with an empty list that reads as "your
        // shop has no customers" when the truth is "your shop has no customer
        // book".
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'online', 'features' => BusinessTypes::defaultFeatures('online'),
        ]);
        $owner = User::factory()->shopOwner($shop)->create();

        foreach (['/api/v1/customers', '/api/v1/purchase-orders', '/api/v1/expenses'] as $closed) {
            $this->as($owner)->getJson($closed)->assertForbidden();
        }

        // …and a till it does not have cannot ring a sale.
        $this->as($owner)->postJson('/api/v1/sales', ['items' => []])->assertForbidden();
    }

    public function test_a_shop_can_be_given_inventory_later_without_anything_breaking(): void
    {
        // "Kuch module assign karein to kaam kare, kuch break na ho." A
        // boutique with twelve dresses wants stock; a home baker does not. The
        // type starts without it and an admin turns it on — and the shop that
        // was already selling keeps selling.
        $shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'online', 'features' => BusinessTypes::defaultFeatures('online'),
            'delivery_fee' => 0,
        ]);
        $owner = User::factory()->shopOwner($shop)->create();
        $customer = User::factory()->create();

        $product = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Scented Candle', 'price' => 900, 'track_inventory' => false,
        ]);

        // Granted, the way an admin grants it.
        $shop->applyModules(['inventory' => true]);
        $this->assertTrue($shop->fresh()->featureEnabled('inventory'));

        // The screen it just gained opens…
        $this->as($owner)->getJson('/api/v1/inventory/ageing')->assertOk();

        // …and the product that predates the module still sells, because it
        // does not track stock and never claimed to.
        $order = $this->as($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $product->id, 'quantity' => 3]],
        ])->assertCreated()->json('data');

        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $to) {
            $this->as($owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $to])->assertOk();
        }

        $this->assertDatabaseHas('orders', ['id' => $order['id'], 'status' => 'completed']);
    }

    public function test_what_it_sells_decides_whether_it_counts_anything(): void
    {
        // The user's own line: "food mein nahi hoti — pizza, burger. Lekin
        // pharmacy, grocery, garments mein hoti hai."
        //
        // A home baker makes a cake when a cake is ordered; there is no stock
        // of cakes, and a quantity on the product would be a number nobody can
        // keep true. A boutique with twelve dresses in one size has exactly
        // twelve, and selling a thirteenth is the whole reason inventory
        // exists.
        $this->assertFalse(
            BusinessTypes::defaultFeatures('online', 'home_kitchen')['inventory'],
            'a home kitchen counts nothing',
        );

        foreach (['online_boutique', 'handmade', 'electronics_online', 'beauty_online'] as $keepsStock) {
            $this->assertTrue(
                BusinessTypes::defaultFeatures('online', $keepsStock)['inventory'],
                "{$keepsStock} sells countable things",
            );
        }

        // Nobody chose a sub-type: the safer default, and one an admin can
        // change in a click.
        $this->assertFalse(BusinessTypes::defaultFeatures('online')['inventory']);
    }

    public function test_a_sub_type_can_add_stock_but_never_take_a_till(): void
    {
        // The rule the food type already relies on, checked for this one: a
        // sub-type only ever turns inventory ON. If it could turn things off,
        // the type and its category would argue and the type would lose.
        $boutique = BusinessTypes::defaultFeatures('online', 'online_boutique');

        $this->assertTrue($boutique['inventory']);
        // …and everything the TYPE decided still stands.
        $this->assertFalse($boutique['pos']);
        $this->assertFalse($boutique['dine_in']);
        $this->assertTrue($boutique['marketplace']);
    }

    public function test_it_can_be_created_from_the_admin_console(): void
    {
        // The create screen reads its list from the API, so a type that is not
        // in the payload cannot be chosen however well it is defined.
        $admin = User::factory()->superAdmin()->create();

        $this->as($admin)->getJson('/api/v1/business-types')
            ->assertOk()
            ->assertJsonFragment(['label' => 'Online Store']);
    }
}
