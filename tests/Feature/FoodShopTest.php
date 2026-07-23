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
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A food shop (e.g. pizza) sells online with delivery, but its menu items
 * are NOT stock-tracked. These tests lock in that the order flow works
 * end-to-end for non-inventory products, and that per-product online
 * visibility + image upload behave.
 */
class FoodShopTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $pizza;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'), // marketplace + delivery, inventory off
            'delivery_fee' => 120,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();

        // Menu item: not stock-tracked (like real food).
        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Chicken Tikka Pizza', 'price' => 1200, 'cost' => 500,
            'track_inventory' => false, 'stock_quantity' => 0,
            'visible_in_marketplace' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function placePizza(array $overrides = []): array
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', array_merge([
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 5, Block C',
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 2]],
        ], $overrides))->json('data');
    }

    public function test_food_order_places_without_stock_tracking(): void
    {
        $order = $this->placePizza();

        $this->assertSame('pending', $order['status']);
        $this->assertSame('2400.00', $order['subtotal']);
        $this->assertSame('120.00', $order['delivery_fee']);
        $this->assertSame('2520.00', $order['total']);

        // No stock was held for a non-inventory item.
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_food_order_completes_into_a_sale_without_stock_errors(): void
    {
        $order = $this->placePizza();

        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $s) {
            $this->actingAsUser($this->owner)
                ->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => $s])
                ->assertOk();
        }

        // Revenue recorded via an online sale; still zero stock movements.
        $this->assertSame(1, Sale::withoutTenancy()->where('channel', 'online')->count());
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_food_order_cancel_is_a_noop_for_stock(): void
    {
        $order = $this->placePizza();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'Kitchen closed'])
            ->assertOk()->assertJsonPath('data.status', 'cancelled');

        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_item_hidden_from_marketplace_cannot_be_ordered(): void
    {
        $this->pizza->forceFill(['visible_in_marketplace' => false])->save();

        $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PRODUCT_UNAVAILABLE');
    }

    // ── Product images ──────────────────────────────────────────────

    public function test_owner_uploads_and_deletes_product_images(): void
    {
        Storage::fake('public');

        $res = $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [
                UploadedFile::fake()->image('pizza1.jpg'),
                UploadedFile::fake()->image('pizza2.jpg'),
            ]],
        )->assertOk();

        $images = $res->json('data.images');
        $this->assertCount(2, $images);
        $this->assertArrayHasKey('url', $images[0]);
        Storage::disk('public')->assertExists($images[0]['path']);

        // Delete one.
        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/products/{$this->pizza->id}/images/{$images[0]['id']}")
            ->assertOk();

        Storage::disk('public')->assertMissing($images[0]['path']);
        $this->assertSame(1, $this->pizza->images()->count());
    }

    public function test_image_upload_rejects_non_images(): void
    {
        Storage::fake('public');

        $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->create('menu.pdf', 100, 'application/pdf')]],
        )->assertStatus(422)->assertJsonStructure(['errors' => ['images.0']]);
    }

    public function test_staff_without_products_permission_cannot_upload(): void
    {
        Storage::fake('public');
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->actingAsUser($staff)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->image('x.jpg')]],
        )->assertStatus(403);
    }
}
