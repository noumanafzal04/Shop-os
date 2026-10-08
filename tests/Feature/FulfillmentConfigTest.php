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
 * Per-business Order Fulfillment Configuration:
 * pickup-only · delivery-only · both, plus delivery economics
 * (minimum order amount, free-delivery threshold).
 */
class FulfillmentConfigTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        City::query()->create(['name' => 'Lahore', 'latitude' => 31.52, 'longitude' => 74.35, 'is_active' => true]);
        $this->customer = User::factory()->create();
    }

    private function makeShop(array $settings = [], array $attrs = []): Tenant
    {
        return Tenant::factory()->create(array_merge([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'business_type' => 'grocery',
            'features' => BusinessTypes::defaultFeatures('grocery'), // delivery feature on
            'delivery_fee' => 150,
            'settings' => $settings,
        ], $attrs));
    }

    private function makeProduct(Tenant $shop, float $price = 100): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => 'Item '.uniqid(),
            'price' => $price, 'stock_quantity' => 100,
        ]);
    }

    private function order(Tenant $shop, Product $p, string $fulfillment, float $qty = 1)
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $shop->slug,
            'fulfillment_type' => $fulfillment,
            'delivery_address' => $fulfillment === 'delivery' ? 'House 1, Street 2' : null,
            'items' => [['product_id' => $p->id, 'quantity' => $qty]],
        ]);
    }

    // ── Modes ────────────────────────────────────────────────────────

    public function test_pickup_only_shop_rejects_delivery(): void
    {
        $shop = $this->makeShop(['pickup_enabled' => true, 'delivery_enabled' => false]);
        $p = $this->makeProduct($shop);

        $this->order($shop, $p, 'delivery')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'DELIVERY_DISABLED');
        $this->order($shop, $p, 'pickup')->assertCreated();
    }

    public function test_delivery_only_shop_rejects_pickup(): void
    {
        $shop = $this->makeShop(['pickup_enabled' => false, 'delivery_enabled' => true]);
        $p = $this->makeProduct($shop);

        $this->order($shop, $p, 'pickup')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PICKUP_DISABLED');
        $this->order($shop, $p, 'delivery')->assertCreated();
    }

    public function test_owner_cannot_disable_both_modes(): void
    {
        $shop = $this->makeShop();
        $owner = User::factory()->shopOwner($shop)->create();
        $this->app['auth']->forgetGuards();

        $this->actingAs($owner)->putJson('/api/v1/shop/settings', [
            'pickup_enabled' => false,
            'delivery_enabled' => false,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'FULFILLMENT_REQUIRED');
    }

    // ── Delivery economics ──────────────────────────────────────────

    public function test_a_basket_short_of_the_minimum_is_told_by_how_much_in_rupees(): void
    {
        $shop = $this->makeShop(['min_order_amount' => 1000]);
        $p = $this->makeProduct($shop, 900);

        // It said "Minimum order for delivery is 1,000 — add a bit more": no
        // currency, and no figure for the bit.
        $this->order($shop, $p, 'delivery')
            ->assertStatus(422)
            ->assertJsonPath('message', 'Minimum order for delivery is Rs 1,000 — add Rs 100 more, or collect it.');
    }

    public function test_a_shop_says_what_its_kind_of_business_is_called_not_its_key(): void
    {
        $shop = $this->makeShop([], ['business_type' => 'online', 'business_category' => 'online_boutique']);

        $this->getJson("/api/v1/marketplace/shops/{$shop->slug}")
            ->assertOk()
            ->assertJsonPath('data.business_category', 'online_boutique')
            ->assertJsonPath('data.business_category_label', 'Clothing & Boutique');
    }

    public function test_a_key_nobody_offers_has_no_label_rather_than_itself(): void
    {
        $this->assertNull(BusinessTypes::categoryLabel('online', 'not_a_category'));
        $this->assertNull(BusinessTypes::categoryLabel('online', null));
        // Offered under another trade only: still found.
        $this->assertSame('Auto Workshop (labour only)', BusinessTypes::categoryLabel('online', 'auto_workshop'));
    }

    public function test_minimum_order_amount_enforced_for_delivery(): void
    {
        $shop = $this->makeShop(['min_order_amount' => 500]);
        $p = $this->makeProduct($shop, 100);

        // 100 < 500 → rejected for delivery…
        $this->order($shop, $p, 'delivery')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_AMOUNT');
        // …but pickup has no minimum.
        $this->order($shop, $p, 'pickup')->assertCreated();
        // 5 × 100 = 500 → allowed.
        $this->order($shop, $p, 'delivery', 5)->assertCreated();
    }

    public function test_free_delivery_above_threshold(): void
    {
        $shop = $this->makeShop(['free_delivery_threshold' => 3000]);
        $p = $this->makeProduct($shop, 1000);

        // Below threshold: fee charged.
        $small = $this->order($shop, $p, 'delivery', 2)->assertCreated()->json('data');
        $this->assertEquals(150, $small['delivery_fee']);
        $this->assertEquals(2150, $small['total']);

        // At/above threshold: fee waived.
        $big = $this->order($shop, $p, 'delivery', 3)->assertCreated()->json('data');
        $this->assertEquals(0, $big['delivery_fee']);
        $this->assertEquals(3000, $big['total']);
    }

    // ── Storefront exposure ─────────────────────────────────────────

    public function test_public_shop_exposes_fulfillment_config(): void
    {
        $shop = $this->makeShop([
            'pickup_enabled' => true, 'delivery_enabled' => false,
            'min_order_amount' => 500, 'free_delivery_threshold' => 3000,
        ]);

        $data = $this->getJson("/api/v1/marketplace/shops/{$shop->slug}")->assertOk()->json('data');

        $this->assertTrue($data['fulfillment']['pickup']);
        $this->assertFalse($data['fulfillment']['delivery']);
        $this->assertEquals(500, $data['min_order_amount']);
        $this->assertEquals(3000, $data['free_delivery_threshold']);
    }
}
