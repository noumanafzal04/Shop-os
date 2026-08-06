<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\Product;
use App\Models\SaleTradeIn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The old battery on the counter.
 *
 * A customer buys a Rs 24,500 battery, hands over their dead one, and pays
 * Rs 21,500. The only way to record that was a Rs 3,000 discount, and a
 * discount is the wrong shape in two directions at once:
 *
 *  - Revenue is understated. The battery sold for 24,500. The shop did not cut
 *    its price; it accepted part of the payment in goods. Every margin report
 *    read as though the counter had been giving money away.
 *  - The scrap vanished. The shop now holds a dead battery a scrap dealer pays
 *    real money for, and nothing said so. Bought, stored and sold with no
 *    record at either end — which is the gap a batch of them walks out through.
 *
 * A trade-in is a TENDER: part of the bill settled in goods. These tests hold
 * that, and the three places it has to stay true — the drawer, the void, and
 * the return.
 */
class TradeInTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $battery;

    private Product $scrap;

    private string $sessionId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create([
            'business_type' => 'automotive',
            'setup_completed' => true,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->battery = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Osaka S-70 Battery', 'price' => 24500, 'cost' => 19000,
            'track_inventory' => true, 'stock_quantity' => 10, 'is_active' => true,
        ]);

        // The bucket the yard's dead batteries land in. It is an ordinary
        // stock item, which is the point: countable, sellable to a dealer.
        $this->scrap = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product',
            'name' => 'Scrap Battery', 'price' => 3500, 'cost' => 0,
            'track_inventory' => true, 'stock_quantity' => 0, 'is_active' => true,
        ]);

        $this->sessionId = $this->login($this->owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 5000])
            ->assertCreated()->json('data.id');
    }

    // ── The money ────────────────────────────────────────────────────

    public function test_the_sale_keeps_its_full_price_and_the_goods_settle_part_of_it(): void
    {
        $sale = $this->sellBattery(allowance: 3000);

        // Not a discount. The battery sold for what it sells for.
        $this->assertEquals(24500, $sale['total']);
        $this->assertEquals(0, $sale['discount']);
        $this->assertEquals(3000, $sale['trade_in_total']);
        // Paid in full — 21,500 in rupees and 3,000 in goods.
        $this->assertEquals(24500, $sale['amount_paid']);
        $this->assertEquals(0, $sale['change_due']);
    }

    public function test_the_allowance_is_a_tender_of_its_own(): void
    {
        $sale = $this->sellBattery(allowance: 3000);

        $tenders = collect($sale['payments'])->pluck('amount', 'method');

        $this->assertEquals(21500, $tenders['cash']);
        $this->assertEquals(3000, $tenders['trade_in']);
        $this->assertSame('split', $sale['payment_method']);
    }

    public function test_the_scrap_lands_in_stock_the_moment_it_crosses_the_counter(): void
    {
        $this->sellBattery(allowance: 3000);

        $this->assertEquals(1, $this->scrap->fresh()->stock_quantity);
        $this->assertEquals(9, $this->battery->fresh()->stock_quantity);
    }

    public function test_what_came_in_is_recorded_line_by_line(): void
    {
        $sale = $this->sellBattery(allowance: 3000);

        $row = SaleTradeIn::withoutTenancy()->where('sale_id', $sale['id'])->firstOrFail();

        // The scrap SKU is a bucket; this is the row that answers "which one
        // did we take in on Tuesday?".
        $this->assertSame('Scrap Battery', $row->product_name);
        $this->assertSame('Osaka 70Ah, about 2 years old', $row->description);
        $this->assertEquals(3000, $row->total_allowance);
        $this->assertNull($row->reversed_at);
    }

    public function test_the_till_is_only_expected_to_hold_the_rupees(): void
    {
        $this->sellBattery(allowance: 3000);

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($this->sessionId));

        // 5,000 float + 21,500 cash. Counting the goods slice would invent a
        // 3,000 shortage and hand it to the cashier to explain.
        $this->assertEquals(26500, $drawer['expected_cash']);
        $this->assertEquals(21500, $drawer['cash_tendered']);
        // …but the shift still reports what came in as goods.
        $this->assertEquals(3000, $drawer['tender_mix']['trade_in']);
    }

    // ── The guards ───────────────────────────────────────────────────

    public function test_an_allowance_bigger_than_the_bill_is_refused(): void
    {
        // The shop would owe the customer money for their scrap. That is buying
        // stock, not selling any, and it belongs on a purchase — where a
        // supplier and a payment get recorded — not on a till that would have
        // to open and hand out cash.
        $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash', 'amount_paid' => 0,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
            'trade_ins' => [['product_id' => $this->scrap->id, 'unit_allowance' => 30000]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'TRADE_IN_EXCEEDS_TOTAL');
    }

    public function test_a_client_cannot_name_its_own_trade_in_tender(): void
    {
        // With nothing crossing the counter, this would settle any bill.
        $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payments' => [['method' => 'trade_in', 'amount' => 24500]],
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonValidationErrors('payments.0.method');
    }

    public function test_a_service_cannot_be_traded_in(): void
    {
        $fitting = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'service',
            'name' => 'Battery Fitting', 'price' => 500, 'is_active' => true,
        ]);

        // An allowance backed by nothing you can put on a shelf.
        $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash', 'amount_paid' => 24000,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
            'trade_ins' => [['product_id' => $fitting->id, 'unit_allowance' => 500]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'TRADE_IN_NOT_STOCKABLE');
    }

    public function test_the_rupee_slice_must_still_cover_the_rest_of_the_bill(): void
    {
        $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash', 'amount_paid' => 10000,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
            'trade_ins' => [['product_id' => $this->scrap->id, 'unit_allowance' => 3000]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    // ── Reversal ─────────────────────────────────────────────────────

    public function test_voiding_the_sale_sends_the_scrap_back_out(): void
    {
        $sale = $this->sellBattery(allowance: 3000);
        $this->assertEquals(1, $this->scrap->fresh()->stock_quantity);

        $this->login($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", [
            'reason_code' => 'wrong_item',
        ])->assertOk();

        // Otherwise every ring-and-void hands the shop a free dead battery,
        // and no stock report would ever show it.
        $this->assertEquals(0, $this->scrap->fresh()->stock_quantity);
        $this->assertEquals(10, $this->battery->fresh()->stock_quantity);
        $this->assertNotNull(SaleTradeIn::withoutTenancy()->where('sale_id', $sale['id'])->first()->reversed_at);
    }

    public function test_a_void_pays_back_only_the_cash_that_was_taken(): void
    {
        $sale = $this->sellBattery(allowance: 3000);

        $this->login($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", [
            'reason_code' => 'wrong_item',
        ])->assertOk();

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($this->sessionId));

        // 5,000 float + 21,500 in − 21,500 handed back. Paying out 24,500 would
        // have turned the counter into a way of buying dead batteries at 3,000.
        $this->assertEquals(5000, $drawer['expected_cash']);
    }

    public function test_a_full_return_gives_the_old_unit_back_and_refunds_only_the_rupees(): void
    {
        $sale = $this->sellBattery(allowance: 3000);
        $itemId = $sale['items'][0]['id'];

        $return = $this->login($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'cash_session_id' => $this->sessionId,
            'refund_method' => 'cash',
            'items' => [['sale_item_id' => $itemId, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // The refund is the full invoice — but 3,000 of it is the customer's
        // own battery walking back out, not money.
        $this->assertEquals(24500, $return['refund_total']);
        $this->assertEquals(3000, $return['refund_trade_in']);
        $this->assertEquals(0, $this->scrap->fresh()->stock_quantity);

        $drawer = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($this->sessionId));
        $this->assertEquals(5000, $drawer['expected_cash']);
    }

    public function test_a_partial_return_leaves_the_trade_in_alone(): void
    {
        // You cannot hand back half an old battery. The allowance was given
        // against the deal as a whole and there is no honest fraction of it.
        $sale = $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash', 'amount_paid' => 46000,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 2]],
            'trade_ins' => [['product_id' => $this->scrap->id, 'unit_allowance' => 3000]],
        ])->assertCreated()->json('data');

        $return = $this->login($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'cash_session_id' => $this->sessionId,
            'refund_method' => 'cash',
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(0, $return['refund_trade_in']);
        $this->assertEquals(1, $this->scrap->fresh()->stock_quantity);
        $this->assertNull(SaleTradeIn::withoutTenancy()->where('sale_id', $sale['id'])->first()->reversed_at);
    }

    public function test_a_sale_without_a_trade_in_is_completely_unchanged(): void
    {
        $sale = $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash', 'amount_paid' => 24500,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(0, $sale['trade_in_total']);
        $this->assertSame('cash', $sale['payment_method']);
        $this->assertCount(1, $sale['payments']);
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function sellBattery(float $allowance): array
    {
        return $this->login($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'cash_session_id' => $this->sessionId,
            'payment_method' => 'cash',
            'amount_paid' => 24500 - $allowance,
            'items' => [['product_id' => $this->battery->id, 'quantity' => 1]],
            'trade_ins' => [[
                'product_id' => $this->scrap->id,
                'quantity' => 1,
                'unit_allowance' => $allowance,
                'description' => 'Osaka 70Ah, about 2 years old',
            ]],
        ])->assertCreated()->json('data');
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
