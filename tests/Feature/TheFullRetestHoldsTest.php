<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\BankDeposit;
use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The full re-test (2026-10-18, docs/qa/TESTER-REPORT-2026-10-18-full-retest.md):
 * each figure the tester found off, asked the way the tester asked it — every
 * screen that shows it reads the same, to the paisa.
 */
class TheFullRetestHoldsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    private User $manager;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo(Carbon::parse('2026-10-18 15:00:00', 'Asia/Karachi'));

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->tenantStaff($this->shop, ['sales.manage', 'discounts.apply'])->create(['name' => 'Ayesha']);
        $this->manager = User::factory()->tenantStaff($this->shop, ['sales.manage', 'discounts.apply', 'discounts.override'])->create(['name' => 'Hina']);
        $this->manager->setPin('1357');
        $this->cashier->setPin('2468');
    }

    /** #8: an exchange's credit is not sold twice on Day & banking. */
    public function test_the_day_rings_up_an_exchange_as_reports_count_it(): void
    {
        $this->product('Kurta M', 1000);
        $this->product('Kurta L', 1500);
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
        $this->sell(['Kurta M' => 1], ['payment_method' => 'cash', 'amount_paid' => 1000]);
        $card = $this->sell(['Kurta M' => 1], ['payment_method' => 'card', 'amount_paid' => 1000]);

        $this->as($this->owner)->postJson("/api/v1/sales/{$card['id']}/exchange", [
            'return_items' => [['sale_item_id' => $card['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $this->item['Kurta L'], 'quantity' => 1]],
            'payments' => [['method' => 'card', 'amount' => 500]], 'channel' => 'walk_in',
        ])->assertCreated();

        // 1,000 + 1,000 + (1,500 − the 1,000 the returned M paid for it).
        $day = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');
        $this->assertEquals(2500, $day['running']['sales_total']);
        $this->assertEquals(2500, $day['sessions'][0]['live']['sales_total'] ?? $day['sessions'][0]['sales_total']);
        $this->assertEquals(2500, $this->as($this->owner)->getJson('/api/v1/reports/summary?period=daily')->json('data.totals.revenue'));
    }

    /** #8, the same for a sale no drawer took (B14's "not at a counter"). */
    public function test_the_day_rings_up_an_exchange_away_from_the_drawers_the_same_way(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['pos_require_shift' => false])->assertOk();
        $this->product('Kurta M', 1000);
        $this->product('Kurta L', 1500);
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $this->as($this->owner)->postJson('/api/v1/pos/session/close', ['counted_cash' => 0])->assertOk();
        $card = $this->sell(['Kurta M' => 1], ['payment_method' => 'card', 'amount_paid' => 1000]);
        $this->assertNull($card['cash_session_id'], 'no drawer took it');

        $this->as($this->owner)->postJson("/api/v1/sales/{$card['id']}/exchange", [
            'return_items' => [['sale_item_id' => $card['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $this->item['Kurta L'], 'quantity' => 1]],
            'payments' => [['method' => 'card', 'amount' => 500]], 'channel' => 'walk_in',
        ])->assertCreated();

        $day = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data.running');
        $this->assertEquals(1500, $day['away_from_drawers']['sales_total']);
        $this->assertEquals(1500, $day['sales_total']);
        $this->assertEquals(1500, $this->as($this->owner)->getJson('/api/v1/reports/summary?period=daily')->json('data.totals.revenue'));
    }

    /** #2, #11: the rounding on a cash bill is money the books hold. */
    public function test_the_rounding_on_a_cash_bill_is_in_every_book(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['cash_rounding' => 10])->assertOk();
        $this->product('Yogurt', 116.99, cost: 50);
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();

        $sale = $this->sell(['Yogurt' => 1], ['payment_method' => 'cash', 'amount_paid' => 120]);
        $this->assertEquals(116.99, $sale['total'], 'the bill is not changed');
        $this->assertEquals(3.01, $sale['rounding_adjustment']);

        $book = $this->as($this->owner)->getJson('/api/v1/cashbook?period=daily')->assertOk()->json('data');
        $this->assertEquals(116.99, $book['totals']['sales_revenue'], 'the sales column is still revenue');
        $this->assertEquals(3.01, $book['totals']['cash_rounding']);
        $this->assertEquals(120, $book['totals']['money_in'], 'every rupee that came in');
        $this->assertEquals(3.01, collect($book['days'])->sum('cash_rounding'));
        $this->assertEquals(120, $book['closing_balance']);

        $ledger = $this->as($this->owner)->getJson('/api/v1/ledger?period=daily')->assertOk()->json();
        $this->assertEquals(120, collect($ledger['data'])->sum('in'));
        $this->assertEquals(120, $ledger['meta']['totals']['in']);

        $report = $this->as($this->owner)->getJson('/api/v1/reports/summary?period=daily')->json('data.totals');
        $this->assertEquals(116.99, $report['revenue'], 'rounding is no sale');
        $this->assertEquals(3.01, $report['cash_rounding']);
        // 116.99 − 50 cost + 3.01 kept in the drawer.
        $this->assertEquals(70, $report['net_profit']);
        $this->assertEquals(70, $this->as($this->owner)->getJson('/api/v1/dashboard')->json('data.today.profit'));
        $this->assertEquals(70, collect($this->as($this->owner)->getJson('/api/v1/reports/summary?period=daily')->json('data.series'))->sum('profit'));

        // And the next day opens on what was really taken.
        $this->travel(1)->days();
        $this->assertEquals(120, $this->as($this->owner)->getJson('/api/v1/cashbook?period=daily')->json('data.opening_balance'));
    }

    /** #1: what a supplier was paid has its own total, beside the days that show it. */
    public function test_the_cashbook_names_what_suppliers_were_paid(): void
    {
        $book = $this->as($this->owner)->getJson('/api/v1/cashbook?period=daily')->assertOk()->json('data.totals');

        $this->assertArrayHasKey('supplier_payments', $book);
        $this->assertEquals($book['money_out'], $book['expenses'] + $book['refunds'] + $book['supplier_payments']);
    }

    /** #10: the day is closed off, then the takings walk to the bank. */
    public function test_a_deposit_after_the_close_belongs_to_the_closed_day(): void
    {
        $this->product('Rice', 5000);
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $this->sell(['Rice' => 1], ['payment_method' => 'cash', 'amount_paid' => 5000]);
        $this->as($this->owner)->postJson('/api/v1/pos/session/close', ['counted_cash' => 5000])->assertOk();
        $dayId = $this->as($this->owner)->getJson('/api/v1/pos/day')->json('data.day.id');
        $this->as($this->owner)->postJson("/api/v1/pos/days/{$dayId}/close", [])->assertOk();

        $this->as($this->owner)->postJson('/api/v1/pos/deposits', ['amount' => 4000, 'bank_name' => 'Meezan'])->assertCreated();

        $this->assertSame($dayId, BankDeposit::query()->value('business_day_id'));
        $past = collect($this->as($this->owner)->getJson('/api/v1/pos/days')->json('data'))->firstWhere('id', $dayId);
        $this->assertEquals(4000, $past['banked_amount']);
        $detail = $this->as($this->owner)->getJson("/api/v1/pos/days/{$dayId}")->json('data');
        $this->assertEquals(4000, $detail['banked_amount']);
        $this->assertCount(1, $detail['deposits']);
    }

    /** #9: a drawer that should hold paisa can be counted to the paisa. */
    public function test_a_count_by_note_takes_the_loose_paisa_too(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['cash_rounding' => 0])->assertOk();
        $this->product('Biscuit', 50.5);
        $session = $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful()->json('data');
        $this->sell(['Biscuit' => 1], ['payment_method' => 'cash', 'amount_paid' => 50.5]);

        $closed = $this->as($this->owner)->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 0, 'denominations' => ['50' => 1], 'loose_cash' => 0.5,
        ])->assertOk()->json('data');

        $this->assertEquals(50.5, $closed['counted_cash']);
        $this->assertEquals(0, $closed['variance'], 'counted exactly, not 50 paisa short');
        $this->assertEquals(['50' => 1], $closed['closing_denominations'], 'the notes as counted');
        $this->as($this->owner)->get("/api/v1/pos/sessions/{$session['id']}/z-report/print")
            ->assertOk()->assertSeeInOrder(['Loose cash', 'Total counted']);
    }

    /** #6: two returns of one line hand back all of its tax, not all but a paisa. */
    public function test_returning_a_line_one_unit_at_a_time_hands_back_every_paisa(): void
    {
        $this->product('Yogurt', 99.99, tax: 17);
        $this->as($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertSuccessful();
        // 2 × 99.99 − 15 = 184.98; tax 31.4466 → 31.45; total 216.43.
        $sale = $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 216.43,
            'items' => [['product_id' => $this->item['Yogurt'], 'quantity' => 2, 'line_discount' => 15]],
        ])->assertCreated()->json('data');
        $this->assertEquals(31.45, $sale['tax']);
        $this->assertEquals(216.43, $sale['total']);

        foreach ([1, 2] as $_) {
            $this->as($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
                'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]], 'refund_method' => 'cash',
            ])->assertCreated();
        }

        $returns = SaleReturn::query()->where('sale_id', $sale['id'])->get();
        $this->assertEquals(31.45, round((float) $returns->sum('refund_tax'), 2), 'all of the tax');
        $this->assertEquals(216.43, round((float) $returns->sum('refund_total'), 2), 'all of what was paid');
        $this->assertSame('refunded', Sale::query()->findOrFail($sale['id'])->status->value);
    }

    /** #7: a cashier made with the preset's one click is a Cashier. */
    public function test_a_preset_applied_in_this_shop_is_named_its_job(): void
    {
        $presets = collect($this->as($this->owner)->getJson('/api/v1/staff/presets')->assertOk()->json('data'));
        $cashier = $presets->firstWhere('code', 'cashier');
        $this->assertNotContains('tables.serve_any', $cashier['permissions'], 'a mart has no tables — the form trims it');

        $made = $this->as($this->owner)->postJson('/api/v1/staff', [
            'name' => 'Bilal', 'email' => 'bilal@shop.test', 'password' => 'secret-password', 'permissions' => $cashier['permissions'],
        ])->assertCreated()->json('data');

        $this->assertSame('Cashier', $made['job']);
        $listed = collect($this->as($this->owner)->getJson('/api/v1/staff')->json('data'))->firstWhere('id', $made['id']);
        $this->assertSame('Cashier', $listed['job']);
        $this->assertContains($made['id'], collect($this->as($this->owner)->getJson('/api/v1/staff?job=cashier')->json('data'))->pluck('id')->all());

        // One box off is still Custom.
        $this->as($this->owner)->putJson("/api/v1/staff/{$made['id']}", ['permissions' => ['sales.manage']])->assertOk();
        $this->assertNull(collect($this->as($this->owner)->getJson('/api/v1/staff')->json('data'))->firstWhere('id', $made['id'])['job']);
    }

    /** #3: past the shop's limit, a manager's PIN on the cashier's till says yes. */
    public function test_a_manager_pin_lets_a_discount_past_the_limit(): void
    {
        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['max_discount_percent' => 10])->assertOk();
        $this->product('Juice', 100);
        $this->as($this->cashier)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->assertSuccessful();
        $bill = fn (array $extra = []): TestResponse => $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'card', 'amount_paid' => 89, 'discount' => 11,
            'items' => [['product_id' => $this->item['Juice'], 'quantity' => 1]], ...$extra,
        ]);

        $bill()->assertForbidden()->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');
        $bill(['discount_approval' => ['user_id' => $this->manager->id, 'pin' => '0000']])->assertUnauthorized();
        // The cashier cannot say yes to their own discount.
        $bill(['discount_approval' => ['user_id' => $this->cashier->id, 'pin' => '2468']])
            ->assertForbidden()->assertJsonPath('meta.error_code', 'APPROVER_CANNOT');
        $this->assertSame(0, Sale::query()->count(), 'refused, nothing rung');

        $sale = $bill(['discount_approval' => ['user_id' => $this->manager->id, 'pin' => '1357']])->assertCreated()->json('data');
        $this->assertEquals(89, $sale['total']);
        $this->assertSame(1, Sale::query()->count());
        $trail = AuditLog::query()->where('event', 'approved')->where('auditable_id', $sale['id'])->firstOrFail();
        $this->assertSame('Hina', $trail->new_values['approved_by']);
        $this->assertSame('Ayesha', $trail->new_values['done_by']);
        $this->assertEquals(11, $trail->new_values['amount']);
    }

    private function product(string $name, float $price, float $cost = 0, float $tax = 0): void
    {
        $this->item[$name] = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'cost' => $cost,
            'tax_rate' => $tax, 'track_inventory' => true, 'stock_quantity' => 50,
        ])->assertCreated()->json('data.id');
    }

    /** @param array<string, int> $lines */
    private function sell(array $lines, array $extra): array
    {
        return $this->as($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => collect($lines)->map(fn ($q, $name) => ['product_id' => $this->item[$name], 'quantity' => $q])->values()->all(),
            ...$extra,
        ])->assertCreated()->json('data');
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }
}
