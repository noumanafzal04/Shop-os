<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Rider;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Model A — the shop's own delivery riders: CRUD, assigning a delivery order
 * to a rider, and the customer-facing tracking that shows the rider + stage.
 */
class RidersTest extends TestCase
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
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice Bag', 'price' => 2000, 'cost' => 1500, 'stock_quantity' => 20, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function placeDelivery(): array
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
    }

    private function makeRider(array $attrs = []): string
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/riders', array_merge([
            'name' => 'Ahmed', 'phone' => '0300-1112222',
        ], $attrs))->assertCreated()->json('data.id');
    }

    // ── CRUD ─────────────────────────────────────────────────────────

    public function test_owner_can_crud_riders(): void
    {
        $id = $this->makeRider();
        $this->assertDatabaseHas('riders', ['id' => $id, 'tenant_id' => $this->shop->id, 'name' => 'Ahmed']);

        $this->actingAsUser($this->owner)->patchJson("/api/v1/riders/{$id}", ['is_active' => false])
            ->assertOk()->assertJsonPath('data.is_active', false);

        $this->actingAsUser($this->owner)->getJson('/api/v1/riders')
            ->assertOk()->assertJsonCount(1, 'data');

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/riders/{$id}")->assertOk();
        $this->assertSoftDeleted('riders', ['id' => $id]);
    }

    public function test_riders_are_tenant_isolated(): void
    {
        $this->makeRider();
        $otherOwner = User::factory()->shopOwner()->create();

        $this->actingAsUser($otherOwner)->getJson('/api/v1/riders')
            ->assertOk()->assertJsonCount(0, 'data');
    }

    // ── Assignment ─────────────────────────────────────────────────

    public function test_assign_rider_to_delivery_order_and_customer_sees_it(): void
    {
        $order = $this->placeDelivery();
        $riderId = $this->makeRider();

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $riderId])
            ->assertOk()->assertJsonPath('data.rider_id', $riderId);

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->customer->id, 'type' => 'order.rider_assigned',
        ]);

        // Customer tracking: rider name + stage, no phone leak.
        $tracked = $this->actingAsUser($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")
            ->assertOk()->json('data');
        $this->assertSame('Ahmed', $tracked['rider']['name']);
        $this->assertSame('assigned', $tracked['rider']['stage']);
        $this->assertArrayNotHasKey('phone', $tracked['rider']);

        // Stage tracks the order status.
        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'confirmed']);
        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'preparing']);
        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'out_for_delivery']);
        $stage = $this->actingAsUser($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")->json('data.rider.stage');
        $this->assertSame('on_the_way', $stage);
    }

    public function test_can_clear_rider_assignment(): void
    {
        $order = $this->placeDelivery();
        $riderId = $this->makeRider();
        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $riderId])->assertOk();

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => null])
            ->assertOk()->assertJsonPath('data.rider_id', null);
    }

    public function test_cannot_assign_rider_to_a_pickup_order(): void
    {
        $order = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $riderId = $this->makeRider();

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $riderId])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ORDER_NOT_DELIVERY');
    }

    public function test_cannot_assign_a_foreign_rider(): void
    {
        $order = $this->placeDelivery();
        $otherOwner = User::factory()->shopOwner()->create();
        $foreignRider = Rider::withoutTenancy()->create(['tenant_id' => $otherOwner->tenant_id, 'name' => 'Stranger']);

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/assign-rider", ['rider_id' => $foreignRider->id])
            ->assertStatus(422);
    }

    public function test_rider_management_requires_orders_permission(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['products.manage'])->create();
        $this->actingAsUser($staff)->postJson('/api/v1/riders', ['name' => 'Nope'])->assertStatus(403);
    }
}
