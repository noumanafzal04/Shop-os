<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\CommissionCharge;
use App\Models\Income;
use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * AN ORDER CARRIES ITS CHARGES — the market's rules for what a delivery costs.
 *
 * "agr koi 20 rs ka order kry ga to hum delivery thori dene jayen gy": a basket
 * below the minimum pays the difference (or is refused, by choice); the fee
 * grows with the kilometres; the admin can switch on a rush fee and a service
 * fee; and a customer may pay by transfer to the shop's own account, which the
 * shop confirms before it cooks.
 */
class AnOrderCarriesItsChargesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    private Product $naan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
            'delivery_fee' => 100, 'latitude' => 31.52, 'longitude' => 74.35,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
        $this->naan = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Roghni Naan', 'price' => 80, 'stock_quantity' => 100,
        ]);
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }

    private function settings(array $patch): void
    {
        $this->shop->forceFill(['settings' => array_merge($this->shop->settings ?? [], $patch)])->save();
    }

    private function body(array $over = [], float $qty = 1): array
    {
        return $over + [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => 'House 1, Gulberg',
            'items' => [['product_id' => $this->naan->id, 'quantity' => $qty]],
        ];
    }

    private function place(array $over = [], float $qty = 1)
    {
        return $this->as($this->customer)->postJson('/api/v1/customer/orders', $this->body($over, $qty));
    }

    private function walk(string $id, array $to): void
    {
        foreach ($to as $status) {
            $this->as($this->owner)->postJson("/api/v1/orders/{$id}/advance", ['status' => $status])->assertOk();
        }
    }

    // ── Below the minimum ───────────────────────────────────────────

    public function test_a_basket_below_the_minimum_pays_the_difference_instead_of_being_refused(): void
    {
        $this->settings(['min_order_amount' => 300]);

        $quote = $this->as($this->customer)->postJson('/api/v1/customer/orders/worth', $this->body())->assertOk()->json('data');
        $this->assertEquals(220, $quote['small_order_fee']);
        $this->assertEquals(300, $quote['minimum']);
        $this->assertEquals(80 + 220 + 100, $quote['total']);

        $order = $this->place()->assertCreated()->json('data');
        $this->assertEquals(220, $order['small_order_fee']);
        $this->assertEquals(400, $order['total']);

        // At or above the minimum there is no fee.
        $this->assertEquals(0, $this->place([], 4)->assertCreated()->json('data.small_order_fee'));
    }

    public function test_a_shop_may_choose_to_refuse_instead(): void
    {
        $this->settings(['min_order_amount' => 300, 'below_minimum' => 'refuse']);

        $this->place()->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_AMOUNT');
    }

    public function test_the_platform_minimum_covers_a_shop_that_set_none_and_a_shops_own_wins(): void
    {
        PlatformSettings::put(['default_min_order' => 200]);

        $this->assertEquals(120, $this->place()->assertCreated()->json('data.small_order_fee'));

        $this->settings(['min_order_amount' => 100]);
        $this->assertEquals(20, $this->place()->assertCreated()->json('data.small_order_fee'));

        // The platform says refuse; the shop that says nothing follows it.
        $this->settings(['min_order_amount' => null]);
        PlatformSettings::put(['below_minimum' => 'refuse']);
        $this->place()->assertStatus(422)->assertJsonPath('meta.error_code', 'MIN_ORDER_AMOUNT');
    }

    public function test_a_pickup_has_no_minimum(): void
    {
        $this->settings(['min_order_amount' => 300, 'pickup_enabled' => true]);

        $o = $this->place(['fulfillment_type' => 'pickup', 'delivery_address' => null])->assertCreated()->json('data');
        $this->assertEquals(0, $o['small_order_fee']);
        $this->assertEquals(80, $o['total']);
    }

    // ── Kilometres, rush, free delivery ─────────────────────────────

    public function test_the_fee_grows_with_every_started_kilometre_past_the_covered_distance(): void
    {
        $this->settings(['delivery_fee_per_km' => 20, 'delivery_fee_base_km' => 3]);

        // 0.04° of latitude ≈ 4.45 km → 1.45 km past 3 → two started km.
        $far = $this->place(['latitude' => 31.56, 'longitude' => 74.35], 5)->assertCreated()->json('data');
        $this->assertEquals(40, $far['distance_fee']);
        $this->assertEquals(140, $far['delivery_fee']);

        // Inside the covered distance: the flat fee only.
        $near = $this->place(['latitude' => 31.53, 'longitude' => 74.35], 5)->assertCreated()->json('data');
        $this->assertEquals(0, $near['distance_fee']);
        $this->assertEquals(100, $near['delivery_fee']);

        // No pin, nothing to measure: the flat fee.
        $this->assertEquals(100, $this->place([], 5)->assertCreated()->json('data.delivery_fee'));
    }

    public function test_the_rush_fee_is_added_while_on_and_survives_free_delivery(): void
    {
        PlatformSettings::put(['rush_fee' => 50, 'rush_fee_on' => true]);
        $this->settings(['free_delivery_threshold' => 1000]);

        $o = $this->place()->assertCreated()->json('data');
        $this->assertEquals(50, $o['rush_fee']);
        $this->assertEquals(150, $o['delivery_fee']);

        // Free delivery waives the shop's fee — not the rain.
        $free = $this->place([], 20)->assertCreated()->json('data');
        $this->assertEquals(50, $free['delivery_fee']);

        PlatformSettings::put(['rush_fee_on' => false]);
        $this->assertEquals(100, $this->place()->assertCreated()->json('data.delivery_fee'));
    }

    // ── Service fee, and the books ──────────────────────────────────

    public function test_every_charge_reaches_the_books_and_the_service_fee_is_billed_back(): void
    {
        PlatformSettings::put(['service_fee' => 10]);
        $this->settings(['min_order_amount' => 300]);

        $o = $this->place()->assertCreated()->json('data');
        $this->assertEquals(10, $o['service_fee']);
        $this->assertEquals(80 + 220 + 100 + 10, $o['total']);

        $this->walk($o['id'], ['confirmed', 'preparing', 'out_for_delivery', 'completed']);

        $order = Order::withoutTenancy()->findOrFail($o['id']);
        $sale = Sale::withoutTenancy()->findOrFail($order->sale_id);
        $incomes = Income::withoutTenancy()->where('reference', $order->order_number)->pluck('amount', 'description')->map(fn ($a) => (float) $a);

        $this->assertEquals(80, (float) $sale->total);
        $this->assertEquals(220, $incomes["Small order fee · {$order->order_number}"]);
        $this->assertEquals(10, $incomes["Service fee (collected for the platform) · {$order->order_number}"]);
        $this->assertEquals(100, $incomes["Delivery charge · {$order->order_number}"]);
        // Everything the customer paid is somewhere in the books — no more, no less.
        $this->assertEquals((float) $order->total, (float) $sale->total + $incomes->sum());

        // Commission is off; the service fee is still the platform's.
        $charge = CommissionCharge::withoutTenancy()->where('order_id', $order->id)->firstOrFail();
        $this->assertEquals(10, (float) $charge->service_fee);
        $this->assertEquals(10, (float) $charge->amount);
    }

    public function test_an_order_the_shop_took_on_the_phone_is_charged_none_of_it(): void
    {
        PlatformSettings::put(['service_fee' => 10, 'rush_fee' => 50, 'rush_fee_on' => true, 'default_min_order' => 500]);

        $o = $this->as($this->owner)->postJson('/api/v1/orders', [
            'fulfillment_type' => 'delivery', 'delivery_address' => 'Round the corner',
            'customer_name' => 'Caller', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->naan->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(0, $o['small_order_fee']);
        $this->assertEquals(0, $o['service_fee']);
        $this->assertEquals(100, $o['delivery_fee']);
    }

    // ── Paying by transfer ──────────────────────────────────────────

    public function test_a_customer_cannot_simply_say_it_is_paid(): void
    {
        $this->place(['payment_method' => 'paid'])->assertStatus(422)->assertJsonValidationErrors('payment_method');
    }

    public function test_a_shop_with_no_account_takes_cash_only(): void
    {
        $this->place(['payment_method' => 'transfer', 'payment_reference' => 'TX12345'], 5)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'TRANSFER_UNAVAILABLE');
    }

    public function test_a_transfer_is_checked_by_the_shop_before_it_is_accepted(): void
    {
        $this->settings(['transfer_details' => 'JazzCash 0300 1234567 (Lahori Karahi)']);

        $this->place(['payment_method' => 'transfer'], 5)->assertStatus(422)->assertJsonValidationErrors('payment_reference');

        $o = $this->place(['payment_method' => 'transfer', 'payment_reference' => 'TX99887766'], 5)->assertCreated()->json('data');
        $this->assertSame('TX99887766', $o['payment_reference']);
        $this->assertFalse($o['payment_received']);

        $this->as($this->owner)->postJson("/api/v1/orders/{$o['id']}/advance", ['status' => 'confirmed'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_VERIFIED');

        $this->as($this->owner)->postJson("/api/v1/orders/{$o['id']}/payment-received")->assertOk();
        $this->assertTrue($this->as($this->customer)->getJson("/api/v1/customer/orders/{$o['id']}")->json('data.payment_received'));

        $this->walk($o['id'], ['confirmed', 'preparing', 'out_for_delivery', 'completed']);
        $sale = Sale::withoutTenancy()->findOrFail(Order::withoutTenancy()->findOrFail($o['id'])->sale_id);
        $this->assertSame('bank_transfer', $sale->payments()->first()?->method ?? $sale->payment_method);
    }

    public function test_a_transfer_that_never_came_can_still_be_cancelled(): void
    {
        $this->settings(['transfer_details' => 'Meezan IBAN PK00 MEZN 0000 0000']);
        $o = $this->place(['payment_method' => 'transfer', 'payment_reference' => 'FAKE0001'], 5)->assertCreated()->json('data');

        $this->as($this->owner)->postJson("/api/v1/orders/{$o['id']}/cancel", ['reason' => 'No transfer arrived'])->assertOk();
    }

    // ── What the customer reads first, and who sets it ──────────────

    public function test_the_shop_page_says_the_rules_before_ordering(): void
    {
        PlatformSettings::put(['default_min_order' => 250, 'service_fee' => 10, 'delivery_fee_per_km' => 15]);
        $this->settings(['transfer_details' => 'JazzCash 0300 1234567']);

        $anon = $this->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->assertOk()->json('data');
        $this->assertEquals(250, $anon['min_order_amount']);
        $this->assertSame('fee', $anon['below_minimum']);
        $this->assertEquals(15, $anon['delivery_fee_per_km']);
        $this->assertEquals(10, $anon['service_fee']);
        $this->assertTrue($anon['takes_transfer']);
        $this->assertNull($anon['transfer_details']);

        $signedIn = $this->as($this->customer)->getJson("/api/v1/marketplace/shops/{$this->shop->slug}")->json('data');
        $this->assertSame('JazzCash 0300 1234567', $signedIn['transfer_details']);
    }

    public function test_only_the_admin_sets_the_delivery_rules(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $this->as($this->owner)->putJson('/api/v1/admin/delivery-rules', ['service_fee' => 5])->assertForbidden();

        $this->as($admin)->putJson('/api/v1/admin/delivery-rules', [
            'default_min_order' => 200, 'below_minimum' => 'fee', 'service_fee' => 9.99,
            'rush_fee' => 40, 'rush_fee_on' => true, 'accept_within_minutes' => 8, 'rider_cash_limit' => 15000,
        ])->assertOk()->assertJsonPath('data.service_fee', 9.99);

        $this->as($admin)->putJson('/api/v1/admin/delivery-rules', ['below_minimum' => 'maybe'])
            ->assertStatus(422)->assertJsonValidationErrors('below_minimum');

        $this->assertEquals(200, $this->as($admin)->getJson('/api/v1/admin/delivery-rules')->json('data.default_min_order'));

        // Cleared is back to none — not a database error.
        $this->as($admin)->putJson('/api/v1/admin/delivery-rules', ['default_min_order' => null, 'rider_cash_limit' => null])->assertOk();
        $this->assertNull($this->as($admin)->getJson('/api/v1/admin/delivery-rules')->json('data.default_min_order'));
    }
}
