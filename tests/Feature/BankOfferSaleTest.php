<?php

namespace Tests\Feature;

use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Sale;
use App\Models\SalePayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A bank offer arriving at the till.
 *
 * The engine's own rules are pinned in `BankOfferEngineTest`. This is the
 * arithmetic around them, and it is the part that is easy to get subtly wrong
 * in a way nobody notices until a bank refuses a claim:
 *
 *   what the shop SOLD      `total`          — does not move
 *   what the CUSTOMER pays  the tenders      — drops by the bank's share
 *   what the BANK owes      `bank_discount`  — its own column
 *
 * Get the first one wrong and the day's trading is understated. Get the second
 * wrong and the drawer does not count out. Get the third wrong and the shop
 * cannot invoice anybody.
 */
class BankOfferSaleTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Product $product;

    private Bank $bank;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $this->product = Product::query()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Rice 5kg',
            'price' => 1000,
            'stock_quantity' => 500,
            'track_inventory' => true,
            'is_active' => true,
        ]);

        $this->bank = Bank::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'HBL',
            'short_code' => 'HBL',
            'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function offer(array $over = []): BankCardOffer
    {
        return BankCardOffer::query()->create(array_merge([
            'tenant_id' => $this->tenant->id,
            'bank_id' => $this->bank->id,
            'label' => 'Ramadan 10%',
            'type' => 'percent',
            'value' => 10,
            'is_active' => true,
        ], $over));
    }

    /** @param  array<string, mixed>  $over */
    private function ring(array $over = []): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 10]],
            'payment_method' => 'card',
            'amount_paid' => 10000,
        ], $over));
    }

    // ── The three figures ───────────────────────────────────────────

    public function test_the_shop_still_sold_the_whole_bill(): void
    {
        // `total` must not shrink. The shop parted with Rs 10,000 of goods and
        // is owed Rs 10,000 — part by the customer, part by the bank. Moving it
        // understates the day and deletes the figure a claim is written from.
        $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(10000.0, (float) $sale['total'], 0.001);
    }

    public function test_the_customer_taps_the_banks_share_less(): void
    {
        $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(1000.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(9000.0, (float) $sale['amount_paid'], 0.001);
        $this->assertEqualsWithDelta(0.0, (float) $sale['change_due'], 0.001);
    }

    public function test_the_drawer_is_told_what_actually_moved(): void
    {
        // The tender rows are what the shift counts against. A card line still
        // reading Rs 10,000 would show a Rs 1,000 surplus every single time.
        $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $card = SalePayment::withoutTenancy()
            ->where('sale_id', $sale['id'])->where('method', 'card')->sum('amount');

        $this->assertEqualsWithDelta(9000.0, (float) $card, 0.001);
    }

    public function test_the_offer_that_fired_is_recorded_by_id(): void
    {
        // The claim is compiled per offer. A rupee figure with nothing naming
        // which campaign produced it cannot be invoiced to anybody.
        $offer = $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $this->assertSame($offer->id, Sale::withoutTenancy()->find($sale['id'])->bank_card_offer_id);
    }

    // ── The card slice, not the bill ────────────────────────────────

    public function test_a_split_pays_the_bank_share_out_of_the_car_d_slice_only(): void
    {
        // Rs 10,000 settled Rs 3,000 cash and Rs 7,000 card. The bank funds a
        // share of 7,000 — it is discounting its own transaction, not the cash
        // the customer put on the counter.
        $this->offer();

        // A split names its slices and carries no single method or amount —
        // those two keys are dropped rather than nulled, which is what the
        // POS actually sends.
        $sale = $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 10]],
            'payments' => [
                ['method' => 'cash', 'amount' => 3000],
                ['method' => 'card', 'amount' => 7000],
            ],
            'bank_id' => $this->bank->id,
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(700.0, (float) $sale['bank_discount'], 0.001);

        $byMethod = SalePayment::withoutTenancy()->where('sale_id', $sale['id'])
            ->pluck('amount', 'method');

        $this->assertEqualsWithDelta(3000.0, (float) $byMethod['cash'], 0.001, 'the cash must not move');
        $this->assertEqualsWithDelta(6300.0, (float) $byMethod['card'], 0.001);
    }

    public function test_a_cash_sale_that_names_a_bank_gets_nothing_and_is_not_refused(): void
    {
        // A cashier picked a bank and then the customer paid cash. Refusing the
        // sale over it would be refusing money at the counter.
        $this->offer();

        $sale = $this->ring([
            'payment_method' => 'cash',
            'bank_id' => $this->bank->id,
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(0.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(10000.0, (float) $sale['amount_paid'], 0.001);
    }

    // ── Alongside the shop's own money ──────────────────────────────

    public function test_a_shop_promotion_and_a_bank_offer_bot_h_apply(): void
    {
        // Two people's money, and neither may silently eat the other. The shop
        // prices the cart; the bank then discounts the card slice of what is
        // left. "Largest wins" would let a campaign the shop is PAID for cancel
        // one the shop is paying for, which nobody agreed to.
        Promotion::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Weekend 20%',
            'type' => 'percent',
            'value' => 20,
            'scope' => 'order',
            'is_active' => true,
        ]);
        $this->offer();

        $sale = $this->ring([
            'bank_id' => $this->bank->id,
            'amount_paid' => 8000,
        ])->assertCreated()->json('data');

        // Shop's 20% off Rs 10,000 → the bill is Rs 8,000 …
        $this->assertEqualsWithDelta(2000.0, (float) $sale['promo_discount'], 0.001);
        $this->assertEqualsWithDelta(8000.0, (float) $sale['total'], 0.001);
        // … and the bank's 10% comes off THAT, not off the original.
        $this->assertEqualsWithDelta(800.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(7200.0, (float) $sale['amount_paid'], 0.001);
    }

    public function test_the_two_discounts_stay_in_separate_columns(): void
    {
        // The whole reason the column exists. One shared column and the shop
        // can never tell its own campaign's cost from the bank's.
        Promotion::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Weekend 20%', 'type' => 'percent', 'value' => 20,
            'scope' => 'order', 'is_active' => true,
        ]);
        $this->offer();

        $sale = Sale::withoutTenancy()->find(
            $this->ring(['bank_id' => $this->bank->id, 'amount_paid' => 8000])
                ->assertCreated()->json('data.id'),
        );

        $this->assertEqualsWithDelta(2000.0, (float) $sale->promo_discount, 0.001);
        $this->assertEqualsWithDelta(800.0, (float) $sale->bank_discount, 0.001);
    }

    // ── The card number ─────────────────────────────────────────────

    public function test_the_last_four_digits_are_optional(): void
    {
        // A cashier in a rush must never be blocked from completing a sale over
        // a reference field. The claim report flags what is missing instead.
        $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $this->assertNull(Sale::withoutTenancy()->find($sale['id'])->card_last4);
    }

    public function test_the_last_four_digits_are_kept_when_given(): void
    {
        $this->offer();

        $sale = $this->ring(['bank_id' => $this->bank->id, 'card_last4' => '4291'])
            ->assertCreated()->json('data');

        $this->assertSame('4291', Sale::withoutTenancy()->find($sale['id'])->card_last4);
    }

    public function test_a_full_card_number_is_refuse_d_rather_than_quietly_trimmed(): void
    {
        // The most important assertion in this file. A PAN in this database
        // puts the shop and this platform inside PCI DSS — an audit regime, not
        // a setting. Trimming sixteen digits to four would accept the number
        // into the request, the logs and any error report on the way.
        $this->offer();

        $this->ring(['bank_id' => $this->bank->id, 'card_last4' => '4111111111111111'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('card_last4');
    }

    // ── Which offer, and whose ──────────────────────────────────────

    public function test_a_credit_only_offer_needs_the_card_type(): void
    {
        $this->offer(['card_types' => ['credit']]);

        $plain = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');
        $this->assertEqualsWithDelta(0.0, (float) $plain['bank_discount'], 0.001);

        $credit = $this->ring(['bank_id' => $this->bank->id, 'card_type' => 'credit'])
            ->assertCreated()->json('data');
        $this->assertEqualsWithDelta(1000.0, (float) $credit['bank_discount'], 0.001);
    }

    public function test_a_bank_from_another_shop_is_refused_outright(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $theirBank = Bank::query()->create([
            'tenant_id' => $other->id, 'name' => 'Theirs', 'is_active' => true,
        ]);

        $this->ring(['bank_id' => $theirBank->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors('bank_id');
    }

    public function test_a_bank_with_nothing_running_changes_nothing(): void
    {
        // No offer at all. The sale completes at full price and says so.
        $sale = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(0.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(10000.0, (float) $sale['amount_paid'], 0.001);
    }

    public function test_an_ordinary_sale_that_names_no_bank_is_untouched(): void
    {
        // Which is almost every sale ever rung. Nothing about this feature may
        // change a shop that never uses it.
        $this->offer();

        $sale = $this->ring()->assertCreated()->json('data');

        $this->assertEqualsWithDelta(0.0, (float) $sale['bank_discount'], 0.001);
        $this->assertEqualsWithDelta(10000.0, (float) $sale['amount_paid'], 0.001);
        $this->assertNull(Sale::withoutTenancy()->find($sale['id'])->bank_card_offer_id);
    }

    // ── The claim — the half that gets the money back ───────────────
    //
    // A bank card offer is not the shop's discount. Everything at the till is
    // the easy half; this is the half that turns a discount funded by nobody
    // into an invoice somebody pays. Without it the shop finds out at year end.

    private function claims(): array
    {
        $owner = User::factory()->shopOwner($this->tenant)->create();

        return $this->actingAsUser($owner)->getJson(
            '/api/v1/reports/bank-claims?from='.now()->subDay()->toDateString()
            .'&to='.now()->toDateString(),
        )->assertOk()->json('data');
    }

    public function test_the_claim_totals_what_the_bank_owes(): void
    {
        $this->offer();
        $this->ring(['bank_id' => $this->bank->id]);
        $this->ring(['bank_id' => $this->bank->id]);

        $totals = $this->claims()['totals'];

        $this->assertSame(2, $totals['sales']);
        $this->assertEqualsWithDelta(2000.0, $totals['discount'], 0.001);
    }

    public function test_the_claim_is_grouped_per_campaig_n_not_per_bank(): void
    {
        // A bank reimburses against a campaign. "HBL Ramadan" and "HBL Weekend"
        // are two claims to two desks, and one combined figure matches neither
        // invoice.
        $ramadan = $this->offer(['label' => 'Ramadan 10%']);
        $this->ring(['bank_id' => $this->bank->id]);

        $ramadan->update(['is_active' => false]);
        $this->offer(['label' => 'Weekend 5%', 'value' => 5]);
        $this->ring(['bank_id' => $this->bank->id]);

        $claims = $this->claims()['claims'];

        $this->assertCount(2, $claims);
        // Biggest first — it is the one worth chasing this month.
        $this->assertSame('Ramadan 10%', $claims[0]['offer']);
        $this->assertEqualsWithDelta(1000.0, $claims[0]['discount'], 0.001);
        $this->assertEqualsWithDelta(500.0, $claims[1]['discount'], 0.001);
    }

    public function test_rows_with_no_card_reference_are_counted_an_d_named(): void
    {
        // The last four digits are optional at the counter on purpose. But a
        // bank matches a claim on them, so a row without one is money the shop
        // may struggle to collect. Dropping it understates the claim; hiding it
        // overstates what is collectable. It is counted and flagged.
        $this->offer();
        $this->ring(['bank_id' => $this->bank->id, 'card_last4' => '4291']);
        $this->ring(['bank_id' => $this->bank->id]);

        $data = $this->claims();

        $this->assertSame(2, $data['totals']['sales']);
        $this->assertSame(1, $data['totals']['unreferenced']);
        $this->assertSame(1, $data['claims'][0]['unreferenced']);
    }

    public function test_a_cancelled_sale_is_not_claimed_for(): void
    {
        // Nothing was given away, so there is nothing to invoice. Claiming it
        // is how a shop's relationship with a bank goes wrong.
        $this->offer();
        $id = $this->ring(['bank_id' => $this->bank->id])->assertCreated()->json('data.id');

        Sale::withoutTenancy()->find($id)->forceFill(['status' => 'cancelled'])->save();

        $this->assertSame(0, $this->claims()['totals']['sales']);
    }

    public function test_a_sale_with_no_bank_never_appears(): void
    {
        // Which is almost every sale. A claim report padded with ordinary sales
        // is one nobody trusts twice.
        $this->offer();
        $this->ring();

        $this->assertSame(0, $this->claims()['totals']['sales']);
    }

    public function test_the_lines_carry_what_a_claim_form_asks_for(): void
    {
        $this->offer();
        $this->ring(['bank_id' => $this->bank->id, 'card_last4' => '4291']);

        $line = $this->claims()['claims'][0]['lines'][0];

        $this->assertNotNull($line['invoice_number']);
        $this->assertNotNull($line['sold_at']);
        $this->assertSame('4291', $line['card_last4']);
        $this->assertEqualsWithDelta(1000.0, $line['discount'], 0.001);
    }
}
