<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Order;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * AN ORDER IS PRICED BY THE TILL'S RULES.
 *
 * The till charged tax and took the shop's promotion and a member's discount;
 * an order — online or on the phone — charged no tax and took only a coupon,
 * so the same basket cost a different sum depending on the door. The owner
 * (2026-11-11): market standard, one price. Asked here the only way that
 * proves it: the till's own quote for the basket against the order's.
 */
class AnOrderIsPricedLikeTheTillTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '+923001112233';

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $rice;   // 1,000 — taxed at the shop's default

    private Product $milk;   // 400 — exempt (its own 0%)

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $features = BusinessTypes::defaultFeatures('retail');
        $features['marketplace'] = true;
        $features['delivery'] = true;
        $features['promotions'] = true;
        $features['customers'] = true;
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => $features, 'delivery_fee' => 100, 'timezone' => 'UTC',
        ]);
        $this->setting('default_tax_rate', 5);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create(['phone' => self::PHONE]);

        $this->rice = $this->item('Rice', 1000, null);
        $this->milk = $this->item('Milk', 400, 0);
    }

    private function setting(string $key, mixed $value): void
    {
        $this->shop->forceFill(['settings' => array_merge($this->shop->settings ?? [], [$key => $value])])->save();
        $this->shop->refresh();
    }

    private function modules(array $off): void
    {
        $this->shop->forceFill(['features' => array_merge($this->shop->features ?? [], array_fill_keys($off, false))])->save();
        $this->shop->refresh();
    }

    private function item(string $name, float $price, ?float $rate): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'tax_rate' => $rate, 'stock_quantity' => 100,
            'track_inventory' => true, 'visible_in_marketplace' => true, 'is_active' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return list<array{product_id: string, quantity: int}> */
    private function basket(): array
    {
        return [
            ['product_id' => $this->rice->id, 'quantity' => 2],
            ['product_id' => $this->milk->id, 'quantity' => 1],
        ];
    }

    private function body(array $extra = []): array
    {
        return array_merge([
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main Boulevard',
            'items' => $this->basket(),
        ], $extra);
    }

    private function asked(array $extra = []): TestResponse
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders/worth', $this->body($extra));
    }

    private function placed(array $extra = []): array
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', $this->body($extra))
            ->assertCreated()->json('data');
    }

    private function complete(string $orderId): Sale
    {
        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $s) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$orderId}/advance", ['status' => $s])->assertOk();
        }

        return Sale::withoutTenancy()->with('items')->findOrFail(Order::withoutTenancy()->findOrFail($orderId)->sale_id);
    }

    /** The till's own answer for the same basket, rung for the same customer. */
    private function tillSays(array $extra = []): array
    {
        return $this->as($this->owner)->postJson('/api/v1/sales/worth', array_merge([
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000000,
            'items' => $this->basket(),
        ], $extra))->assertOk()->json('data');
    }

    private function promotion(float $percent): Promotion
    {
        return Promotion::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => "Weekend {$percent}%", 'type' => 'percent',
            'value' => $percent, 'scope' => 'order', 'is_active' => true, 'priority' => 0,
        ]);
    }

    private function member(float $percent): void
    {
        $group = CustomerGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Regulars', 'price_level' => 'retail',
            'discount_percent' => $percent, 'is_active' => true,
        ]);
        Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Ayesha', 'phone' => self::PHONE, 'customer_group_id' => $group->id,
        ]);
    }

    public function test_an_order_is_taxed_line_by_line_at_the_tills_rates(): void
    {
        $said = $this->asked()->assertOk()->json('data');

        // 2 × 1,000 at 5% + 400 exempt: tax 100, never on the milk.
        $this->assertEquals(2400, $said['subtotal']);
        $this->assertEquals(100, $said['tax']);
        $this->assertFalse($said['tax_inclusive']);
        $this->assertEquals(2600, $said['total']); // 2,400 + 100 tax + 100 delivery

        $order = $this->placed();
        $this->assertEquals(100, (float) $order['tax']);
        $this->assertEquals(2600, (float) $order['total'], 'the order carries the figure it was quoted');

        $rates = Order::withoutTenancy()->findOrFail($order['id'])->items->pluck('tax_rate', 'product_name')->map(fn ($r) => (float) $r)->all();
        $this->assertEquals(['Rice' => 5.0, 'Milk' => 0.0], $rates);

        $sale = $this->complete($order['id']);
        $this->assertEquals(100, (float) $sale->tax);
        $this->assertEquals(2500, (float) $sale->total, 'the sale is the goods and their tax; the delivery is its own income');
        $this->assertEqualsCanonicalizing(
            ['Rice' => 5.0, 'Milk' => 0.0],
            $sale->items->mapWithKeys(fn ($i) => [$i->product->name => (float) $i->tax_rate])->all(),
            'each line keeps the rate it was quoted at, so a return refunds exactly that',
        );
    }

    public function test_the_same_basket_costs_the_same_at_the_till_and_on_an_order(): void
    {
        $this->promotion(10);
        $this->member(5);

        $till = $this->tillSays(['customer_phone' => self::PHONE]);
        $order = $this->asked(['fulfillment_type' => 'pickup'])->assertOk()->json('data');

        $this->assertEquals($till['subtotal'], $order['subtotal']);
        $this->assertEquals($till['discount'], $order['discount']);
        $this->assertEquals($till['tax'], $order['tax']);
        $this->assertEquals($till['total'], $order['total'], 'a collected order costs what the till charges');

        // And by hand, so the two cannot agree on a wrong figure: 2,400 −10%
        // promotion = 240; member 5% of the 2,160 left = 108; tax 5% on the
        // rice's share of 2,052 → 2,000 × 2,052/2,400 × 5% = 85.50.
        $this->assertEquals(240, $order['promotion_discount']);
        $this->assertEquals(108, $order['member_discount']);
        $this->assertEquals(348, $order['discount']);
        $this->assertEquals(85.5, $order['tax']);
        $this->assertEquals(2137.5, $order['total']);
    }

    public function test_a_promotion_and_a_members_discount_reach_the_order_and_its_sale(): void
    {
        $promo = $this->promotion(10);
        $this->member(5);

        $order = $this->placed();
        $this->assertSame('Weekend 10%', $order['promotion_name']);
        $this->assertEquals(240, (float) $order['promotion_discount']);
        $this->assertEquals(108, (float) $order['member_discount']);
        $this->assertEquals(2237.5, (float) $order['total']); // 2,137.50 + 100 delivery

        $sale = $this->complete($order['id']);
        $this->assertEquals(348, (float) $sale->discount);
        $this->assertSame($promo->id, $sale->promotion_id);
        $this->assertSame('Weekend 10%', $sale->promo_name);
        $this->assertEquals(240, (float) $sale->promo_discount, 'the invoice can say the promotion apart from the rest');
        $this->assertEquals(85.5, (float) $sale->tax);
        $this->assertEquals(2137.5, (float) $sale->total);
    }

    public function test_a_coupon_comes_first_and_says_its_own_share(): void
    {
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'SAVE100', 'type' => 'fixed', 'value' => 100, 'is_active' => true,
        ]);
        $this->promotion(10);

        $till = $this->tillSays(['coupon_code' => 'SAVE100']);
        $said = $this->asked(['fulfillment_type' => 'pickup', 'coupon_code' => 'SAVE100'])->assertOk()->json('data');

        $this->assertEquals($till['discount'], $said['discount']);
        $this->assertEquals($till['total'], $said['total']);
        $this->assertEquals(100, $said['coupon_discount']);
        // The promotion is measured on the basket, as at the till, and only
        // clamped to what the coupon left: 10% of 2,400.
        $this->assertEquals(240, $said['promotion_discount']);
    }

    public function test_tax_inside_the_price_keeps_the_price(): void
    {
        $this->setting('tax_inclusive', true);

        $till = $this->tillSays();
        $said = $this->asked(['fulfillment_type' => 'pickup'])->assertOk()->json('data');
        $this->assertTrue($said['tax_inclusive']);
        $this->assertEquals($till['tax'], $said['tax']);
        $this->assertEquals(95.24, $said['tax']); // 2,000 − 2,000 ÷ 1.05
        $this->assertEquals(2400, $said['total'], 'an inclusive price is the price');

        $order = $this->placed();
        $this->assertEquals(2500, (float) $order['total']);

        $sale = $this->complete($order['id']);
        $this->assertTrue((bool) $sale->tax_inclusive);
        $this->assertEquals(95.24, (float) $sale->tax);
        $this->assertEquals(2400, (float) $sale->total);
    }

    public function test_a_shop_without_the_modules_gives_no_offer_but_still_charges_tax(): void
    {
        $this->promotion(10);
        $this->member(5);
        $this->modules(['promotions', 'customers']);

        $said = $this->asked(['fulfillment_type' => 'pickup'])->assertOk()->json('data');
        $this->assertEquals(0, $said['discount']);
        $this->assertNull($said['promotion_name']);
        $this->assertEquals(100, $said['tax']);
        $this->assertEquals(2500, $said['total']);
    }

    public function test_an_order_placed_before_orders_were_taxed_completes_as_it_always_did(): void
    {
        $order = $this->placed();
        // What every order already in a shop's queue looks like after the
        // migration: no tax, no rate on its lines.
        $row = Order::withoutTenancy()->findOrFail($order['id']);
        $row->forceFill(['tax' => 0, 'tax_inclusive' => false, 'total' => 2500])->save();
        $row->items()->update(['tax_rate' => null]);

        $sale = $this->complete($order['id']);
        $this->assertEquals(0, (float) $sale->tax);
        $this->assertEquals(2400, (float) $sale->total);
        $this->assertSame([0.0, 0.0], $sale->items->map(fn ($i) => (float) $i->tax_rate)->values()->all(),
            'a return off it must not refund tax nobody paid');
    }

    public function test_a_rate_changed_while_the_order_is_out_does_not_change_what_it_completes_at(): void
    {
        $order = $this->placed();
        $this->setting('default_tax_rate', 17);

        $sale = $this->complete($order['id']);
        $this->assertEquals(100, (float) $sale->tax, 'the customer was quoted 5%');
        $this->assertEquals(2500, (float) $sale->total);
    }

    public function test_asking_places_nothing_and_spends_no_coupon(): void
    {
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'ONCE', 'type' => 'percent', 'value' => 10, 'usage_limit' => 1, 'is_active' => true,
        ]);

        foreach ([1, 2] as $_) {
            $this->asked(['coupon_code' => 'ONCE'])->assertOk();
        }

        $this->assertSame(0, Order::withoutTenancy()->count(), 'asking placed an order');
        $this->assertSame(0, (int) Coupon::withoutTenancy()->where('code', 'ONCE')->value('used_count'), 'a coupon looked at was spent');
        $this->assertEquals(100, (float) $this->rice->fresh()->stock_quantity, 'asking held stock');
    }

    public function test_the_total_is_asked_before_the_address_is_typed(): void
    {
        $this->asked(['delivery_address' => null])->assertOk();
        $this->as($this->customer)->postJson('/api/v1/customer/orders', $this->body(['delivery_address' => null]))
            ->assertUnprocessable();
    }

    public function test_the_customer_is_shown_the_tax_and_the_offer_on_their_order(): void
    {
        $this->promotion(10);
        $order = $this->placed();

        $seen = $this->as($this->customer)->getJson("/api/v1/customer/orders/{$order['id']}")->assertOk()->json('data');
        $this->assertSame('Weekend 10%', $seen['promotion_name']);
        $this->assertEquals(240, (float) $seen['promotion_discount']);
        $this->assertEquals(90, (float) $seen['tax']); // 5% of the rice's 2,000 × 2,160/2,400
        $this->assertFalse($seen['tax_inclusive']);
    }
}
