<?php

namespace Tests\Feature;

use App\Models\CommissionCharge;
use App\Models\CommissionInvoice;
use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PlatformSettings;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * WHO OWES THE PLATFORM, AND HOW MUCH — the list a person opens to chase money.
 *
 * What a shop owes is two piles: commission NOT YET BILLED (earned, and nobody
 * has asked for it) and commission BILLED AND UNPAID (asked for, and waiting).
 * The list showed the first as money and the second as a count of invoices —
 * so a shop holding forty thousand of unpaid invoices and nothing new read as
 * owing nothing, and sat at the bottom of the screen.
 *
 * It also loaded every shop on the platform and asked two questions of each.
 *
 * Held in place here:
 *
 *   both piles are money, on the row and above the list
 *   the order is by what is owed in all, largest first
 *   it can be narrowed — by standing, by whose rate, by name — and the figure
 *     on a filter does not move when that filter is pressed
 *   it comes a page at a time, in a number of queries that does not grow
 *   and a demo owes nobody anything
 */
final class WhoOwesThePlatformTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private User $buyer;

    private Tenant $alpha;

    private Tenant $bravo;

    private Tenant $charlie;

    private Tenant $delta;

    private int $orders = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        // The 20th: a month with a "this month" and a "last month" well apart.
        $this->travelTo(Carbon::parse('2026-10-20 12:00:00'));

        $this->admin = User::factory()->superAdmin()->create();
        $this->buyer = User::factory()->create();
        PlatformSettings::put(['commission_enabled' => true, 'commission_rate' => 10, 'commission_base' => 'goods'], $this->admin->id);

        // Alpha: earned and not asked for. One charge was written off.
        $this->alpha = Tenant::factory()->create(['business_name' => 'Alpha Mart']);
        $this->charge($this->alpha, 300);
        $this->charge($this->alpha, 200);
        $this->charge($this->alpha, 80, waived: true);

        // Bravo: asked, and waiting. Plus one paid this month, one paid last
        // month and one withdrawn — none of which it still owes.
        $this->bravo = Tenant::factory()->create(['business_name' => 'Bravo Foods']);
        $this->invoice($this->bravo, 900, 'unpaid');
        $this->invoice($this->bravo, 400, 'paid', paidAt: '2026-10-05 10:00:00');
        $this->invoice($this->bravo, 700, 'paid', paidAt: '2026-09-28 10:00:00');
        $this->invoice($this->bravo, 999, 'void');

        // Charlie: some of each, on a rate of its own.
        $this->charlie = Tenant::factory()->create(['business_name' => 'Charlie Pharmacy', 'commission_rate' => 7.5]);
        $this->charge($this->charlie, 150);
        $this->invoice($this->charlie, 100, 'unpaid');

        // Delta: owes nothing, and has been promised it never will.
        $this->delta = Tenant::factory()->create(['business_name' => 'Delta Books', 'commission_rate' => 0]);

        // A demo with five thousand "outstanding" is not a business.
        $demo = Tenant::factory()->create(['business_name' => 'Echo Demo', 'is_demo' => true, 'demo_expires_at' => now()->addDay()]);
        $this->charge($demo, 5000);
    }

    public function test_both_piles_are_money_and_the_most_owed_is_first(): void
    {
        $res = $this->list();
        $rows = collect($res['data'])->keyBy('business_name');

        // Bravo owes the most — all of it already billed. It used to be last.
        $this->assertSame(['Bravo Foods', 'Alpha Mart', 'Charlie Pharmacy', 'Delta Books'], array_column($res['data'], 'business_name'));

        $this->assertSame(2, $rows['Alpha Mart']['outstanding_orders']);
        $this->assertEquals(500, $rows['Alpha Mart']['outstanding_amount']);
        $this->assertSame(0, $rows['Alpha Mart']['unpaid_invoices']);
        $this->assertEquals(500, $rows['Alpha Mart']['owed']);

        $this->assertSame(0, $rows['Bravo Foods']['outstanding_orders']);
        $this->assertSame(1, $rows['Bravo Foods']['unpaid_invoices']);
        $this->assertEquals(900, $rows['Bravo Foods']['unpaid_amount']);
        $this->assertEquals(900, $rows['Bravo Foods']['owed']);

        $this->assertEquals(150, $rows['Charlie Pharmacy']['outstanding_amount']);
        $this->assertEquals(100, $rows['Charlie Pharmacy']['unpaid_amount']);
        $this->assertEquals(250, $rows['Charlie Pharmacy']['owed']);

        $this->assertEquals(0, $rows['Delta Books']['owed']);
    }

    public function test_a_row_says_whose_rate_it_is_on(): void
    {
        $rows = collect($this->list()['data'])->keyBy('business_name');

        // Null is "follows the platform" — not the same as the number it resolves to.
        $this->assertNull($rows['Alpha Mart']['commission_rate']);
        $this->assertEquals(10, $rows['Alpha Mart']['effective_rate']);
        $this->assertEquals(7.5, $rows['Charlie Pharmacy']['commission_rate']);
        $this->assertEquals(7.5, $rows['Charlie Pharmacy']['effective_rate']);
        // Zero is a rate of its own: a promise, not an absence.
        $this->assertSame(0.0, (float) $rows['Delta Books']['commission_rate']);
        $this->assertNotNull($rows['Delta Books']['commission_rate']);
    }

    public function test_the_figures_above_the_list_are_counted_by_the_server(): void
    {
        $this->assertEquals([
            'shops' => 4,
            'unbilled' => ['shops' => 2, 'orders' => 3, 'amount' => 650],
            'invoiced' => ['shops' => 2, 'invoices' => 2, 'amount' => 1000],
            'clear' => ['shops' => 1],
            'rates' => ['own' => 2, 'platform' => 2],
            // Paid in October. September's is September's.
            'collected_this_month' => ['invoices' => 1, 'amount' => 400],
        ], $this->list()['meta']['summary']);
    }

    public function test_it_narrows_by_standing_and_the_figure_on_the_filter_holds_still(): void
    {
        $whole = $this->list()['meta']['summary'];

        $unbilled = $this->list('standing=unbilled');
        $this->assertSame(['Alpha Mart', 'Charlie Pharmacy'], array_column($unbilled['data'], 'business_name'));
        // Pressing "Not yet billed" must not change the number on the button.
        foreach (['shops', 'unbilled', 'invoiced', 'clear'] as $key) {
            $this->assertEquals($whole[$key], $unbilled['meta']['summary'][$key], "{$key} moved when its own filter was pressed");
        }
        // …but the OTHER filter's counts are of what is now on the list.
        $this->assertEquals(['own' => 1, 'platform' => 1], $unbilled['meta']['summary']['rates']);

        $this->assertSame(['Bravo Foods', 'Charlie Pharmacy'], array_column($this->list('standing=invoiced')['data'], 'business_name'));
        $this->assertSame(['Delta Books'], array_column($this->list('standing=clear')['data'], 'business_name'));
    }

    public function test_it_narrows_by_whose_rate_and_by_name(): void
    {
        $own = $this->list('rate=own');
        $this->assertSame(['Charlie Pharmacy', 'Delta Books'], array_column($own['data'], 'business_name'));
        // The money above is of the shops asked about…
        $this->assertEquals(['shops' => 1, 'orders' => 1, 'amount' => 150], $own['meta']['summary']['unbilled']);
        $this->assertEquals(['shops' => 1, 'invoices' => 1, 'amount' => 100], $own['meta']['summary']['invoiced']);
        // …and its own count does not move.
        $this->assertEquals(['own' => 2, 'platform' => 2], $own['meta']['summary']['rates']);

        $this->assertSame(['Alpha Mart', 'Bravo Foods'], array_column($this->list('rate=platform&sort=name')['data'], 'business_name'));

        $named = $this->list('search=rav');
        $this->assertSame(['Bravo Foods'], array_column($named['data'], 'business_name'));
        $this->assertSame(1, $named['meta']['summary']['shops']);
        $this->assertEquals(900, $named['meta']['summary']['invoiced']['amount']);

        // Together.
        $this->assertSame(['Charlie Pharmacy'], array_column($this->list('rate=own&standing=unbilled')['data'], 'business_name'));
    }

    public function test_it_can_be_put_in_another_order(): void
    {
        $names = fn (string $sort): array => array_column($this->list("sort={$sort}")['data'], 'business_name');

        $this->assertSame(['Alpha Mart', 'Bravo Foods', 'Charlie Pharmacy', 'Delta Books'], $names('name'));
        // By one pile alone; the ones with none of it follow by name.
        $this->assertSame(['Alpha Mart', 'Charlie Pharmacy', 'Bravo Foods', 'Delta Books'], $names('unbilled'));
        $this->assertSame(['Bravo Foods', 'Charlie Pharmacy', 'Alpha Mart', 'Delta Books'], $names('invoiced'));
    }

    public function test_a_filter_nobody_offers_is_refused(): void
    {
        foreach (['standing=overdue', 'rate=custom', 'sort=newest'] as $query) {
            $this->as()->getJson("/api/v1/admin/commission?{$query}")->assertStatus(422);
        }
    }

    public function test_it_comes_a_page_at_a_time_with_the_ones_that_owe_on_the_first(): void
    {
        for ($i = 1; $i <= 30; $i++) {
            Tenant::factory()->create(['business_name' => sprintf('Quiet Shop %02d', $i)]);
        }

        $first = $this->list();
        $this->assertCount(25, $first['data']);
        $this->assertSame(34, $first['meta']['pagination']['total']);
        $this->assertSame(2, $first['meta']['pagination']['last_page']);
        $this->assertSame(['Bravo Foods', 'Alpha Mart', 'Charlie Pharmacy'], array_slice(array_column($first['data'], 'business_name'), 0, 3));

        $second = $this->list('page=2');
        $this->assertCount(9, $second['data']);
        // Nobody twice, nobody missing.
        $everyone = array_merge(array_column($first['data'], 'id'), array_column($second['data'], 'id'));
        $this->assertCount(34, array_unique($everyone));
        // The figures are of the whole platform, not of the page.
        $this->assertSame(34, $second['meta']['summary']['shops']);
        $this->assertEquals(650, $second['meta']['summary']['unbilled']['amount']);
    }

    public function test_a_bigger_platform_is_not_more_queries(): void
    {
        $count = function (): int {
            $token = $this->admin->createToken('t', ['access'])->plainTextToken;
            $this->app['auth']->forgetGuards();
            $queries = 0;
            DB::listen(function () use (&$queries): void {
                $queries++;
            });
            $this->withToken($token)->getJson('/api/v1/admin/commission')->assertOk();
            DB::getEventDispatcher()->forget(QueryExecuted::class);

            return $queries;
        };

        // Once first, uncounted: the platform's settings are read from the
        // database the first time and from the cache after.
        $count();

        $small = $count();
        for ($i = 1; $i <= 20; $i++) {
            $shop = Tenant::factory()->create(['business_name' => sprintf('Busy Shop %02d', $i)]);
            $this->charge($shop, 10 * $i);
            $this->invoice($shop, 5 * $i, 'unpaid');
        }
        $big = $count();

        // It asked two questions of every shop: forty more here.
        $this->assertSame($small, $big, "{$small} queries for four shops, {$big} for twenty-four");
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function as(): static
    {
        $this->defaultHeaders = [];
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array{data: array<int, array<string, mixed>>, meta: array<string, mixed>} */
    private function list(string $query = ''): array
    {
        $res = $this->as()->getJson('/api/v1/admin/commission'.($query === '' ? '' : "?{$query}"));
        $this->assertSame(200, $res->status(), "GET /admin/commission?{$query} answered {$res->status()}: ".$res->content());

        return ['data' => $res->json('data'), 'meta' => $res->json('meta')];
    }

    /** One completed online order's worth of commission. */
    private function charge(Tenant $shop, float $amount, bool $waived = false, ?CommissionInvoice $on = null): CommissionCharge
    {
        $order = Order::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'customer_id' => $this->buyer->id,
            'order_number' => sprintf('ORD-%06d', ++$this->orders),
            'status' => 'completed',
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'customer_name' => $this->buyer->name,
            'subtotal' => $amount * 10,
            'total' => $amount * 10,
            'placed_at' => now()->subDay(),
        ]);

        return CommissionCharge::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'order_id' => $order->id,
            'rate_percent' => 10,
            'base_amount' => $amount * 10,
            'amount' => $amount,
            'invoice_id' => $on?->id,
            'waived_at' => $waived ? now() : null,
            'waive_reason' => $waived ? 'Refunded in cash' : null,
        ]);
    }

    /** A bill, with the charge it bundled — which is therefore no longer outstanding. */
    private function invoice(Tenant $shop, float $amount, string $status, ?string $paidAt = null): CommissionInvoice
    {
        $invoice = CommissionInvoice::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'number' => sprintf('COM-%05d', CommissionInvoice::withoutTenancy()->where('tenant_id', $shop->id)->count() + 1),
            'period_start' => '2026-09-01',
            'period_end' => '2026-09-30',
            'orders_count' => 1,
            'base_total' => $amount * 10,
            'amount' => $amount,
            'status' => $status,
            'paid_at' => $paidAt,
        ]);

        // A withdrawn invoice hands its charges back; any other holds them.
        if ($status !== 'void') {
            $this->charge($shop, $amount, on: $invoice);
        }

        return $invoice;
    }
}
