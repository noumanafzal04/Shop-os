<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CashSession;
use App\Models\City;
use App\Models\Customer;
use App\Models\Income;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleDocument;
use App\Models\SaleDocumentPayment;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The two promises a retailer makes before a sale exists.
 *
 *   QUOTATION — a price in writing, held until a date. Nothing moves.
 *   LAYAWAY   — money down, goods set aside, balance later.
 *
 * What these tests are really guarding is the accounting, because every way of
 * getting it wrong looks fine on screen and shows up weeks later as a drawer
 * that never balances:
 *
 *  - a deposit is cash in a drawer TODAY but revenue only at collection;
 *  - a layaway's goods leave the shelf when the advance is taken and must not
 *    leave it a second time when the customer collects;
 *  - a cancelled layaway puts the goods back and accounts for every rupee of
 *    the advance — refunded or kept, never evaporated.
 */
class SaleDocumentTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    /** Holds refund authority — the only person who can hand an advance back. */
    private User $manager;

    private Product $fridge;

    private Product $fan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->cashier = User::factory()
            ->tenantStaff($this->shop, ['sales.manage', 'discounts.apply'])->create(['name' => 'Bilal']);
        $this->manager = User::factory()
            ->tenantStaff($this->shop, ['sales.manage', 'sales.refund'])->create(['name' => 'Nadia']);

        $this->fridge = $this->product('Haier 12 cft', 90000, stock: 4);
        $this->fan = $this->product('Pak Fan Ceiling', 8000, stock: 10);
    }

    // ── Quotation ────────────────────────────────────────────────────

    public function test_a_quotation_moves_no_stock_and_takes_no_money(): void
    {
        $doc = $this->quote([['product_id' => $this->fridge->id, 'quantity' => 2]]);

        $this->assertSame('quotation', $doc['kind']);
        $this->assertStringStartsWith('QUO-', $doc['number']);
        $this->assertEquals(180000, $doc['total']);
        $this->assertEquals(0, $doc['deposit_paid']);
        $this->assertFalse($doc['stock_reserved']);

        // The shelf is untouched — an estimate is an offer, not a claim.
        $this->assertEquals(4, $this->fridge->fresh()->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()->count());
    }

    public function test_a_quotation_is_priced_by_the_server_not_the_client(): void
    {
        // A client sending its own price is the one thing that must never work:
        // a document freezes a price for weeks, so a forged one survives.
        $doc = $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'items' => [[
                'product_id' => $this->fridge->id, 'quantity' => 1,
                'unit_price' => 1, 'line_total' => 1,
            ]],
        ])->assertCreated()->json('data');

        $this->assertEquals(90000, $doc['total']);
        $this->assertEquals(90000, $doc['items'][0]['unit_price']);
    }

    public function test_a_quotation_defaults_to_the_shops_validity_window(): void
    {
        $this->shop->forceFill(['settings' => ['quotation_valid_days' => 7]])->save();

        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $this->assertSame(now()->addDays(7)->toDateString(), substr((string) $doc['expires_at'], 0, 10));
    }

    public function test_an_expired_quotation_is_refused_rather_than_quietly_repriced(): void
    {
        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        SaleDocument::withoutTenancy()->whereKey($doc['id'])
            ->update(['expires_at' => now()->subDay()->toDateString()]);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 8000,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'QUOTATION_EXPIRED');
    }

    public function test_converting_a_quotation_keeps_the_quoted_price_even_after_a_price_rise(): void
    {
        $doc = $this->quote([['product_id' => $this->fridge->id, 'quantity' => 1]]);

        // The shop raises its price the next morning. The paper in the
        // customer's hand still says 90,000 — that hold IS the product.
        $this->fridge->forceFill(['price' => 105000])->save();

        $sale = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 90000,
            ])
            ->assertCreated()
            ->json('data.sale');

        $this->assertEquals(90000, $sale['total']);
        // A quotation reserved nothing, so the stock moves NOW.
        $this->assertEquals(3, $this->fridge->fresh()->stock_quantity);
    }

    public function test_a_quotation_conversion_can_fail_on_stock_because_it_never_reserved_any(): void
    {
        $doc = $this->quote([['product_id' => $this->fridge->id, 'quantity' => 4]]);

        // Everything on the quote is sold to someone else in the meantime.
        $this->fridge->forceFill(['stock_quantity' => 1])->save();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 360000,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        // The document survives the failure — the shop can re-quote or order in.
        $this->assertSame('open', SaleDocument::withoutTenancy()->find($doc['id'])->status);
    }

    public function test_a_quotation_needs_no_customer(): void
    {
        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $this->assertNull($doc['customer_id']);
    }

    // ── Layaway ──────────────────────────────────────────────────────

    public function test_taking_an_advance_pulls_the_goods_off_the_shelf(): void
    {
        $doc = $this->layaway(30000);

        $this->assertStringStartsWith('LAY-', $doc['number']);
        $this->assertTrue($doc['stock_reserved']);
        $this->assertEquals(30000, $doc['deposit_paid']);

        // One fridge is in the back room with a name on it.
        $this->assertEquals(3, $this->fridge->fresh()->stock_quantity);
        $this->assertSame('layaway', StockMovement::withoutTenancy()->first()->reference_type);
    }

    public function test_a_layaway_needs_a_customer(): void
    {
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => 30000],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LAYAWAY_REQUIRES_CUSTOMER');
    }

    public function test_a_token_advance_is_refused(): void
    {
        // 20% of 90,000 is 18,000. Rs 500 takes a fridge off the floor for six
        // weeks and costs the customer nothing to walk away from.
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway',
            'customer_name' => 'Ahmed', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => 500],
        ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DEPOSIT_BELOW_MINIMUM');

        // And nothing was held — the whole transaction rolled back.
        $this->assertEquals(4, $this->fridge->fresh()->stock_quantity);
    }

    public function test_an_advance_is_cash_in_the_drawer_the_day_it_is_taken(): void
    {
        $session = $this->openShift(2000);

        $this->layaway(30000);

        $math = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));

        // 2,000 float + 30,000 advance. Nothing was sold, so the takings are
        // still zero — but the money is physically in the till and the count
        // must expect it, or every advance reads as an overage.
        $this->assertEquals(30000, $math['cash_in']);
        $this->assertEquals(32000, $math['expected_cash']);
        $this->assertEquals(0, $math['sales_total']);
        $this->assertSame(0, $math['sales_count']);
    }

    public function test_instalments_accumulate_and_cannot_overshoot_the_balance(): void
    {
        $doc = $this->layaway(30000);

        $after = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/deposits", ['amount' => 20000])
            ->assertCreated()
            ->json('data.document');

        $this->assertEquals(50000, $after['deposit_paid']);
        $this->assertEquals(40000, $after['balance']);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/deposits", ['amount' => 40001])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'DEPOSIT_EXCEEDS_BALANCE');
    }

    public function test_an_advance_cannot_go_on_the_khata(): void
    {
        $doc = $this->layaway(30000);

        // Holding goods against money you have also lent the customer is not
        // an advance — it's two risks stacked on one another.
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/deposits", [
                'amount' => 1000, 'method' => 'credit',
            ])
            ->assertStatus(422);
    }

    public function test_collecting_bills_the_full_total_but_only_the_balance_hits_the_drawer(): void
    {
        $session = $this->openShift(1000);
        $doc = $this->layaway(30000);

        $response = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
                'cash_session_id' => $session['id'],
            ])
            ->assertCreated();

        $sale = $response->json('data.sale');

        // The sale is for the whole 90,000 — that is what left the shop.
        $this->assertEquals(90000, $sale['total']);
        $this->assertEquals(90000, $sale['amount_paid']);
        $this->assertEquals(0, $sale['change_due']);

        // Settled by two tenders: the old advance, and today's cash.
        $tenders = collect($sale['payments'])->pluck('amount', 'method');
        $this->assertEquals(30000, $tenders['deposit']);
        $this->assertEquals(60000, $tenders['cash']);

        $math = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));

        // Revenue today: the full 90,000, because that is what left the shop.
        $this->assertEquals(90000, $math['sales_total']);

        // But only the 60,000 balance arrived as SALE tender. The advance
        // reached this drawer as a cash movement when it was taken, and the
        // expectation counts it exactly once:
        //   1,000 float + 30,000 advance + 60,000 balance = 91,000.
        // Counting the deposit tender as cash too would say 121,000 and hand
        // the cashier a 30,000 shortage they never caused.
        $this->assertEquals(60000, $math['cash_tendered']);
        $this->assertEquals(30000, $math['cash_in']);
        $this->assertEquals(91000, $math['expected_cash']);
    }

    public function test_the_receipt_names_the_advance_so_it_doesnt_read_as_paying_twice(): void
    {
        $doc = $this->layaway(30000);

        $sale = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
            ])->assertCreated()->json('data.sale');

        $html = $this->actingAsUser($this->cashier)
            ->get("/api/v1/sales/{$sale['id']}/invoice")->assertOk()->getContent();

        // Two tenders on one receipt. Without the label the customer reads a
        // 90,000 bill against 90,000 of tenders and asks where their advance
        // went — the money they handed over six weeks ago IS one of them.
        $this->assertStringContainsString('Advance paid earlier', $html);
        $this->assertStringContainsString('60,000.00', $html);
    }

    public function test_a_client_cannot_pass_off_a_tender_as_an_advance(): void
    {
        // 'deposit' means "money this shop already received and counted". A
        // till that could name it would be ringing sales against nothing.
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'payment_method' => 'deposit',
            'items' => [['product_id' => $this->fan->id, 'quantity' => 1]],
            'amount_paid' => 8000,
        ])->assertStatus(422);
    }

    public function test_collecting_does_not_take_the_stock_a_second_time(): void
    {
        $doc = $this->layaway(30000);

        // One fridge already left the shelf when the advance was taken.
        $this->assertEquals(3, $this->fridge->fresh()->stock_quantity);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
            ])->assertCreated();

        // Still 3. Taking it twice would write off a fridge that never existed.
        $this->assertEquals(3, $this->fridge->fresh()->stock_quantity);
        $this->assertSame(1, StockMovement::withoutTenancy()->count());
    }

    public function test_a_layaway_paid_off_in_instalments_converts_with_no_cash_at_all(): void
    {
        $doc = $this->layaway(30000);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/deposits", ['amount' => 60000])
            ->assertCreated();

        $sale = $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [])
            ->assertCreated()
            ->json('data.sale');

        $this->assertEquals(90000, $sale['total']);
        $this->assertSame('deposit', $sale['payment_method']);
    }

    public function test_an_overdue_layaway_can_still_be_collected(): void
    {
        $doc = $this->layaway(30000);

        SaleDocument::withoutTenancy()->whereKey($doc['id'])
            ->update(['expires_at' => now()->subMonth()->toDateString()]);

        // The customer's money is already in the till. Refusing to hand over
        // goods they part-paid for because a date passed is a dispute, not a
        // policy — unlike a quotation, which is only ever an offer.
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
            ])->assertCreated();
    }

    public function test_a_layaway_cannot_be_billed_twice(): void
    {
        $doc = $this->layaway(30000);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
            ])->assertCreated();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 60000,
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'DOCUMENT_NOT_OPEN');
    }

    public function test_a_double_tapped_advance_takes_the_money_and_the_goods_only_once(): void
    {
        $payload = [
            'kind' => 'layaway',
            'customer_name' => 'Ahmed', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => 30000],
            'idempotency_key' => 'till-1-abc',
        ];

        $first = $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/sale-documents', $payload)->assertCreated()->json('data');
        $second = $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/sale-documents', $payload)->assertCreated()->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame(1, SaleDocument::withoutTenancy()->count());
        $this->assertEquals(30000, $second['deposit_paid']);
        $this->assertEquals(3, $this->fridge->fresh()->stock_quantity);
    }

    // ── Cancellation ─────────────────────────────────────────────────

    public function test_cancelling_puts_the_goods_back_and_refunds_the_advance_by_default(): void
    {
        // The manager runs their own till — the refund has to come out of a
        // drawer someone is standing at, exactly like a void or a khata payout.
        $session = $this->openShift(50000, $this->manager);
        $doc = $this->layaway(30000, actor: $this->manager);

        $cancelled = $this->actingAsUser($this->manager)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", ['reason' => 'Changed mind'])
            ->assertOk()
            ->json('data');

        $this->assertSame('cancelled', $cancelled['status']);
        $this->assertEquals(30000, $cancelled['refunded_amount']);
        $this->assertEquals(0, $cancelled['forfeited_amount']);

        // The fridge is sellable again.
        $this->assertEquals(4, $this->fridge->fresh()->stock_quantity);

        // The advance came in and went straight back out — the drawer is back
        // to its float, with both legs on the ledger rather than neither.
        $math = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));
        $this->assertEquals(30000, $math['cash_in']);
        $this->assertEquals(30000, $math['cash_out']);
        $this->assertEquals(50000, $math['expected_cash']);
    }

    public function test_a_kept_cancellation_fee_is_recorded_as_income_not_as_a_sale(): void
    {
        $this->openShift(50000, $this->manager);
        $doc = $this->layaway(30000, actor: $this->manager);

        $cancelled = $this->actingAsUser($this->manager)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", [
                'reason' => 'Abandoned', 'forfeit_amount' => 5000,
            ])
            ->assertOk()
            ->json('data');

        $this->assertEquals(25000, $cancelled['refunded_amount']);
        $this->assertEquals(5000, $cancelled['forfeited_amount']);

        // Nothing was sold — the shop kept a fee for six weeks of holding
        // stock. Booking it as a sale would invent revenue and tax on it.
        $income = Income::withoutTenancy()->first();
        $this->assertEquals(5000, $income->amount);
        $this->assertStringContainsString($doc['number'], $income->description);
        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    public function test_the_refund_and_the_kept_amount_must_account_for_every_rupee(): void
    {
        $doc = $this->layaway(30000);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", [
                'refund_amount' => 10000, 'forfeit_amount' => 5000,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'REFUND_SPLIT_MISMATCH');
    }

    public function test_a_cashier_cannot_hand_back_an_advance_without_refund_authority(): void
    {
        $doc = $this->layaway(30000);

        // Bilal can ring sales all day. Giving money back is a manager's job.
        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", [])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'REFUND_PERMISSION_REQUIRED');
    }

    public function test_a_cashier_can_cancel_a_quotation_because_nothing_moves(): void
    {
        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", ['reason' => 'Bought elsewhere'])
            ->assertOk();
    }

    public function test_a_cancelled_document_takes_no_more_instalments(): void
    {
        $doc = $this->layaway(30000);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/cancel", [])->assertOk();

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/deposits", ['amount' => 1000])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'DOCUMENT_NOT_OPEN');
    }

    // ── The counter's lists ──────────────────────────────────────────

    public function test_the_lapsed_filter_finds_what_the_shop_should_be_phoning_about(): void
    {
        $live = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);
        $stale = $this->quote([['product_id' => $this->fan->id, 'quantity' => 2]]);

        SaleDocument::withoutTenancy()->whereKey($stale['id'])
            ->update(['expires_at' => now()->subWeek()->toDateString()]);

        $rows = $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/sale-documents?status=lapsed')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame($stale['id'], $rows[0]['id']);
        $this->assertNotSame($live['id'], $rows[0]['id']);
    }

    public function test_the_summary_separates_the_customers_money_from_the_shops(): void
    {
        $this->layaway(30000);
        $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $summary = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/sale-documents/summary')->assertOk()->json('data');

        $this->assertSame(1, $summary['open_layaways']);
        $this->assertSame(1, $summary['open_quotations']);
        // Money the shop is holding but has not earned.
        $this->assertEquals(30000, $summary['deposits_held']);
        $this->assertEquals(90000, $summary['layaway_value']);
        $this->assertEquals(60000, $summary['balance_outstanding']);
    }

    public function test_a_document_prints_with_its_number_and_its_terms(): void
    {
        $doc = $this->layaway(30000);

        $html = $this->actingAsUser($this->cashier)
            ->get("/api/v1/sale-documents/{$doc['id']}/print")
            ->assertOk()
            ->getContent();

        $this->assertStringContainsString($doc['number'], $html);
        $this->assertStringContainsString('Advance Booking', $html);
        $this->assertStringContainsString('Collect by', $html);
        // The balance the customer has to bring back.
        $this->assertStringContainsString('60,000.00', $html);
    }

    public function test_a_quotation_prints_without_a_money_panel(): void
    {
        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $html = $this->actingAsUser($this->cashier)
            ->get("/api/v1/sale-documents/{$doc['id']}/print")
            ->assertOk()->getContent();

        $this->assertStringContainsString('Quotation', $html);
        $this->assertStringContainsString('Valid until', $html);
        // Printing "Advance paid: 0.00" on an estimate only invites the question.
        $this->assertStringNotContainsString('Advance paid', $html);
        $this->assertStringNotContainsString('Balance due', $html);
    }

    public function test_a_shop_can_switch_layaway_off(): void
    {
        $this->shop->forceFill(['settings' => ['layaway_enabled' => false]])->save();

        $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway',
            'customer_name' => 'Ahmed', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => 30000],
        ])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'DOCUMENT_KIND_DISABLED');
    }

    public function test_documents_are_scoped_to_their_own_shop(): void
    {
        $doc = $this->quote([['product_id' => $this->fan->id, 'quantity' => 1]]);

        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $intruder = User::factory()->shopOwner($other)->create();

        $this->actingAsUser($intruder)
            ->getJson("/api/v1/sale-documents/{$doc['id']}")
            ->assertNotFound();
    }

    public function test_a_deposit_links_to_the_shift_that_received_it_not_the_one_that_collects(): void
    {
        $opening = $this->openShift(1000);
        $doc = $this->layaway(30000);

        // The shift that took the advance closes; a new one opens tomorrow.
        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/pos/session/close', ['counted_cash' => 31000])->assertOk();

        $payment = SaleDocumentPayment::withoutTenancy()->first();

        $this->assertSame($opening['id'], $payment->cash_session_id);
        $this->assertEquals(30000, $payment->amount);
        $this->assertSame($doc['id'], $payment->sale_document_id);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    private function product(string $name, float $price, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => $name, 'price' => $price, 'cost' => $price * 0.75,
            'track_inventory' => true, 'stock_quantity' => $stock, 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param array<int, array<string, mixed>> $items */
    private function quote(array $items, array $extra = []): array
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation',
            'items' => $items,
            ...$extra,
        ])->assertCreated()->json('data');
    }

    /** One fridge, held on the given advance, for Ahmed. */
    private function layaway(float $deposit, array $extra = [], ?User $actor = null): array
    {
        return $this->actingAsUser($actor ?? $this->cashier)->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway',
            'customer_name' => 'Ahmed', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->fridge->id, 'quantity' => 1]],
            'deposit' => ['amount' => $deposit],
            ...$extra,
        ])->assertCreated()->json('data');
    }

    private function openShift(float $float, ?User $actor = null): array
    {
        return $this->actingAsUser($actor ?? $this->cashier)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => $float])
            ->assertCreated()->json('data');
    }

    private function branchId(): string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->value('id');
    }

    private function customerCount(): int
    {
        return Customer::withoutTenancy()->where('tenant_id', $this->shop->id)->count();
    }
}
