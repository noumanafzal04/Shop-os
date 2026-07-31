<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * discount_price = the active sale price. When set below the regular price it
 * is what POS sales, online orders, and the public storefront all charge/show.
 */
class SalePriceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->tenant = Tenant::factory()->create([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => \App\Support\BusinessTypes::defaultFeatures('retail'),
            'slug' => 'deal-mart',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->item = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'name' => 'Deal Widget',
            'sku' => 'DW-1',
            'price' => 100,
            'discount_price' => 80,
            'stock_quantity' => 10,
            'visible_in_marketplace' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('test-device', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_selling_price_prefers_valid_discount(): void
    {
        $this->assertSame(80.0, $this->item->sellingPrice());

        $this->item->discount_price = 150; // above regular — ignored
        $this->assertSame(100.0, $this->item->sellingPrice());

        $this->item->discount_price = null;
        $this->assertSame(100.0, $this->item->sellingPrice());
    }

    public function test_price_for_qty_charges_cheapest_qualifying_tier(): void
    {
        // Non-monotonic set (deeper tier priced HIGHER): a buyer of 12 must
        // still pay the cheaper 90 break, never the deeper-but-dearer 100.
        $this->item->discount_price = null;
        $this->item->price_tiers = [
            ['min_qty' => 5, 'price' => 90],
            ['min_qty' => 10, 'price' => 100],
        ];

        $this->assertSame(100.0, $this->item->priceForQty(1));  // below any tier → regular
        $this->assertSame(90.0, $this->item->priceForQty(6));   // 5-tier
        $this->assertSame(90.0, $this->item->priceForQty(12));  // cheapest qualifying, not the 100
    }

    public function test_non_monotonic_price_tiers_are_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'Bulk Widget',
            'price' => 100,
            'price_tiers' => [
                ['min_qty' => 5, 'price' => 90],
                ['min_qty' => 10, 'price' => 95], // dearer at higher qty → invalid
            ],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['price_tiers']]);
    }

    public function test_monotonic_price_tiers_are_accepted(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'Bulk Widget 2',
            'price' => 100,
            'price_tiers' => [
                ['min_qty' => 5, 'price' => 90],
                ['min_qty' => 10, 'price' => 80],
            ],
        ])->assertCreated();
    }

    public function test_pos_sale_charges_the_sale_price(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->item->id, 'quantity' => 2]],
            'payment_method' => 'cash',
            'amount_paid' => 160,
        ])->assertCreated()->json('data');

        $this->assertEquals(160, $sale['total']);
    }

    public function test_online_order_charges_the_sale_price(): void
    {
        $customer = User::factory()->create();

        $order = $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => 'deal-mart',
            'fulfillment_type' => 'pickup',
            'customer_name' => 'Buyer',
            'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(80, $order['subtotal']);
    }

    public function test_storefront_shows_sale_and_original_price(): void
    {
        $data = $this->getJson('/api/v1/marketplace/shops/deal-mart/products')
            ->assertOk()->json('data');

        $this->assertEquals(80, $data[0]['price']);
        $this->assertEquals(100, $data[0]['original_price']);
    }
}
