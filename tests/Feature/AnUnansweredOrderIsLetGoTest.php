<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

/**
 * AN UNANSWERED ORDER IS LET GO — an online order nobody at the shop accepted
 * within the platform's time is cancelled, its stock let go, and the customer
 * and the shop are both told. A transfer order is given twice as long.
 */
class AnUnansweredOrderIsLetGoTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'settings' => ['transfer_details' => 'JazzCash 0300 1234567'],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->item = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Rice', 'price' => 1000,
            'stock_quantity' => 10, 'track_inventory' => true,
        ]);
        PlatformSettings::put(['accept_within_minutes' => 10]);
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }

    private function place(array $over = []): string
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', $over + [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => 'House 1',
            'items' => [['product_id' => $this->item->id, 'quantity' => 2]],
        ])->assertCreated()->json('data.id');
    }

    private function stock(): float
    {
        return (float) Product::withoutTenancy()->findOrFail($this->item->id)->stock_quantity;
    }

    public function test_an_order_nobody_accepted_in_time_is_cancelled_its_stock_freed_and_both_told(): void
    {
        $id = $this->place();
        $this->assertEquals(8, $this->stock());

        $this->travel(9)->minutes();
        Artisan::call('orders:cancel-unaccepted');
        $this->assertSame('pending', Order::withoutTenancy()->findOrFail($id)->status->value);

        $this->travel(2)->minutes();
        Artisan::call('orders:cancel-unaccepted');
        $order = Order::withoutTenancy()->findOrFail($id);
        $this->assertSame('cancelled', $order->status->value);
        $this->assertStringContainsString('did not accept it in time', $order->cancel_reason);
        $this->assertEquals(10, $this->stock());

        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->customer->id, 'type' => 'order.cancelled']);
        $this->assertDatabaseHas('app_notifications', ['user_id' => $this->owner->id, 'type' => 'order.expired']);
    }

    public function test_an_accepted_order_and_one_the_shop_took_itself_are_never_touched(): void
    {
        $accepted = $this->place();
        $this->as($this->owner)->postJson("/api/v1/orders/{$accepted}/advance", ['status' => 'confirmed'])->assertOk();

        $phoned = $this->as($this->owner)->postJson('/api/v1/orders', [
            'fulfillment_type' => 'delivery', 'delivery_address' => 'Round the corner',
            'customer_name' => 'Caller', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->assertCreated()->json('data.id');
        Order::withoutTenancy()->whereKey($phoned)->update(['status' => 'pending']);

        $this->travel(30)->minutes();
        Artisan::call('orders:cancel-unaccepted');

        $this->assertSame('confirmed', Order::withoutTenancy()->findOrFail($accepted)->status->value);
        $this->assertSame('pending', Order::withoutTenancy()->findOrFail($phoned)->status->value);
    }

    public function test_a_transfer_is_given_twice_as_long_and_the_rule_can_be_switched_off(): void
    {
        $transfer = $this->place(['payment_method' => 'transfer', 'payment_reference' => 'TX123456']);

        $this->travel(15)->minutes();
        Artisan::call('orders:cancel-unaccepted');
        $this->assertSame('pending', Order::withoutTenancy()->findOrFail($transfer)->status->value);

        $this->travel(6)->minutes();
        Artisan::call('orders:cancel-unaccepted');
        $this->assertSame('cancelled', Order::withoutTenancy()->findOrFail($transfer)->status->value);

        PlatformSettings::put(['accept_within_minutes' => 0]);
        $kept = $this->place();
        $this->travel(2)->hours();
        Artisan::call('orders:cancel-unaccepted');
        $this->assertSame('pending', Order::withoutTenancy()->findOrFail($kept)->status->value);
    }
}
