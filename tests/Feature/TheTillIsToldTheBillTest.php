<?php

namespace Tests\Feature;

use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * THE TILL IS TOLD THE BILL — the whole of it, in both directions.
 *
 * `TheTillIsToldTheTaxTest` closed one way a till could show a figure the
 * server would not take: SHORT, by a tax group's tax. Reading the sale for
 * every other term it puts on a bill found the same fault pointing the other
 * way, and found it worse.
 *
 * ── Over, by everything a customer's group is owed ───────────────────
 *
 * A sale reads the customer's group off the phone number and acts on it
 * twice: unmarked lines are priced at the group's level, and the group's
 * percentage comes off the bill. The till was told neither. So for every
 * member it showed the full retail figure, and then —
 *
 *     by card   the sale was REFUSED. "No cash was handed over, so there is
 *               no change to give." A dead end at the counter, with nothing
 *               the cashier could press to get past it. A shop could not
 *               sell to its own trade customers on a card.
 *     by cash   the sale went through at a figure nobody at the counter saw,
 *               and the difference came back as change.
 *
 * ── And the way out that was itself wrong ────────────────────────────
 *
 * The refusal carried `amount_due` so a till could show the real bill and
 * finish. That figure is what EVERY tender together must cover, after the
 * bank's help. A till holds a different one — what the customer hands over —
 * and treating the first as the second went wrong twice: with a trade-in the
 * till asked for the whole bill again, and with a bank offer the reduced
 * figure went back as the card slice and was reduced a second time, for ever.
 *
 * Every figure here is paid to the paisa. A tender that over-covers the bill
 * cannot fail for being wrong, which is how the engine's own suite stayed
 * green through all of this.
 */
class TheTillIsToldTheBillTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->rice = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'wholesale_price' => 900, 'tax_rate' => 0,
            'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function member(string $phone, array $group): Customer
    {
        $made = CustomerGroup::query()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'name' => 'Group '.$phone, 'is_active' => true,
        ], $group));

        return Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Member '.$phone,
            'phone' => $phone, 'customer_group_id' => $made->id,
        ]);
    }

    /** @param  array<string, mixed>  $over */
    private function ring(array $over = []): TestResponse
    {
        return $this->asOwner()->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos',
            'items' => [['product_id' => $this->rice->id, 'quantity' => 10]],
            'payment_method' => 'card',
            'amount_paid' => 10000,
        ], $over));
    }

    // ── What the till is told about the customer ─────────────────────

    public function test_the_lookup_says_what_the_customers_group_will_do_to_the_bill(): void
    {
        $this->member('03001110001', ['price_level' => 'wholesale', 'discount_percent' => 7.5]);

        $this->asOwner()->getJson('/api/v1/customers-lookup?phone=03001110001')
            ->assertOk()
            ->assertJsonPath('data.group.price_level', 'wholesale')
            ->assertJsonPath('data.group.discount_percent', 7.5);
    }

    public function test_a_customer_in_no_group_is_said_to_be_in_none(): void
    {
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Walk-in regular', 'phone' => '03001110002',
        ]);

        $body = $this->asOwner()->getJson('/api/v1/customers-lookup?phone=03001110002')->assertOk()->json('data');

        // The KEY is there and it is null. A till that has to guess between
        // "no group" and "an old server that never said" would guess wrong.
        $this->assertArrayHasKey('group', $body);
        $this->assertNull($body['group']);
    }

    // ── A member, the reported way round ─────────────────────────────

    public function test_a_member_charged_the_full_price_on_a_card_is_told_the_real_bill(): void
    {
        $this->member('03001110003', ['price_level' => 'retail', 'discount_percent' => 10]);

        // What the old till did: 10 × 1,000, no idea about the 10%.
        $refused = $this->ring(['customer_phone' => '03001110003', 'amount_paid' => 10000])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CHANGE_WITHOUT_CASH');

        // The way out. Without this figure the cashier has a button that is
        // refused every time it is pressed.
        $this->assertEqualsWithDelta(9000.0, (float) $refused->json('meta.payable'), 0.001);
        $this->assertSame(0, Sale::withoutTenancy()->count(), 'a refused sale must leave nothing behind');

        $sale = $this->ring(['customer_phone' => '03001110003', 'amount_paid' => $refused->json('meta.payable')])
            ->assertCreated()->json('data');

        $this->assertEqualsWithDelta(9000.0, (float) $sale['total'], 0.001);
        $this->assertEqualsWithDelta(1000.0, (float) $sale['discount'], 0.001);
        $this->assertEqualsWithDelta(0.0, (float) $sale['change_due'], 0.001);
    }

    public function test_a_wholesale_group_prices_an_unmarked_line_and_a_marked_line_keeps_its_own(): void
    {
        $this->member('03001110004', ['price_level' => 'wholesale', 'discount_percent' => 0]);

        // Unmarked: the group's level. 10 × 900.
        $byGroup = $this->ring(['customer_phone' => '03001110004', 'amount_paid' => 9000])
            ->assertCreated()->json('data');
        $this->assertEqualsWithDelta(9000.0, (float) $byGroup['total'], 0.001);

        // Marked retail: "set by the customer group, overridden per line". A
        // till that states the level it priced at is charged at that level —
        // which is what lets its screen and the sale agree by construction.
        $bySay = $this->ring([
            'customer_phone' => '03001110004', 'amount_paid' => 10000,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 10, 'price_level' => 'retail']],
        ])->assertCreated()->json('data');
        $this->assertEqualsWithDelta(10000.0, (float) $bySay['total'], 0.001);
    }

    // ── The cashier takes the figure on the screen ───────────────────

    public function test_a_sale_is_not_made_at_a_figure_the_till_did_not_show(): void
    {
        $this->member('03001110005', ['price_level' => 'retail', 'discount_percent' => 10]);

        // CASH this time, and that is the point. Cash over the bill was never
        // refused — it was recorded at Rs 9,000 while the screen said 10,000.
        $refused = $this->ring([
            'customer_phone' => '03001110005', 'payment_method' => 'cash',
            'amount_paid' => 10000, 'expected_payable' => 10000,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'BILL_MISMATCH');

        $this->assertEqualsWithDelta(9000.0, (float) $refused->json('meta.payable'), 0.001);
        $this->assertSame(0, Sale::withoutTenancy()->count());

        // Shown the right figure, the same tender goes through and the change
        // is the change the cashier was told about.
        $sale = $this->ring([
            'customer_phone' => '03001110005', 'payment_method' => 'cash',
            'amount_paid' => 10000, 'expected_payable' => 9000,
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(1000.0, (float) $sale['change_due'], 0.001);
    }

    public function test_a_till_that_showed_too_little_is_told_before_it_is_called_short(): void
    {
        // Under by any amount is the reported failure. The figure-check
        // speaks first, because "the bill is X" is a sentence a cashier can
        // act on and "amount paid is less than the total" was not.
        $this->ring(['amount_paid' => 9500, 'expected_payable' => 9500])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'BILL_MISMATCH')
            ->assertJsonPath('meta.payable', 10000);
    }

    public function test_a_client_that_states_no_figure_is_left_exactly_as_it_was(): void
    {
        // Opt-in. Every other caller — the apps, the sync, a script — sends
        // no `expected_payable` and must not meet a new refusal.
        $sale = $this->ring(['payment_method' => 'cash', 'amount_paid' => 12000])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(2000.0, (float) $sale['change_due'], 0.001);
    }

    public function test_a_paisa_is_a_difference_and_a_rounding_error_is_not(): void
    {
        $this->ring(['amount_paid' => 10000, 'expected_payable' => 10000.01])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'BILL_MISMATCH');

        // 10000.004 is the same money as 10000.00 — a float that travelled
        // through JSON must not be refused for arriving as itself.
        $this->ring(['amount_paid' => 10000, 'expected_payable' => 10000.004])->assertCreated();
    }

    // ── The figure a till holds, not the one the sale holds ──────────

    public function test_with_a_bank_offer_the_figure_is_the_one_from_before_the_banks_help(): void
    {
        $bank = Bank::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'HBL', 'short_code' => 'HBL', 'is_active' => true,
        ]);
        BankCardOffer::query()->create([
            'tenant_id' => $this->tenant->id, 'bank_id' => $bank->id, 'label' => 'Ramadan 10%',
            'type' => 'percent', 'value' => 10, 'is_active' => true,
        ]);

        // A till that was short: it made the bill 8,000.
        $refused = $this->ring(['bank_id' => $bank->id, 'amount_paid' => 8000])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');

        // `payable` is the CARD SLICE to send — the bill before the bank's
        // share. `amount_due` is what is left after it, and is the wrong
        // number to send back: the offer comes off the slice it is given.
        $this->assertEqualsWithDelta(10000.0, (float) $refused->json('meta.payable'), 0.001);
        $this->assertLessThan(10000.0, (float) $refused->json('meta.amount_due'));

        // THE LOOP, pinned. Sending `amount_due` back is refused again — and
        // would be for ever, because each reply is smaller than the last.
        $this->ring(['bank_id' => $bank->id, 'amount_paid' => $refused->json('meta.amount_due')])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');

        $sale = $this->ring([
            'bank_id' => $bank->id,
            'amount_paid' => $refused->json('meta.payable'),
            'expected_payable' => $refused->json('meta.payable'),
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(10000.0, (float) $sale['total'], 0.001);
        $this->assertEqualsWithDelta(1000.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(9000.0, (float) $sale['amount_paid'], 0.001);
    }

    public function test_with_a_trade_in_the_figure_is_the_rupees_and_not_the_whole_bill(): void
    {
        $scrap = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Scrap Battery', 'price' => 3500, 'cost' => 0,
            'track_inventory' => true, 'stock_quantity' => 0, 'is_active' => true,
        ]);
        $tradeIn = [['product_id' => $scrap->id, 'quantity' => 1, 'unit_allowance' => 3000]];

        $refused = $this->ring(['amount_paid' => 5000, 'trade_ins' => $tradeIn])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');

        // 10,000 of goods, 3,000 of it settled by what is on the counter.
        // `amount_due` says 10,000 — true, and not what the customer is asked
        // for. A till that showed it would charge for the battery twice.
        $this->assertEqualsWithDelta(10000.0, (float) $refused->json('meta.amount_due'), 0.001);
        $this->assertEqualsWithDelta(7000.0, (float) $refused->json('meta.payable'), 0.001);
        $this->assertEqualsWithDelta(3000.0, (float) $refused->json('meta.trade_in'), 0.001);

        $sale = $this->ring([
            'amount_paid' => $refused->json('meta.payable'),
            'expected_payable' => $refused->json('meta.payable'),
            'trade_ins' => $tradeIn,
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(10000.0, (float) $sale['total'], 0.001);
        $this->assertEqualsWithDelta(0.0, (float) $sale['change_due'], 0.001);
    }

    // ── Coins that exist ─────────────────────────────────────────────

    public function test_cash_alone_settles_to_the_coin_and_cash_beside_goods_does_not(): void
    {
        /*
         * The till rounds a cash bill to the shop's smallest coin, mirroring
         * this. It rounded whenever the tender was "cash" — but a trade-in
         * makes the sale two tenders, and two tenders settle exactly. So a
         * cash sale with a battery on the counter was asked for the rounded
         * figure and refused for the difference.
         *
         * Both halves are pinned, because the till copies BOTH.
         */
        $this->tenant->forceFill(['settings' => ['cash_rounding' => 10]])->save();

        $odd = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Odd Price', 'price' => 1234, 'tax_rate' => 0,
            'track_inventory' => false, 'is_active' => true,
        ]);
        $scrap = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Scrap', 'price' => 500, 'cost' => 0,
            'track_inventory' => true, 'stock_quantity' => 0, 'is_active' => true,
        ]);
        $items = [['product_id' => $odd->id, 'quantity' => 1]];

        $alone = $this->ring(['items' => $items, 'payment_method' => 'cash', 'amount_paid' => 0])
            ->assertStatus(422)->json('meta');
        $this->assertEqualsWithDelta(1230.0, (float) $alone['payable'], 0.001);
        $this->assertEqualsWithDelta(-4.0, (float) $alone['rounding'], 0.001);

        $beside = $this->ring([
            'items' => $items, 'payment_method' => 'cash', 'amount_paid' => 0,
            'trade_ins' => [['product_id' => $scrap->id, 'quantity' => 1, 'unit_allowance' => 200]],
        ])->assertStatus(422)->json('meta');
        $this->assertEqualsWithDelta(1034.0, (float) $beside['payable'], 0.001);
        $this->assertEqualsWithDelta(0.0, (float) $beside['rounding'], 0.001);
    }
}
