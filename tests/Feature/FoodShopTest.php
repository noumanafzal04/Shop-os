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
            ->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Kitchen closed'])
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

    public function test_a_product_has_one_picture_and_uploading_again_replaces_it(): void
    {
        Storage::fake('public');

        $first = $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->image('pizza1.jpg')]],
        )->assertOk()->json('data.images');

        $this->assertCount(1, $first);
        Storage::disk('public')->assertExists($first[0]['path']);

        // Again — and this is the whole report: "currently zeyda add ho rahi".
        $second = $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->image('pizza2.jpg')]],
        )->assertOk()->json('data.images');

        $this->assertCount(1, $second, 'a second upload added a picture instead of replacing one');
        $this->assertNotSame($first[0]['id'], $second[0]['id'], 'the new file was stored and the old row kept');
        $this->assertSame(1, $this->pizza->images()->count());

        // The old FILE goes too, or every correction leaves a copy on the disk
        // that nothing will ever point at again.
        Storage::disk('public')->assertMissing($first[0]['path']);
        Storage::disk('public')->assertExists($second[0]['path']);
    }

    public function test_it_refuses_two_files_rather_than_silently_keeping_one(): void
    {
        Storage::fake('public');

        $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [
                UploadedFile::fake()->image('a.jpg'),
                UploadedFile::fake()->image('b.jpg'),
            ]],
        )->assertStatus(422)->assertJsonStructure(['errors' => ['images']]);

        $this->assertSame(0, $this->pizza->images()->count());
    }

    public function test_it_cleans_up_a_product_that_already_had_several(): void
    {
        Storage::fake('public');

        // The state the old rule left behind: three pictures, one of them shown.
        $paths = [];
        foreach (range(1, 3) as $i) {
            $paths[] = $path = UploadedFile::fake()->image("old{$i}.jpg")
                ->store("products/{$this->shop->id}/{$this->pizza->id}", 'public');
            $this->pizza->images()->create([
                'tenant_id' => $this->shop->id, 'path' => $path, 'sort_order' => $i - 1,
            ]);
        }
        $this->assertSame(3, $this->pizza->images()->count());

        $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->image('new.jpg')]],
        )->assertOk();

        $this->assertSame(1, $this->pizza->images()->count(), 'the older extras survived a replace');
        foreach ($paths as $gone) {
            Storage::disk('public')->assertMissing($gone);
        }
    }

    public function test_the_picture_can_be_taken_off_entirely(): void
    {
        Storage::fake('public');

        $image = $this->actingAsUser($this->owner)->postJson(
            "/api/v1/products/{$this->pizza->id}/images",
            ['images' => [UploadedFile::fake()->image('pizza.jpg')]],
        )->assertOk()->json('data.images.0');

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/products/{$this->pizza->id}/images/{$image['id']}")
            ->assertOk();

        Storage::disk('public')->assertMissing($image['path']);
        $this->assertSame(0, $this->pizza->images()->count());
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
