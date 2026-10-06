<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A WITHDRAWN MODULE HAS NO RULES.
 *
 * Found by the QA journey, stage F. The admin switched Coupons & Promotions
 * off for a shop with a live promotion in it. The till — which no longer had
 * the module — priced five bars of soap at Rs 630. The server took twenty
 * percent off and made the bill Rs 504, so every soap sale was refused as a
 * mismatch, over a promotion nobody at the shop could see, edit or end.
 *
 * Every case here is rung TWICE: with the module, to prove the rule in the
 * fixture is live and would have applied; and without it. A test that only
 * rang the second would pass on a promotion that was never going to fire.
 */
class AWithdrawnModuleHasNoRulesTest extends TestCase
{
    use RefreshDatabase;

    private const PHONE = '03001234567';

    private Tenant $shop;

    private User $owner;

    private Product $soap;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'online_shop_enabled' => true,
            'business_type' => 'mart', 'timezone' => 'UTC', 'delivery_fee' => 0,
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), ['promotions' => true, 'customers' => true]),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->soap = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Soap', 'price' => 100, 'wholesale_price' => 80, 'tax_rate' => 0,
            'stock_quantity' => 1000, 'track_inventory' => true,
        ]);
    }

    /** The admin's switch. Nothing else about the shop changes. */
    private function withdraw(string $module): void
    {
        $this->shop->forceFill(['features' => array_merge($this->shop->features, [$module => false])])->save();
        $this->assertFalse($this->shop->fresh()->featureEnabled($module));
    }

    private function ring(array $over = []): TestResponse
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $this->soap->id, 'quantity' => 5]],
        ], $over));
    }

    private function member(array $group): Customer
    {
        $g = CustomerGroup::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'name' => 'Group', 'price_level' => 'retail', 'is_active' => true,
        ], $group));

        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Member', 'phone' => self::PHONE, 'customer_group_id' => $g->id,
        ]);
    }

    // ── Coupons & Promotions ─────────────────────────────────────────

    public function test_a_promotion_left_behind_does_not_fire(): void
    {
        $promo = Promotion::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Soap 20 off', 'type' => 'percent',
            'value' => 20, 'scope' => 'order', 'is_active' => true, 'priority' => 0,
        ]);

        $with = $this->ring()->assertCreated()->json('data');
        $this->assertEquals(400, $with['total']);
        $this->assertSame($promo->id, $with['promotion_id']);

        $this->withdraw('promotions');

        $without = $this->ring()->assertCreated()->json('data');
        $this->assertEquals(500, $without['total'], 'a shop without promotions was given one');
        $this->assertEquals(0, $without['discount']);
        $this->assertNull($without['promotion_id']);

        // It was not deleted or switched off: it is the shop's, and comes back.
        $this->assertTrue($promo->fresh()->is_active);
    }

    public function test_what_the_till_expects_is_what_it_gets(): void
    {
        // The journey's failure, exactly: the till said 500 and was refused.
        Promotion::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Soap 20 off', 'type' => 'percent',
            'value' => 20, 'scope' => 'order', 'is_active' => true, 'priority' => 0,
        ]);
        $card = ['payment_method' => 'card', 'amount_paid' => 500, 'expected_payable' => 500];

        $this->ring($card)->assertStatus(422)->assertJsonPath('meta.error_code', 'BILL_MISMATCH');

        $this->withdraw('promotions');

        $this->ring($card)->assertCreated();
    }

    public function test_a_coupon_is_refused_out_loud_and_is_not_spent(): void
    {
        $coupon = Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'SAVE20', 'type' => 'percent', 'value' => 20, 'is_active' => true,
        ]);

        $this->assertEquals(400, $this->ring(['coupon_code' => 'SAVE20'])->assertCreated()->json('data.total'));
        $this->assertSame(1, $coupon->fresh()->used_count);

        $this->withdraw('promotions');

        // Refused, not dropped: a bill quietly charged in full would be more
        // than the customer was shown.
        $this->ring(['coupon_code' => 'SAVE20'])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        $this->assertSame(1, $coupon->fresh()->used_count, 'a refused sale spent the coupon');
    }

    public function test_an_online_order_cannot_use_a_coupon_either(): void
    {
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'SAVE20', 'type' => 'percent', 'value' => 20, 'is_active' => true,
        ]);
        $buyer = User::factory()->create(['phone' => '+923009998877']);
        $order = function () use ($buyer): TestResponse {
            $token = $buyer->createToken('t', ['access'])->plainTextToken;
            $this->app['auth']->forgetGuards();

            return $this->withToken($token)->postJson('/api/v1/customer/orders', [
                'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup', 'coupon_code' => 'SAVE20',
                'items' => [['product_id' => $this->soap->id, 'quantity' => 5]],
            ]);
        };

        $this->assertEquals(400, $order()->assertCreated()->json('data.total'));

        $this->withdraw('promotions');

        $order()->assertStatus(422)->assertJsonPath('meta.error_code', 'COUPONS_UNAVAILABLE');
    }

    // ── Customers & Khata ────────────────────────────────────────────

    public function test_a_group_gives_no_discount(): void
    {
        $this->member(['discount_percent' => 10]);

        $this->assertEquals(450, $this->ring(['customer_phone' => self::PHONE])->assertCreated()->json('data.total'));

        $this->withdraw('customers');

        $this->assertEquals(500, $this->ring(['customer_phone' => self::PHONE])->assertCreated()->json('data.total'));
    }

    public function test_a_group_gives_no_wholesale_price(): void
    {
        $this->member(['price_level' => 'wholesale']);

        $this->assertEquals(400, $this->ring(['customer_phone' => self::PHONE])->assertCreated()->json('data.total'));

        $this->withdraw('customers');

        $this->assertEquals(500, $this->ring(['customer_phone' => self::PHONE])->assertCreated()->json('data.total'));
    }

    public function test_nothing_goes_on_a_khata(): void
    {
        $credit = ['payment_method' => 'credit', 'amount_paid' => 500, 'customer_phone' => self::PHONE, 'customer_name' => 'Karim'];

        $this->ring($credit)->assertCreated();
        $customer = Customer::withoutTenancy()->where('tenant_id', $this->shop->id)->where('phone', self::PHONE)->firstOrFail();
        $this->assertEquals(500, $customer->credit_balance);

        $this->withdraw('customers');

        $this->ring($credit)->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
        $this->assertEquals(500, $customer->fresh()->credit_balance, 'a refused sale still put a debt on the customer');
    }

    public function test_no_points_are_earned(): void
    {
        $this->shop->forceFill(['settings' => array_merge($this->shop->settings ?? [], [
            'loyalty_enabled' => true, 'loyalty_earn_per_amount' => 100, 'loyalty_redeem_value' => 1,
        ])])->save();

        $this->ring(['customer_phone' => self::PHONE])->assertCreated();
        $customer = Customer::withoutTenancy()->where('tenant_id', $this->shop->id)->where('phone', self::PHONE)->firstOrFail();
        $this->assertSame(5, $customer->loyalty_points);

        $this->withdraw('customers');

        $this->ring(['customer_phone' => self::PHONE])->assertCreated();
        $this->assertSame(5, $customer->fresh()->loyalty_points, 'points were earned in a module the shop does not have');

        // And spending them is refused, by the refusal that already existed.
        $this->ring(['customer_phone' => self::PHONE, 'redeem_points' => 5])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'LOYALTY_DISABLED');
    }
}
