<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "BUSY" — A SHOP PAUSES ONLINE ORDERS FOR A WHILE.
 *
 * A power cut or no gas at 7pm could only be answered by rewriting the saved
 * opening hours and rewriting them back tomorrow. The pause is its own key
 * with an END, so a shop that forgets it is open again by itself. While paused
 * the shop reads as closed everywhere a customer looks, and checkout says why.
 */
class AShopCanPauseOrdersTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'track_inventory' => false, 'visible_in_marketplace' => true, 'is_active' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function order()
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ]);
    }

    public function test_a_paused_shop_reads_closed_and_refuses_orders_saying_it_is_busy(): void
    {
        $this->order()->assertCreated();

        $until = $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', ['minutes' => 30])
            ->assertOk()->json('data.orders_paused_until');
        $this->assertNotNull($until);

        $this->as($this->owner)->getJson('/api/v1/shop/settings')
            ->assertOk()->assertJsonPath('data.orders_paused_until', $until);
        $this->assertFalse($this->shop->fresh()->isOpenNow());
        $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->assertOk()->assertJsonPath('data.is_open_now', false);

        $this->order()->assertUnprocessable()->assertJsonPath('meta.error_code', 'ORDERS_PAUSED');

        $this->as($this->owner)->deleteJson('/api/v1/shop/orders/pause')->assertOk();
        $this->assertTrue($this->shop->fresh()->isOpenNow());
        $this->order()->assertCreated();
    }

    public function test_a_pause_ends_by_itself(): void
    {
        $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', ['minutes' => 15])->assertOk();
        $this->travel(16)->minutes();

        $this->assertNull($this->shop->fresh()->ordersPausedUntil());
        $this->as($this->owner)->getJson('/api/v1/shop/settings')->assertJsonPath('data.orders_paused_until', null);
        $this->order()->assertCreated();
    }

    public function test_rest_of_day_runs_to_the_shops_own_midnight_and_the_pause_is_bounded(): void
    {
        $until = $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', ['rest_of_day' => true])
            ->assertOk()->json('data.orders_paused_until');
        $local = \Illuminate\Support\Carbon::parse($until)->setTimezone($this->shop->timezone ?: 'Asia/Karachi');
        $this->assertSame('23:59', $local->format('H:i'));

        $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', ['minutes' => 2])->assertUnprocessable();
        $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', ['minutes' => 5000])->assertUnprocessable();
        $this->as($this->owner)->postJson('/api/v1/shop/orders/pause', [])->assertUnprocessable();
    }

    public function test_a_customer_cannot_pause_a_shop(): void
    {
        $this->as($this->customer)->postJson('/api/v1/shop/orders/pause', ['minutes' => 30])->assertForbidden();
    }
}
