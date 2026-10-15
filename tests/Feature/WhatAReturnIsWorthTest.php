<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * WHAT A RETURN IS WORTH — said before the press.
 *
 * Found by living a clothing shop's day. A kurta bought for 2,625 (2,500 and
 * its tax) was brought back for a bigger size, and the exchange sheet said
 * the credit was 2,500 and the difference to collect 200. The server credits
 * 2,625 and charges 2,835 for the Large: the difference is 210, and a sale
 * paid ten rupees short is refused. The sheet had worked the money out for
 * itself, in the browser, without the tax.
 *
 * The plain refund sheet never said a figure at all: "how many?", and press.
 *
 * So the sum is asked of the server, from the method that pays it out.
 * Every case here asks first and then DOES the thing, and holds the two to
 * each other — a quote that only agrees with itself proves nothing.
 */
class WhatAReturnIsWorthTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A kurta at five percent, in a Medium and a Large that costs more. */
    private function kurta(): array
    {
        $kurta = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Lawn Kurta', 'price' => 2500, 'cost' => 1400, 'tax_rate' => 5, 'stock_quantity' => 0, 'track_inventory' => true,
        ]);
        $size = fn (string $name, float $price): ProductVariant => $kurta->variants()->create([
            'tenant_id' => $this->shop->id, 'name' => $name, 'price' => $price, 'stock_quantity' => 5,
        ]);

        return [$kurta, $size('M', 2500), $size('L', 2700)];
    }

    private function sell(array $items, array $more = []): array
    {
        return $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000000, 'items' => $items, ...$more,
        ])->assertCreated()->json('data');
    }

    private function worth(array $sale, array $items, ?User $as = null): TestResponse
    {
        return $this->as($as ?? $this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns/worth", ['items' => $items]);
    }

    public function test_it_is_the_price_paid_with_its_tax_and_asking_moves_nothing(): void
    {
        [$kurta, $medium] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);
        $this->assertEquals(2625, $sale['total']);
        $line = ['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1];

        $said = $this->worth($sale, [$line])->assertOk()->json('data');

        // 2,500 and the 125 that was charged on it.
        $this->assertEquals(2625, $said['refund_total']);
        $this->assertEquals(125, $said['refund_tax']);
        $this->assertEquals([[$line['sale_item_id'], 2625.0]], array_map(fn ($l) => [$l['sale_item_id'], (float) $l['amount']], $said['lines']));

        // Asked, and nothing happened: no return, nothing back on the rail.
        $this->assertSame(0, SaleReturn::query()->count());
        $this->assertEquals(4, $medium->fresh()->stock_quantity);
        $this->assertSame('completed', $this->as($this->owner)->getJson("/api/v1/sales/{$sale['id']}")->json('data.status'));

        // …and what is then handed back is what was said.
        $done = $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => [$line]])->assertCreated()->json('data');
        $this->assertEquals($said['refund_total'], $done['refund_total']);
        $this->assertEquals($said['refund_tax'], $done['refund_tax']);
    }

    public function test_a_discount_on_the_bill_comes_off_each_piece_and_the_second_piece_takes_the_rest(): void
    {
        [$kurta, , $large] = $this->kurta();
        // 2 × 2,700 = 5,400.  Less 400 = 5,000.  5% = 250.  Bill 5,250.
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $large->id, 'quantity' => 2]], ['discount' => 400]);
        $this->assertEquals(5250, $sale['total']);
        $one = [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]];

        // Half of what was PAID — 2,500 and 125 — not the 2,700 on the tag.
        $first = $this->worth($sale, $one)->assertOk()->json('data');
        $this->assertEquals(2625, $first['refund_total']);
        $this->assertEquals(5250, $this->worth($sale, [['sale_item_id' => $one[0]['sale_item_id'], 'quantity' => 2]])->json('data.refund_total'));

        $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => $one])->assertCreated();

        // Asked again after one has gone back: what is LEFT to hand back.
        $second = $this->worth($sale, $one)->assertOk()->json('data');
        $done = $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => $one])->assertCreated()->json('data');
        $this->assertEquals($second['refund_total'], $done['refund_total']);
        // Both together are the bill, to the paisa.
        $this->assertEquals(5250, round($first['refund_total'] + $second['refund_total'], 2));
    }

    public function test_where_the_tax_is_inside_the_price_it_is_not_added_twice(): void
    {
        $this->shop->forceFill(['settings' => [...($this->shop->settings ?? []), 'tax_inclusive' => true]])->save();
        [$kurta, $medium] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);
        $this->assertEquals(2500, $sale['total']);
        $line = [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]];

        $said = $this->worth($sale, $line)->assertOk()->json('data');

        $this->assertTrue($said['tax_inclusive']);
        $this->assertEquals(2500, $said['refund_total']);
        // 2,500 ÷ 1.05 = 2,380.95 — the tax held inside is 119.05.
        $this->assertEquals(119.05, $said['refund_tax']);
        $this->assertEquals(2500, $said['lines'][0]['amount']);

        $done = $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => $line])->assertCreated()->json('data');
        $this->assertEquals($said['refund_total'], $done['refund_total']);
    }

    public function test_two_lines_are_each_given_their_own_figure(): void
    {
        [$kurta, $medium, $large] = $this->kurta();
        $sale = $this->sell([
            ['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1],
            ['product_id' => $kurta->id, 'variant_id' => $large->id, 'quantity' => 1],
        ]);
        $by = collect($sale['items'])->keyBy('variant_name');

        $said = $this->worth($sale, [
            ['sale_item_id' => $by['M']['id'], 'quantity' => 1],
            ['sale_item_id' => $by['L']['id'], 'quantity' => 1],
        ])->assertOk()->json('data');

        $amounts = collect($said['lines'])->mapWithKeys(fn ($l) => [$l['sale_item_id'] => (float) $l['amount']]);
        $this->assertEquals(2625, $amounts[$by['M']['id']]);
        $this->assertEquals(2835, $amounts[$by['L']['id']]);
        $this->assertEquals(5460, $said['refund_total']);
    }

    public function test_it_refuses_what_the_return_itself_would_refuse(): void
    {
        [$kurta, $medium] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);
        $item = $sale['items'][0]['id'];

        $this->worth($sale, [['sale_item_id' => $item, 'quantity' => 2]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RETURN_QTY_EXCEEDED');
        $this->worth($sale, [])->assertStatus(422);

        $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'customer_changed_mind'])->assertOk();
        $this->worth($sale, [['sale_item_id' => $item, 'quantity' => 1]])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_NOT_RETURNABLE');
    }

    public function test_it_is_told_to_whoever_may_start_a_refund_and_to_nobody_else(): void
    {
        [$kurta, $medium] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);
        $line = [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]];

        // A cashier may start one now — a supervisor's PIN finishes it (B01) —
        // so the cashier is told the figure the supervisor will be approving.
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $desk = User::factory()->tenantStaff($this->shop, ['sales.manage', 'sales.refund'])->create();
        $stockroom = User::factory()->tenantStaff($this->shop, ['inventory.manage'])->create();

        $this->worth($sale, $line, $stockroom)->assertForbidden();
        $this->worth($sale, $line, $cashier)->assertOk()->assertJsonPath('data.refund_total', 2625);
        $this->worth($sale, $line, $desk)->assertOk()->assertJsonPath('data.refund_total', 2625);
    }

    public function test_the_medium_goes_back_for_a_large_and_the_difference_is_what_was_said(): void
    {
        [$kurta, $medium, $large] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);
        $back = [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]];
        $out = [['product_id' => $kurta->id, 'variant_id' => $large->id, 'quantity' => 1]];

        $credit = (float) $this->worth($sale, $back)->json('data.refund_total');
        // Out: 2,700 and 135 = 2,835.  Back: 2,625.  She pays 210.
        $this->assertEquals(210, 2835 - $credit);

        // The 200 the sheet used to ask for — tag against tag — is ten short, and nothing moves.
        $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => $back, 'items' => $out, 'payments' => [['method' => 'cash', 'amount' => 200]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
        $this->assertEquals(4, $medium->fresh()->stock_quantity);
        $this->assertEquals(5, $large->fresh()->stock_quantity);

        $done = $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => $back, 'items' => $out, 'payments' => [['method' => 'cash', 'amount' => 2835 - $credit]],
        ])->assertCreated()->json('data');

        $this->assertEquals(210, $done['difference']);
        $this->assertEquals($credit, $done['return']['refund_total']);
        $this->assertEquals(2835, $done['sale']['total']);
        $this->assertSame('L', $done['sale']['items'][0]['variant_name']);
        // By SIZE: the Medium is back on its rail and a Large has left its own.
        $this->assertEquals(5, $medium->fresh()->stock_quantity);
        $this->assertEquals(4, $large->fresh()->stock_quantity);
    }

    public function test_a_replacement_that_comes_in_sizes_and_names_none_is_refused_in_words(): void
    {
        [$kurta, $medium] = $this->kurta();
        $sale = $this->sell([['product_id' => $kurta->id, 'variant_id' => $medium->id, 'quantity' => 1]]);

        // What the panel sent for every sized replacement until now.
        $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $kurta->id, 'quantity' => 1]],
            'payments' => [['method' => 'cash', 'amount' => 500]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');

        $this->assertSame(0, SaleReturn::query()->count());
        $this->assertEquals(4, $medium->fresh()->stock_quantity);
    }
}
