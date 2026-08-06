<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\Rider;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The order that arrives as a phone call.
 *
 * It is the most common delivery order in Pakistan and the platform had no way
 * to record one: an order could only be created by a logged-in customer through
 * the marketplace, and orders.customer_id was a required foreign key to users.
 *
 * So a shop taking phone orders either rang them at the till as ordinary
 * counter sales — losing the whole fulfilment chain, so no rider could be
 * assigned, no status moved, and the kitchen had nothing to work from — or kept
 * them on a chit beside the phone. And a pharmacy that delivers while selling
 * nothing online had no way in at all, despite riders being deliberately gated
 * on `delivery` for exactly that shop.
 *
 * What these tests hold in place: a counter order joins the SAME chain as a web
 * one — same pricing, same stock holds, same statuses, same riders — while
 * skipping only the gates that exist to protect the shop from strangers.
 */
class CounterOrderTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $pharmacy;

    private User $owner;

    private User $staff;

    private Product $syrup;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Rawalpindi', 'is_active' => true]);

        // The shop this feature exists for: delivers, sells nothing online.
        $features = BusinessTypes::defaultFeatures('pharmacy');
        $features['marketplace'] = false;
        $features['delivery'] = true;

        $this->pharmacy = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy',
            'features' => $features,
            'online_shop_enabled' => false,
            'timezone' => 'UTC',
        ]);

        $this->owner = User::factory()->shopOwner($this->pharmacy)->create(['name' => 'Owner']);
        $this->staff = User::factory()
            ->tenantStaff($this->pharmacy, ['orders.manage'])->create(['name' => 'Counter']);

        $this->syrup = Product::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id, 'type' => 'product',
            'name' => 'Panadol Syrup', 'price' => 250, 'cost' => 180,
            'track_inventory' => true, 'stock_quantity' => 40, 'is_active' => true,
            // Never published online — this shop has no storefront.
            'visible_in_marketplace' => false,
        ]);
    }

    public function test_a_shop_that_sells_nothing_online_can_still_take_a_phone_order(): void
    {
        $order = $this->takeOrder();

        $this->assertSame('phone', $order['channel']);
        $this->assertSame('pending', $order['status']);
        $this->assertNull($order['customer_id']);
        $this->assertSame('Ayesha', $order['customer_name']);
        $this->assertSame('03001234567', $order['customer_phone']);
        // Who picked up the phone — when the address turns out to be wrong,
        // somebody has to be askable.
        $this->assertSame($this->staff->id, $order['created_by']);
    }

    public function test_an_unpublished_product_can_be_sold_to_someone_who_asks_for_it_by_name(): void
    {
        // visible_in_marketplace decides what a stranger may BROWSE. It has
        // nothing to do with what a shop will sell a caller who names it.
        $order = $this->takeOrder();

        $this->assertSame('Panadol Syrup', $order['items'][0]['product_name']);
    }

    public function test_the_server_prices_the_order_not_the_person_typing_it(): void
    {
        // A counter that could type its own prices is a counter that can
        // discount without anyone knowing.
        $order = $this->actingAsUser($this->staff)->postJson('/api/v1/orders', [
            'customer_name' => 'Ayesha',
            'fulfillment_type' => 'pickup',
            'items' => [[
                'product_id' => $this->syrup->id, 'quantity' => 2,
                'unit_price' => 1, 'line_total' => 2,
            ]],
        ])->assertCreated()->json('data');

        $this->assertEquals(250, $order['items'][0]['unit_price']);
        $this->assertEquals(500, $order['total']);
    }

    public function test_a_phone_order_holds_stock_the_same_way_a_web_order_does(): void
    {
        $this->takeOrder(quantity: 3);

        // The bottles are spoken for the moment the call ends. Anything less
        // and the shop sells the same three twice.
        $this->assertEquals(37, $this->syrup->fresh()->stock_quantity);
    }

    public function test_the_caller_lands_in_the_shops_customer_directory(): void
    {
        $this->takeOrder();

        // Captured by phone into the CRM — not made into a platform login,
        // which is a different thing and one they never asked for.
        $customer = Customer::withoutTenancy()
            ->where('tenant_id', $this->pharmacy->id)
            ->where('phone', '03001234567')
            ->first();

        $this->assertNotNull($customer);
        $this->assertSame('Ayesha', $customer->name);
    }

    public function test_a_phone_order_goes_to_a_rider_like_any_other(): void
    {
        $order = $this->takeOrder();

        $rider = Rider::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id,
            'name' => 'Kashif', 'phone' => '03007654321', 'is_active' => true,
        ]);

        // The entire point: one fulfilment chain, whichever door the order
        // came through.
        $this->actingAsUser($this->staff)
            ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed'])->assertOk();
        $this->actingAsUser($this->staff)
            ->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $rider->id])
            ->assertOk();

        $this->assertSame($rider->id, Order::withoutTenancy()->find($order['id'])->rider_id);
    }

    public function test_the_channel_separates_a_phone_call_from_a_web_checkout(): void
    {
        $this->takeOrder();
        $this->takeOrder(channel: 'whatsapp');

        // A shop asking whether its online storefront earns its keep cannot get
        // an answer from a list that treats the two as the same thing.
        $phone = $this->actingAsUser($this->staff)
            ->getJson('/api/v1/orders?channel=phone')->assertOk()->json('data');
        $whatsapp = $this->actingAsUser($this->staff)
            ->getJson('/api/v1/orders?channel=whatsapp')->assertOk()->json('data');

        $this->assertCount(1, $phone);
        $this->assertCount(1, $whatsapp);
    }

    public function test_a_closed_shop_can_still_answer_its_phone(): void
    {
        // Business hours refuse a stranger's checkout at 2am. Somebody
        // answering the phone has already settled the question.
        $this->pharmacy->forceFill([
            'business_hours' => [['day' => (int) now()->dayOfWeek, 'open' => '09:00', 'close' => '09:01']],
        ])->save();

        $this->takeOrder();

        $this->assertSame(1, Order::withoutTenancy()->where('tenant_id', $this->pharmacy->id)->count());
    }

    public function test_a_delivery_beyond_the_radius_is_the_shopkeepers_call_to_make(): void
    {
        // A radius is a promise to strangers, not a rule for the shop's own
        // staff — who are looking at the address and deciding.
        $this->pharmacy->forceFill([
            'latitude' => 33.6, 'longitude' => 73.0,
            'settings' => array_merge($this->pharmacy->settings ?? [], ['delivery_radius_km' => 2]),
        ])->save();

        $order = $this->actingAsUser($this->staff)->postJson('/api/v1/orders', [
            'customer_name' => 'Ayesha',
            'customer_phone' => '03001234567',
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'Bahria Town Phase 8',
            'latitude' => 33.9, 'longitude' => 73.4,
            'items' => [['product_id' => $this->syrup->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('delivery', $order['fulfillment_type']);
    }

    public function test_a_delivery_order_still_needs_an_address(): void
    {
        // The one thing a rider cannot do without.
        $this->actingAsUser($this->staff)->postJson('/api/v1/orders', [
            'customer_name' => 'Ayesha',
            'fulfillment_type' => 'delivery',
            'items' => [['product_id' => $this->syrup->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonValidationErrors('delivery_address');
    }

    public function test_taking_an_order_needs_the_orders_permission(): void
    {
        $cashier = User::factory()
            ->tenantStaff($this->pharmacy, ['sales.manage'])->create(['name' => 'Till only']);

        $this->actingAsUser($cashier)->postJson('/api/v1/orders', [
            'customer_name' => 'Ayesha',
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->syrup->id, 'quantity' => 1]],
        ])->assertForbidden();
    }

    public function test_a_repeated_submission_creates_one_order_not_two(): void
    {
        $payload = [
            'customer_name' => 'Ayesha',
            'customer_phone' => '03001234567',
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->syrup->id, 'quantity' => 1]],
            'idempotency_key' => 'call-4417',
        ];

        // A shop phone in a noisy room gets double-tapped.
        $first = $this->actingAsUser($this->staff)->postJson('/api/v1/orders', $payload)->assertCreated()->json('data');
        $second = $this->actingAsUser($this->staff)->postJson('/api/v1/orders', $payload)->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, Order::withoutTenancy()->where('tenant_id', $this->pharmacy->id)->count());
        $this->assertEquals(39, $this->syrup->fresh()->stock_quantity);
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function takeOrder(float $quantity = 1, string $channel = 'phone'): array
    {
        return $this->actingAsUser($this->staff)->postJson('/api/v1/orders', [
            'channel' => $channel,
            'customer_name' => 'Ayesha',
            'customer_phone' => '03001234567',
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 12, Street 4, Satellite Town',
            'items' => [['product_id' => $this->syrup->id, 'quantity' => $quantity]],
        ])->assertCreated()->json('data');
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
