<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\SaleDocument;
use App\Models\SaleDocumentPayment;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * A SHOP THAT ASKS FOR SHIFTS SELLS AT THE COUNTER ONLY ON TODAY'S SHIFT.
 *
 * The user (2026-10-15): "settings main open shift required hain to pos main
 * bagair open shift k sell q ho rhi?" Two holes. The rule was read by one
 * door (the till's POST /sales): a settled tab, an exchange, a quotation
 * billed and a New Sale at the counter never asked. And it asked only
 * whether SOME shift was open — Zari's three shifts had been open since the
 * 13th, and the till sold on the 15th into the 13th's drawers and day.
 */
class AShopThatAsksForShiftsSellsOnTodaysShiftTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo('2026-10-13 11:00:00');
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->item = $this->as()->postJson('/api/v1/products', [
            'name' => 'Lawn Suit', 'item_type' => 'physical_product', 'price' => 1000, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function requireShifts(bool $on = true): void
    {
        $this->as()->putJson('/api/v1/shop/settings', ['pos_require_shift' => $on])->assertOk();
    }

    private function sell(string $channel = 'pos'): TestResponse
    {
        return $this->as()->postJson('/api/v1/sales', [
            'channel' => $channel, 'items' => [['product_id' => $this->item, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ]);
    }

    private function refused(TestResponse $res, string $what, string $code = 'SHIFT_REQUIRED'): void
    {
        $res->assertStatus(409);
        $this->assertSame($code, $res->json('meta.error_code'), "{$what} was not refused for want of today's shift");
    }

    public function test_every_way_of_selling_at_the_counter_asks_for_a_shift(): void
    {
        // Rung before the shop asked for shifts: a sale to exchange, a tab, a quote.
        $sale = $this->sell()->assertCreated()->json('data');
        $tab = $this->as()->postJson('/api/v1/restaurant/tickets', ['order_type' => 'takeaway', 'customer_name' => 'Adnan'])->assertCreated()->json('data');
        $this->as()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", ['items' => [['product_id' => $this->item, 'quantity' => 1]]])->assertOk();
        $quote = $this->as()->postJson('/api/v1/sale-documents', ['kind' => 'quotation', 'items' => [['product_id' => $this->item, 'quantity' => 1]]])->assertCreated()->json('data');

        $this->requireShifts();

        $this->refused($this->sell(), 'a till sale');
        $this->refused($this->sell('walk_in'), 'a New Sale at the counter');
        $this->refused($this->as()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", ['payment_method' => 'cash', 'amount_paid' => 1000]), 'a settled tab');
        $this->refused($this->as()->postJson("/api/v1/sale-documents/{$quote['id']}/convert", ['payment_method' => 'cash', 'amount_paid' => 1000]), 'a quotation billed');
        $this->refused($this->as()->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
        ]), 'an exchange');

        // A phone order is not rung at a till.
        $this->as()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233', 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
        ])->assertCreated();

        // With today's shift open, the till sells again.
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();
        $this->sell()->assertCreated();
        $this->as()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", ['payment_method' => 'cash', 'amount_paid' => 1000])->assertCreated();
    }

    public function test_a_shift_left_open_from_an_earlier_day_does_not_count(): void
    {
        $this->requireShifts();
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();
        $this->sell()->assertCreated();

        // Never closed. Two days later the till is opened again.
        $this->travelTo('2026-10-15 10:00:00');
        $session = $this->as()->getJson('/api/v1/pos/session')->assertOk()->json('data');
        $this->assertSame('2026-10-13', $session['opened_on']);
        $this->assertTrue($session['from_an_earlier_day'], 'the till is not told its shift is from an earlier day');

        $res = $this->sell();
        $this->refused($res, 'a sale on the 13th\'s shift', 'SHIFT_FROM_AN_EARLIER_DAY');
        $this->assertStringContainsString('13 Oct 2026', $res->json('message'));

        // Closed and opened again: today's shift sells.
        $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 2000])->assertOk();
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();
        $this->assertFalse($this->as()->getJson('/api/v1/pos/session')->json('data.from_an_earlier_day'));
        $this->sell()->assertCreated();
    }

    /**
     * Cash taken as an advance goes into a drawer just as a sale's does. With
     * no shift it was recorded and reached no drawer, without a word (L2).
     */
    public function test_cash_taken_as_an_advance_needs_todays_shift(): void
    {
        $this->requireShifts();
        $documents = fn (): int => SaleDocument::withoutTenancy()->count();
        $hold = fn (string $method, string $key): TestResponse => $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233', 'idempotency_key' => $key,
            'items' => [['product_id' => $this->item, 'quantity' => 2]],
            'deposit' => ['amount' => 500, 'method' => $method],
        ]);
        $pay = fn (string $id, string $method, string $key): TestResponse => $this->as()->postJson("/api/v1/sale-documents/{$id}/deposits", [
            'amount' => 100, 'method' => $method, 'idempotency_key' => $key,
        ]);

        // No shift: the cash advance is refused, and nothing is held.
        $before = $documents();
        $res = $hold('cash', 'hold-cash-1');
        $this->refused($res, 'a cash advance with no shift');
        $this->assertSame('Open a shift before taking cash.', $res->json('message'));
        $this->assertSame($before, $documents(), 'the goods were held although their advance was refused');

        // Card money goes into no drawer, so it needs none.
        $layaway = $hold('card', 'hold-card-1')->assertCreated()->json('data');
        $this->refused($pay($layaway['id'], 'cash', 'pay-cash-1'), 'more cash on an advance, with no shift');
        $pay($layaway['id'], 'card', 'pay-card-1')->assertCreated();

        // On today's shift the cash goes in, into that shift's drawer.
        $shift = $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated()->json('data.id');
        $paid = $pay($layaway['id'], 'cash', 'pay-cash-2')->assertCreated()->json('data');
        $this->assertSame($shift, $paid['payment']['cash_session_id'] ?? SaleDocumentPayment::withoutTenancy()->whereKey($paid['payment']['id'])->value('cash_session_id'), 'the cash advance did not land in the shift that took it');
        $this->assertSame(100.0, (float) CashMovement::withoutTenancy()->where('cash_session_id', $shift)->where('type', 'deposit_in')->sum('amount'), "the shift's drawer did not hear of the cash");

        // Two days later the same shift is an earlier day's.
        $this->travelTo('2026-10-15 10:00:00');
        $this->refused($pay($layaway['id'], 'cash', 'pay-cash-3'), "cash on the 13th's shift", 'SHIFT_FROM_AN_EARLIER_DAY');

        // Closed and today's opened: the cash is taken on today's, not the old one.
        $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 1100])->assertOk();
        $today = $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated()->json('data.id');
        $paid = $pay($layaway['id'], 'cash', 'pay-cash-4')->assertCreated()->json('data');
        $this->assertSame($today, $paid['payment']['cash_session_id'] ?? null);
    }

    public function test_a_shop_that_does_not_ask_for_shifts_is_not_refused(): void
    {
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();
        $this->travelTo('2026-10-15 10:00:00');

        $this->sell()->assertCreated();
        $this->sell('walk_in')->assertCreated();

        // Nor is cash taken as an advance with no shift at all.
        $this->as()->postJson('/api/v1/pos/session/close', ['counted_cash' => 3000])->assertOk();
        $this->as()->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233', 'idempotency_key' => 'hold-no-rule',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
            'deposit' => ['amount' => 500, 'method' => 'cash'],
        ])->assertCreated();
    }
}
