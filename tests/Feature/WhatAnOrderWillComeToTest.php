<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\ModifierGroup;
use App\Models\ModifierOption;
use App\Models\Order;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Services\OrderService;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * WHAT AN ORDER WILL COME TO — asked of the path that places it.
 *
 * ── What was there ───────────────────────────────────────────────────
 *
 * The Take-order page added its own lines up and printed "Approximately". It
 * could not have been otherwise: it knew nothing of the delivery fee or the
 * order above which delivery is free, could not take a coupon, charged a
 * karahi the parent row's price whichever size the caller wanted (it could not
 * ask which), and could not answer a dish's question — so a dish with one was
 * refused when the order was sent, with no way on the page to put it right.
 *
 * `POST /orders/worth` runs `OrderService::place()` and stops it at the first
 * line the bill is known and before anything is written.
 */
class WhatAnOrderWillComeToTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $biryani;

    private Product $karahi;

    private ProductVariant $half;

    private ProductVariant $full;

    private ModifierOption $hot;

    private ModifierOption $naan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'business_type' => 'food', 'setup_completed' => true, 'city_id' => $city->id,
            'features' => Modules::normalize([
                'products' => true, 'pos' => true, 'kitchen' => true, 'marketplace' => true, 'delivery' => true, 'promotions' => true,
            ]),
            'delivery_fee' => 150,
            'settings' => ['free_delivery_threshold' => 3000],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $dish = fn (string $name, float $price) => Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'stock_quantity' => 0, 'track_inventory' => false, 'is_active' => true,
        ]);
        $this->biryani = $dish('Chicken Biryani', 450);

        // A karahi: two sizes, a question that must be answered, an extra that costs.
        $this->karahi = $dish('Chicken Karahi', 900);
        $size = fn (string $name, float $price) => ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $this->karahi->id, 'name' => $name, 'price' => $price,
            'stock_quantity' => 0, 'is_active' => true,
        ]);
        $this->half = $size('Half', 900);
        $this->full = $size('Full', 1600);
        $spice = ModifierGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $this->karahi->id, 'name' => 'Spice', 'min_select' => 1, 'max_select' => 1,
        ]);
        $extras = ModifierGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'product_id' => $this->karahi->id, 'name' => 'Extras', 'min_select' => 0, 'max_select' => 2,
        ]);
        $option = fn (ModifierGroup $g, string $name, float $plus) => ModifierOption::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'modifier_group_id' => $g->id, 'name' => $name, 'price_delta' => $plus, 'is_active' => true,
        ]);
        $this->hot = $option($spice, 'Hot', 0);
        $this->naan = $option($extras, 'Extra naan', 60);
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  list<array<string, mixed>>  $items */
    private function order(array $items, array $more = []): array
    {
        return array_merge([
            'channel' => 'phone', 'fulfillment_type' => 'delivery', 'items' => $items,
        ], $more);
    }

    private function worth(array $order): TestResponse
    {
        return $this->asOwner()->postJson('/api/v1/orders/worth', $order);
    }

    private function take(array $order): TestResponse
    {
        return $this->asOwner()->postJson('/api/v1/orders', ['customer_name' => 'Mrs. Khan', 'delivery_address' => '12-B, Johar Town'] + $order);
    }

    public function test_the_figure_said_is_the_figure_the_order_carries_delivery_and_all(): void
    {
        $order = $this->order([['product_id' => $this->biryani->id, 'quantity' => 2]]);

        $said = $this->worth($order)->assertOk()->json('data');

        $this->assertEquals(900, $said['subtotal']);
        $this->assertEquals(150, $said['delivery_fee'], 'the caller was not told what delivery costs');
        $this->assertEquals(1050, $said['total']);

        $taken = $this->take($order)->assertCreated()->json('data');
        $this->assertEquals($said['total'], (float) $taken['total']);
        $this->assertEquals($said['delivery_fee'], (float) $taken['delivery_fee']);
    }

    public function test_delivery_is_free_above_the_shops_own_line_and_collecting_it_costs_nothing(): void
    {
        $big = $this->order([['product_id' => $this->biryani->id, 'quantity' => 7]]); // 3,150
        $this->assertEquals(0, $this->worth($big)->assertOk()->json('data.delivery_fee'));
        $this->assertEquals(3150, $this->worth($big)->json('data.total'));

        $collected = $this->order([['product_id' => $this->biryani->id, 'quantity' => 2]], ['fulfillment_type' => 'pickup']);
        $this->assertEquals(0, $this->worth($collected)->assertOk()->json('data.delivery_fee'));
        $this->assertEquals(900, $this->worth($collected)->json('data.total'));
    }

    public function test_asking_places_no_order_and_spends_no_coupon(): void
    {
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'ONCE', 'type' => 'percent', 'value' => 10, 'usage_limit' => 1, 'is_active' => true,
        ]);
        $order = $this->order([['product_id' => $this->biryani->id, 'quantity' => 2]], ['coupon_code' => 'ONCE']);

        // Asked three times — the caller changed their mind twice.
        foreach ([1, 2, 3] as $_) {
            $said = $this->worth($order)->assertOk()->json('data');
            $this->assertEquals(90, $said['discount']);
            $this->assertEquals(960, $said['total']); // 900 − 90 + 150
        }

        $this->assertSame(0, Order::withoutTenancy()->count(), 'asking placed an order');
        $this->assertSame(0, (int) Coupon::withoutTenancy()->where('code', 'ONCE')->value('used_count'), 'a coupon looked at was spent');

        // …and it is still there to be used, once, by the order itself.
        $this->assertEquals(960, (float) $this->take($order)->assertCreated()->json('data.total'));
        $this->assertSame(1, (int) Coupon::withoutTenancy()->where('code', 'ONCE')->value('used_count'));
    }

    public function test_a_dish_that_comes_in_sizes_is_asked_which_by_the_question_and_by_the_order(): void
    {
        $noSize = $this->order([['product_id' => $this->karahi->id, 'quantity' => 1, 'modifier_option_ids' => [$this->hot->id]]]);

        $this->worth($noSize)->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED')
            ->assertJsonPath('message', 'Chicken Karahi comes in sizes — choose one.');
        // The door that TAKES the order says the same: it used to take it, at the Half's price.
        $this->take($noSize)->assertStatus(422)->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');
        $this->assertSame(0, Order::withoutTenancy()->count());
    }

    public function test_a_size_is_charged_at_its_own_price_and_an_extra_at_what_it_costs(): void
    {
        $full = $this->order([[
            'product_id' => $this->karahi->id, 'variant_id' => $this->full->id, 'quantity' => 1,
            'modifier_option_ids' => [$this->hot->id, $this->naan->id],
        ]], ['fulfillment_type' => 'pickup']);

        $said = $this->worth($full)->assertOk()->json('data');
        $this->assertEquals(1660, $said['total'], 'a Full with an extra naan is 1,600 + 60');
        $this->assertEquals(1660, $said['lines'][0]['unit_price']);

        $half = $this->order([['product_id' => $this->karahi->id, 'variant_id' => $this->half->id, 'quantity' => 2, 'modifier_option_ids' => [$this->hot->id]]], ['fulfillment_type' => 'pickup']);
        $this->assertEquals(1800, $this->worth($half)->assertOk()->json('data.total'));
    }

    public function test_a_question_that_must_be_answered_is_refused_in_words_before_the_order_is_sent(): void
    {
        $unanswered = $this->order([['product_id' => $this->karahi->id, 'variant_id' => $this->full->id, 'quantity' => 1]]);

        $this->worth($unanswered)->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'MODIFIER_MIN')
            ->assertJsonPath('message', 'Please choose at least 1 for "Spice".');
    }

    public function test_a_dish_taken_off_for_today_is_said_by_the_question(): void
    {
        // Taken off the way the kitchen takes it off: its own switch.
        $this->asOwner()->postJson("/api/v1/products/{$this->biryani->id}/sold-out")->assertSuccessful();

        $this->worth($this->order([['product_id' => $this->biryani->id, 'quantity' => 1]]))
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
    }

    public function test_the_figure_can_be_asked_before_the_caller_has_given_a_name_but_the_order_cannot_be_taken_without_one(): void
    {
        $order = $this->order([['product_id' => $this->biryani->id, 'quantity' => 1]]);

        $this->worth($order)->assertOk();

        $this->asOwner()->postJson('/api/v1/orders', $order)
            ->assertStatus(422)->assertJsonValidationErrors(['customer_name', 'delivery_address']);
    }

    public function test_nothing_the_caller_sends_turns_the_question_into_an_order(): void
    {
        $order = $this->order([['product_id' => $this->biryani->id, 'quantity' => 1]], [
            'quote_only' => false, 'customer_name' => 'Mrs. Khan', 'delivery_address' => '12-B',
        ]);

        $this->worth($order)->assertOk();
        $this->assertSame(0, Order::withoutTenancy()->count());

        // …and in the service itself, which is the line that decides.
        $said = app(OrderService::class)->worth(null, $this->shop->fresh(), ['quote_only' => false] + $order, $this->owner);
        $this->assertEquals(600, $said['total']);
        $this->assertSame(0, Order::withoutTenancy()->count());
    }
}
