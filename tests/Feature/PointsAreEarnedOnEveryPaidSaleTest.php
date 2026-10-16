<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Q6 — the owner: "market standard dekho". One loyalty programme across the
 * channels: a paid sale to a known customer earns points wherever it is made —
 * the till, a delivered online order, a quotation billed. Earned when the sale
 * is made and paid (a completed order), never on an order that is cancelled,
 * never on the delivery fee. Redeeming stays at the till.
 */
class PointsAreEarnedOnEveryPaidSaleTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $buyer;

    private Product $sneaker;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => array_merge(BusinessTypes::defaultFeatures('retail'), ['customers' => true]),
            'delivery_fee' => 150,
        ]);
        $this->shop->forceFill(['settings' => [
            'loyalty_enabled' => true, 'loyalty_earn_per_amount' => 100, 'loyalty_redeem_value' => 1, 'loyalty_min_redeem' => 0,
        ]])->save();
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->buyer = User::factory()->create(['name' => 'Online Sara', 'phone' => '03005556667']);
        $this->sneaker = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Sneaker', 'price' => 5000, 'cost' => 3000, 'stock_quantity' => 10, 'track_inventory' => true,
        ]);
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }

    private function order(): array
    {
        return $this->as($this->buyer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $this->sneaker->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
    }

    private function advance(string $id, string ...$steps): void
    {
        foreach ($steps as $status) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$id}/advance", ['status' => $status])->assertOk();
        }
    }

    private function points(string $phone): ?int
    {
        $points = Customer::withoutTenancy()->where('tenant_id', $this->shop->id)->where('phone', $phone)->value('loyalty_points');

        return $points === null ? null : (int) $points;
    }

    public function test_a_delivered_online_order_earns_points_on_the_goods_not_the_delivery_fee(): void
    {
        $order = $this->order();
        $this->assertEquals(150, $order['delivery_fee']);

        // Placed and on its way: nothing is earned before the sale is made.
        $this->advance($order['id'], 'confirmed', 'preparing', 'out_for_delivery');
        $this->assertNotSame(100, $this->points('03005556667'));

        $this->advance($order['id'], 'completed');
        $sale = Sale::withoutTenancy()->where('channel', 'online')->sole();
        $this->assertSame(100, (int) $sale->points_earned, 'Rs 10,000 of goods at 1 point per 100 — the 150 delivery is not goods');
        $this->assertSame(100, $this->points('03005556667'));
    }

    public function test_a_cancelled_order_earns_nothing(): void
    {
        $order = $this->order();
        $this->advance($order['id'], 'confirmed');
        $this->as($this->owner)->postJson("/api/v1/orders/{$order['id']}/cancel", ['reason' => 'Out of size'])->assertOk();

        $this->assertContains($this->points('03005556667'), [null, 0]);
    }

    public function test_a_shop_without_the_customer_book_earns_nobody_points(): void
    {
        $this->shop->forceFill(['features' => array_merge($this->shop->features, ['customers' => false])])->save();
        $order = $this->order();
        $this->advance($order['id'], 'confirmed', 'preparing', 'out_for_delivery', 'completed');

        $this->assertSame(0, (int) Sale::withoutTenancy()->where('channel', 'online')->sole()->points_earned);
    }

    public function test_a_quotation_billed_earns_points_once(): void
    {
        $quote = $this->as($this->owner)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_name' => 'Bilal', 'customer_phone' => '03007778889',
            'items' => [['product_id' => $this->sneaker->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertContains($this->points('03007778889'), [null, 0], 'a quotation is a promise, not a sale');

        $this->as($this->owner)->postJson("/api/v1/sale-documents/{$quote['id']}/convert", ['payment_method' => 'cash', 'amount_paid' => 5000])
            ->assertCreated();

        $this->assertSame(50, $this->points('03007778889'));
    }
}
