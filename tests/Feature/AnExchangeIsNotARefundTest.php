<?php

namespace Tests\Feature;

use App\Models\Sale;
use App\Models\SaleReturn;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * B21 (the tester): an exchange was counted as a refund AND a new sale. The
 * dashboard said 4,950 refunded on a day when 1,100 went back over the
 * counter, and the takings carried the replacements whole.
 *
 * The day:
 *   a shirt (2,000) and a kurta (2,950) sold for cash          5,950 in
 *   the shirt swapped for a kurta (2,950): 950 more paid          950 in
 *   the kurta swapped for a kids' suit (1,850): 1,100 handed back 1,100 out
 *
 * Every screen now says 5,900 taken and 1,100 handed back. The net (4,800)
 * is what it always was.
 */
class AnExchangeIsNotARefundTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    /** @var array<string, string> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo('2026-10-17 12:00:00');

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        foreach (['Shirt' => 2000, 'Kurta' => 2950, 'Kids Suit' => 1850] as $name => $price) {
            $this->item[$name] = $this->as()->postJson('/api/v1/products', [
                'name' => $name, 'item_type' => 'physical_product', 'price' => $price, 'track_inventory' => true, 'stock_quantity' => 5,
            ])->assertCreated()->json('data.id');
        }
        $this->as()->postJson('/api/v1/pos/session/open', ['opening_float' => 5000])->assertSuccessful();

        $this->exchange($this->sell('Shirt', 2000), 'Kurta', [['method' => 'cash', 'amount' => 950]]);
        $this->exchange($this->sell('Kurta', 2950), 'Kids Suit');
    }

    public function test_every_screen_counts_the_money_that_changed_hands(): void
    {
        $this->assertSame([5900.0, 1100.0], $this->everyScreen());
    }

    /**
     * The drawer's own words for the same day (B21's last half): the 1,100
     * handed back on the second swap is not "Change given", the credit is
     * not an "Other" tender, and neither swap is a refund. The money it
     * expects is the money it always expected.
     */
    public function test_the_drawer_says_an_exchange_is_an_exchange(): void
    {
        $drawer = $this->as()->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');

        $this->assertEquals(1100, $drawer['change_given'], 'all of it left the drawer');
        $this->assertEquals(1100, $drawer['exchange_cash_back'], '…on the swap, not as change');
        $this->assertEquals(4950, $drawer['tender_mix']['exchange_credit']);
        $this->assertArrayNotHasKey('other', $drawer['tender_mix'], 'the credit read as a tender nobody took');
        $this->assertSame(0, $drawer['refunds']);
        $this->assertSame(2, $drawer['exchanges']);
        // 5,000 float + 2,000 + 2,950 + 950 in − 1,100 back.
        $this->assertEquals(9800, $drawer['expected_cash']);
    }

    public function test_a_close_asks_nobody_to_declare_the_goods_that_came_back(): void
    {
        $closed = $this->as()->postJson('/api/v1/pos/session/close', [
            'counted_cash' => 9800, 'declared_tenders' => ['card' => 0],
        ])->assertSuccessful()->json('data');

        $this->assertEquals(0, $closed['variance']);
        $this->assertArrayNotHasKey('exchange_credit', $closed['tender_variances'], 'a shortfall of 4,950 in goods nobody could count');
        $this->assertEquals(0, $closed['tender_variances']['card']);
    }

    public function test_a_refund_beside_the_swaps_is_still_a_refund_and_a_cheque_still_other(): void
    {
        $sale = $this->sell('Shirt', 2000);
        $this->as()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]], 'refund_method' => 'cash', 'reason' => 'Wrong size',
        ])->assertSuccessful();
        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->item['Kids Suit'], 'quantity' => 1]],
            'payments' => [['method' => 'other', 'amount' => 1850, 'reference' => 'Cheque 0042']],
        ])->assertCreated();

        $drawer = $this->as()->getJson('/api/v1/pos/session/report')->assertOk()->json('data.drawer');

        $this->assertSame(1, $drawer['refunds']);
        $this->assertSame(2, $drawer['exchanges']);
        $this->assertEquals(1850, $drawer['tender_mix']['other']);
        $this->assertEquals(4950, $drawer['tender_mix']['exchange_credit']);
        $this->assertEquals(1100, $drawer['exchange_cash_back']);
    }

    public function test_exchanges_made_before_are_found_by_their_credit(): void
    {
        DB::table('sales')->update(['exchange_credit' => 0]);
        DB::table('sale_returns')->update(['exchange_credit' => 0]);
        $this->assertSame([9750.0, 4950.0], $this->everyScreen(), 'counted whole on both sides, as before');

        (require database_path('migrations/2026_10_17_000003_an_exchange_is_not_a_refund.php'))->backfill();

        $this->assertSame([5900.0, 1100.0], $this->everyScreen());
        $this->assertEquals([2000, 1850], Sale::withoutTenancy()->where('exchange_credit', '>', 0)->orderBy('exchange_credit', 'desc')->pluck('exchange_credit')->map(fn ($v) => (float) $v)->all());
        $this->assertSame(2, SaleReturn::withoutTenancy()->where('exchange_credit', '>', 0)->count());
    }

    /**
     * Taken and handed back, asked of the dashboard, the report, the cashbook
     * and the ledger — which must all agree.
     *
     * @return array{0: float, 1: float}
     */
    private function everyScreen(): array
    {
        $day = ['from' => '2026-10-17', 'to' => '2026-10-17'];
        $dashboard = $this->as()->getJson('/api/v1/dashboard')->assertOk()->json('data.today');
        $summary = $this->as()->getJson('/api/v1/reports/summary?'.http_build_query($day))->assertOk();
        $report = $summary->json('data.totals');
        $chart = collect($summary->json('data.series'));
        $cashbook = collect($this->as()->getJson('/api/v1/cashbook?'.http_build_query($day))->assertOk()->json('data.days'))
            ->firstWhere('date', '2026-10-17');
        $ledger = $this->as()->getJson('/api/v1/ledger?'.http_build_query(['period' => 'custom'] + $day))->assertOk();
        $rows = collect($ledger->json('data.rows') ?? $ledger->json('data'));

        $answers = [
            'dashboard' => [(float) $dashboard['revenue'], (float) $dashboard['refunds']],
            'report' => [(float) $report['revenue'], (float) $report['refunds']],
            'report chart' => [(float) $chart->sum('revenue'), (float) $chart->sum('refunds')],
            'cashbook' => [(float) $cashbook['sales_revenue'], (float) $cashbook['refunds']],
            'ledger' => [(float) $rows->sum('in'), (float) $rows->sum('out')],
        ];
        $this->assertCount(1, array_unique(array_map('json_encode', $answers)), 'the screens disagree: '.json_encode($answers));

        return $answers['dashboard'];
    }

    private function sell(string $name, float $price): array
    {
        return $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->item[$name], 'quantity' => 1]], 'payment_method' => 'cash', 'amount_paid' => $price,
        ])->assertCreated()->json('data');
    }

    private function exchange(array $sale, string $for, array $payments = []): void
    {
        $this->as()->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $this->item[$for], 'quantity' => 1]],
            'payments' => $payments, 'channel' => 'walk_in',
        ])->assertCreated();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
