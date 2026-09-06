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

        // What selling online IS.
        foreach (['products', 'inventory', 'marketplace', 'delivery', 'images', 'customers'] as $on) {
            $this->assertTrue($m[$on], "{$on} should be on for an online store");
        }

        // …and what it is not. `pos` is the one that matters: the default is ON
        // for every other type in the product, because almost every shop has a
        // counter. This one does not, and a till it can never open is a whole
        // menu of screens that refuse.
        foreach (['pos', 'dine_in', 'kitchen', 'reservations', 'stocktake', 'labels', 'fuel'] as $off) {
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
