<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class OrdersTest extends TestCase
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

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'), // delivery + marketplace on
            'delivery_fee' => 150,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Sneaker', 'price' => 5000, 'cost' => 3000, 'stock_quantity' => 5,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function place(array $overrides = []): array
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', array_merge([
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->product->id, 'quantity' => 2]],
        ], $overrides))->json('data');
    }

    // ── Placement ───────────────────────────────────────────────────

    public function test_customer_places_order_holds_stock_and_adds_delivery_fee(): void
    {
        $order = $this->place();

        $this->assertSame('ORD-000001', $order['order_number']);
        $this->assertSame('pending', $order['status']);
        $this->assertSame('10000.00', $order['subtotal']);
        $this->assertSame('150.00', $order['delivery_fee']);
        $this->assertSame('10150.00', $order['total']);

        // Stock held immediately.
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);

        // Owner notified.
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->owner->id, 'type' => 'order.placed',
        ]);
    }

    public function test_pickup_has_no_delivery_fee(): void
    {
        $order = $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null]);
        $this->assertSame('0.00', $order['delivery_fee']);
        $this->assertSame('10000.00', $order['total']);
    }

    public function test_delivery_requires_address(): void
    {
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['delivery_address']]);
    }

    public function test_oversell_rolls_back_completely(): void
    {
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 6]], // only 5
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        $this->assertSame(0, Order::withoutTenancy()->count());
        $this->assertEquals(5, $this->product->fresh()->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_double_submit_is_idempotent(): void
    {
        $payload = [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
            'idempotency_key' => 'checkout-1',
        ];

        $a = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', $payload)->json('data');
        $b = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', $payload)->json('data');

        $this->assertSame($a['id'], $b['id']);
        $this->assertSame(1, Order::withoutTenancy()->count());
        $this->assertEquals(4, $this->product->fresh()->stock_quantity); // decremented once
    }

    public function test_order_number_is_sequential_per_tenant(): void
    {
        $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null]);
        $second = $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null, 'items' => [['product_id' => $this->product->id, 'quantity' => 1]]]);
        $this->assertSame('ORD-000002', $second['order_number']);
    }

    public function test_shop_without_online_cannot_take_orders(): void
    {
        $this->shop->forceFill(['online_shop_enabled' => false])->save();

        // Not visible → 404 at the marketplace lookup.
        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertStatus(404);
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    private function advance(string $orderId, string $status): TestResponse
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/orders/{$orderId}/advance", ['status' => $status]);
    }

    public function test_full_delivery_lifecycle_completes_into_a_sale(): void
    {
        $order = $this->place();

        $this->advance($order['id'], 'confirmed')->assertOk();
        $this->advance($order['id'], 'preparing')->assertOk();
        $this->advance($order['id'], 'out_for_delivery')->assertOk();
        $this->advance($order['id'], 'completed')->assertOk()->assertJsonPath('data.status', 'completed');

        // A Sale was produced (online channel) and stock net = held qty.
        $this->assertSame(1, Sale::withoutTenancy()->where('channel', 'online')->count());
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);

        // Customer notified along the way.
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->customer->id, 'type' => 'order.completed',
        ]);
    }

    public function test_illegal_transition_blocked(): void
    {
        $order = $this->place();
        // pending → completed is not allowed (must go through the flow).
        $this->advance($order['id'], 'completed')
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_INVALID_TRANSITION');
    }

    public function test_pickup_flow_uses_ready_not_out_for_delivery(): void
    {
        $order = $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null]);

        $this->advance($order['id'], 'confirmed');
        $this->advance($order['id'], 'preparing');
        // delivery state is invalid for pickup…
        $this->advance($order['id'], 'out_for_delivery')->assertStatus(409);
        // …ready is the correct next step.
        $this->advance($order['id'], 'ready')->assertOk();
        $this->advance($order['id'], 'completed')->assertOk();
    }

    // ── Cancellation / restock ──────────────────────────────────────

    public function test_owner_cancel_restores_stock(): void
    {
        $order = $this->place();
        $this->assertEquals(3, $this->product->fresh()->stock_quantity);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Out of stock'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');

        $this->assertEquals(5, $this->product->fresh()->stock_quantity);
    }

    public function test_customer_can_cancel_while_pending_but_not_while_preparing(): void
    {
        $order = $this->place();

        // Move to preparing.
        $this->advance($order['id'], 'confirmed');
        $this->advance($order['id'], 'preparing');

        $this->actingAsUser($this->customer)
            ->postJson("/api/v1/customer/orders/{$order['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ORDER_NOT_CANCELLABLE');

        // A fresh pending order CAN be cancelled by the customer.
        $fresh = $this->place(['items' => [['product_id' => $this->product->id, 'quantity' => 1]]]);
        $this->actingAsUser($this->customer)
            ->postJson("/api/v1/customer/orders/{$fresh['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertOk();
    }

    public function test_completed_order_cannot_be_cancelled(): void
    {
        $order = $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null]);
        foreach (['confirmed', 'preparing', 'ready', 'completed'] as $s) {
            $this->advance($order['id'], $s);
        }

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409);
    }

    // ── Visibility / authz / dashboard ──────────────────────────────

    public function test_orders_are_isolated_per_tenant_and_per_customer(): void
    {
        $this->place();

        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $this->assertSame(0, $this->actingAsUser($otherOwner)->getJson('/api/v1/orders')->json('meta.pagination.total'));

        $otherCustomer = User::factory()->create();
        $this->assertSame(0, $this->actingAsUser($otherCustomer)->getJson('/api/v1/customer/orders')->json('meta.pagination.total'));
    }

    public function test_dashboard_counts_pending_orders(): void
    {
        $this->place();
        $this->place(['items' => [['product_id' => $this->product->id, 'quantity' => 1]]]);

        $this->actingAsUser($this->owner)->getJson('/api/v1/dashboard')
            ->assertOk()->assertJsonPath('data.pending_orders', 2);
    }

    public function test_staff_without_orders_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/orders')->assertStatus(403);
    }
}
