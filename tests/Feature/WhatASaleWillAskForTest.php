<?php

namespace Tests\Feature;

use App\Actions\Sale\CreateSaleAction;
use App\Models\City;
use App\Models\Coupon;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SCREEN ASKS WHAT A SALE WILL COME TO — and pays exactly that.
 *
 *     "Complete Sale · Rs 4,200" — pressed — "Amount paid (4,200.00) is less
 *      than the total (4,956.00)."
 *
 * The hand-written sale screen added its bill up without tax, so any taxed
 * item could not be sold on it for the figure on its own button. It asks the
 * server now (`POST /sales/worth`), which runs the sale itself and stops before
 * it writes. These hold the two halves of that promise: the figure is the one
 * the sale then takes, to the paisa, and asking leaves no trace.
 */
class WhatASaleWillAskForTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $taxed;

    private Product $plain;

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

        $item = fn (string $name, float $price, array $more = []) => Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'cost' => 1, 'stock_quantity' => 20, 'track_inventory' => true, 'is_active' => true,
        ], $more));
        // The item from the report: 4,200 and its own 18%.
        $this->taxed = $item('Taxed Item A', 4200, ['tax_rate' => 18]);
        $this->plain = $item('Plain Item', 333.33);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sale(array $items, array $more = []): array
    {
        return ['channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 0, 'items' => $items, ...$more];
    }

    private function worth(array $sale, ?User $as = null): TestResponse
    {
        return $this->as($as ?? $this->owner)->postJson('/api/v1/sales/worth', $sale);
    }

    /** Rung for exactly the figure that was said. */
    private function ringFor(array $sale, array $said): TestResponse
    {
        return $this->as($this->owner)->postJson('/api/v1/sales', ['amount_paid' => $said['due'], 'expected_payable' => $said['payable']] + $sale);
    }

    public function test_the_item_from_the_report_is_told_4956_and_sold_for_4956(): void
    {
        $sale = $this->sale([['product_id' => $this->taxed->id, 'quantity' => 1]]);

        $said = $this->worth($sale)->assertOk()->json('data');

        $this->assertEquals(4200.00, $said['subtotal']);
        $this->assertEquals(756.00, $said['tax']);
        $this->assertEquals(4956.00, $said['total']);
        $this->assertEquals(4956.00, $said['due']);

        $rung = $this->ringFor($sale, $said)->assertCreated();
        $this->assertEquals(4956.00, (float) $rung->json('data.total'));
        $this->assertEquals(0.0, (float) $rung->json('data.change_due'));
    }

    public function test_whatever_is_on_the_bill_the_figure_said_is_the_figure_taken(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['default_tax_rate' => 16])->assertOk();

        $bills = [
            'three taxed and seven at the shop\'s rate' => $this->sale([
                ['product_id' => $this->taxed->id, 'quantity' => 3],
                ['product_id' => $this->plain->id, 'quantity' => 7],
            ]),
            'money off the whole bill' => $this->sale([
                ['product_id' => $this->taxed->id, 'quantity' => 1],
                ['product_id' => $this->plain->id, 'quantity' => 2],
            ], ['discount' => 250]),
            'money off one line' => $this->sale([
                ['product_id' => $this->plain->id, 'quantity' => 3, 'line_discount' => 33.33],
            ]),
            'on a card' => $this->sale([['product_id' => $this->plain->id, 'quantity' => 1]], ['payment_method' => 'card']),
        ];

        foreach ($bills as $what => $sale) {
            $said = $this->worth($sale)->assertOk()->json('data');
            $rung = $this->ringFor($sale, $said);

            $rung->assertCreated();
            $this->assertEquals((float) $rung->json('data.total'), $said['total'], "the figure said is not the bill — {$what}");
            $this->assertEquals((float) $rung->json('data.tax'), $said['tax'], "…nor the tax — {$what}");
            $this->assertEquals((float) $rung->json('data.subtotal'), $said['subtotal'], "…nor the subtotal — {$what}");
            $this->assertEquals(0.0, (float) $rung->json('data.change_due'), "paying the figure said left change — {$what}");
        }
    }

    public function test_a_cash_bill_settles_to_the_shops_coin_and_a_card_bill_does_not(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['cash_rounding' => 5])->assertOk();
        // 333.33 — no coin for that.
        $items = [['product_id' => $this->plain->id, 'quantity' => 1]];

        $cash = $this->worth($this->sale($items))->assertOk()->json('data');
        $card = $this->worth($this->sale($items, ['payment_method' => 'card']))->assertOk()->json('data');

        $this->assertEquals(333.33, $cash['total']);
        $this->assertEquals(335.00, $cash['due'], 'a cash bill was not settled to the coin');
        $this->assertEquals(1.67, $cash['rounding']);
        $this->assertEquals(333.33, $card['due'], 'a card bill was rounded to a coin');

        $this->ringFor($this->sale($items), $cash)->assertCreated()->assertJsonPath('data.change_due', fn ($change) => (float) $change === 0.0);
    }

    public function test_asking_writes_nothing_takes_no_number_moves_no_stock_and_spends_no_coupon(): void
    {
        $this->shop->forceFill(['features' => array_merge($this->shop->features ?? [], ['promotions' => true])])->save();
        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'code' => 'ONCE', 'type' => 'fixed', 'value' => 200,
            'usage_limit' => 1, 'used_count' => 0, 'is_active' => true,
        ]);
        $sale = $this->sale([['product_id' => $this->taxed->id, 'quantity' => 2]], ['coupon_code' => 'ONCE']);

        // Asked three times: a coupon good for one use would be spent by the first.
        $first = $this->worth($sale)->assertOk()->json('data');
        $this->worth($sale)->assertOk();
        $this->assertEquals($first, $this->worth($sale)->assertOk()->json('data'), 'the same question was answered differently');

        $this->assertSame(0, Sale::withoutTenancy()->where('tenant_id', $this->shop->id)->count(), 'asking rang a sale');
        $this->assertEquals(20, (float) $this->taxed->fresh()->stock_quantity, 'asking took stock off the shelf');
        $this->assertSame(0, (int) Coupon::withoutTenancy()->where('code', 'ONCE')->value('used_count'), 'asking spent the coupon');

        // …and the first sale really rung is the shop's first, with the coupon on it.
        $rung = $this->ringFor($sale, $first)->assertCreated();
        $this->assertStringEndsWith('000001', (string) $rung->json('data.invoice_number'), 'a question took an invoice number');
        $this->assertEquals($first['total'], (float) $rung->json('data.total'));
        $this->assertSame(1, (int) Coupon::withoutTenancy()->where('code', 'ONCE')->value('used_count'));
        $this->assertEquals(18, (float) $this->taxed->fresh()->stock_quantity);
    }

    public function test_a_question_carrying_a_sales_own_key_is_still_a_question(): void
    {
        $key = 'a-cart-state-0001';
        $sale = $this->sale([['product_id' => $this->plain->id, 'quantity' => 1]], ['idempotency_key' => $key]);

        // The screen sends what it would send to ring it, key and all.
        $said = $this->worth($sale)->assertOk()->json('data');
        $this->assertSame(0, Sale::withoutTenancy()->count());

        // The key is still unused: this rings a sale, it does not replay one.
        $this->ringFor($sale, $said)->assertCreated();
        $this->assertSame(1, Sale::withoutTenancy()->count());

        // And once it HAS been used, asking again is not answered with that sale.
        $again = $this->worth($sale)->assertOk()->json('data');
        $this->assertEquals($said['total'], $again['total']);
        $this->assertArrayNotHasKey('invoice_number', $again);
        $this->assertSame(1, Sale::withoutTenancy()->count());
    }

    public function test_what_the_sale_refuses_before_it_knows_the_bill_is_refused_when_asked_in_the_same_words(): void
    {
        // A product that has been retired since the screen listed it.
        $this->plain->forceFill(['is_active' => false])->save();
        $gone = $this->sale([['product_id' => $this->plain->id, 'quantity' => 1]]);

        $asked = $this->worth($gone);
        $rung = $this->as($this->owner)->postJson('/api/v1/sales', ['amount_paid' => 999999] + $gone);

        $this->assertGreaterThanOrEqual(400, $rung->status(), 'a retired item was sold');
        $this->assertSame($rung->status(), $asked->status());
        $this->assertSame($rung->json('message'), $asked->json('message'));
    }

    public function test_a_shelf_too_short_is_said_when_the_sale_is_rung_not_when_it_is_asked_about(): void
    {
        // Stock is checked as it is moved, which is after the bill is known:
        // the question is answered with the figure, and the sale itself says
        // which item is short. Written down so nobody reads the figure as a
        // promise that the shelf can fill it.
        $tooMany = $this->sale([['product_id' => $this->plain->id, 'quantity' => 500]]);

        $said = $this->worth($tooMany)->assertOk()->json('data');
        $this->assertEquals(round(333.33 * 500, 2), $said['subtotal']);

        $this->ringFor($tooMany, $said)->assertStatus(422);
        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertEquals(20, (float) $this->plain->fresh()->stock_quantity);
    }

    public function test_a_price_that_moved_between_asking_and_ringing_is_refused_in_words(): void
    {
        $sale = $this->sale([['product_id' => $this->taxed->id, 'quantity' => 1]]);
        $said = $this->worth($sale)->assertOk()->json('data');

        $this->taxed->forceFill(['price' => 4500])->save();

        // 4,500 + 18% = 5,310, and the screen is still showing 4,956.
        $this->ringFor($sale, $said)->assertStatus(422)->assertJsonPath('meta.error_code', 'BILL_MISMATCH');
        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    public function test_only_somebody_who_may_ring_a_sale_may_ask_what_it_is(): void
    {
        $sale = $this->sale([['product_id' => $this->plain->id, 'quantity' => 1]]);
        $keeper = User::factory()->create(['tenant_id' => $this->shop->id, 'role' => 'staff', 'permissions' => ['inventory.manage']]);

        $this->worth($sale, $keeper)->assertStatus(403);

        // Money off needs its own permission, asked or rung.
        $cashier = User::factory()->create(['tenant_id' => $this->shop->id, 'role' => 'staff', 'permissions' => ['sales.manage']]);
        $this->worth($sale, $cashier)->assertOk();
        $this->worth($this->sale([['product_id' => $this->plain->id, 'quantity' => 1]], ['discount' => 50]), $cashier)->assertStatus(403);
    }

    public function test_a_question_never_rings_a_sale_whatever_it_is_handed(): void
    {
        // Our own code builds what `worth` is given, and one day some of it
        // will carry the switch the wrong way round. The question still stops.
        app(TenantContext::class)->set($this->shop);
        $this->actingAs($this->owner);

        $said = app(CreateSaleAction::class)->worth([
            'quote_only' => false,
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 999999,
            'items' => [['product_id' => $this->plain->id, 'quantity' => 1]],
        ]);

        $this->assertEquals(333.33, $said['total']);
        $this->assertSame(0, Sale::withoutTenancy()->count(), 'a question rang a sale');
    }

    public function test_a_client_cannot_tell_a_sale_to_stop_short(): void
    {
        // `quote_only` is our own switch and is in no request's rules.
        $this->as($this->owner)->postJson('/api/v1/sales', ['quote_only' => true, 'amount_paid' => 999999] + $this->sale([['product_id' => $this->plain->id, 'quantity' => 1]]))
            ->assertCreated();
        $this->assertSame(1, Sale::withoutTenancy()->count());
    }
}
