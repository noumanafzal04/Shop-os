<?php

namespace Tests\Feature;

use App\Models\BusinessDay;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * ONE NIGHT'S TRADING IS ONE DAY — ON EVERY SCREEN.
 *
 * ── What was wrong ───────────────────────────────────────────────────
 *
 * A shop in Karachi sold at ten at night and again at half past one. Asked
 * "what did we take today?" at quarter to two:
 *
 *   the dashboard      both sales            (its day was UTC's: five to five)
 *   the daily report   both sales            (the same)
 *   the sales list     NEITHER, on "Today"   (the panel asked for the 7th, by
 *                                             the wall; the server's 7th had
 *                                             not begun)
 *   the till           a NEW trading day     (dated the 7th, by the wall) while
 *                                             the 6th's was still open
 *
 * Four screens, three answers, and a second open day that the dashboard
 * then reported as "yesterday was never closed". Nobody chose any of it.
 *
 * ── What this file holds ─────────────────────────────────────────────
 *
 * One night, rung through the real doors with the clock moved for real, and
 * then every screen that says "today" asked the same question. The night's
 * own books are kept by the TEST, so four screens sharing one mistake cannot
 * agree their way past it.
 *
 * Then the same night for a shop that has chosen midnight — the setting has
 * to move ALL of them, or it is a switch with half a rule behind it.
 */
final class OneNightIsOneDayTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $item;

    /** @var array<string, mixed> */
    private array $lastRefund = [];

    private const PRICE = 250.0;

    private const COST = 100.0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    public function test_past_midnight_is_still_tonight_on_every_screen(): void
    {
        // ── The night ───────────────────────────────────────────────
        $this->at('2026-10-06 21:00');
        $this->shelve();
        $this->send('/api/v1/pos/session/open', ['opening_float' => 1000], 201);

        $this->at('2026-10-06 22:00');
        $evening = $this->sell(2);

        $this->at('2026-10-07 01:30');
        $late = $this->sell(3);

        $this->at('2026-10-07 01:40');
        $this->lastRefund = $this->send("/api/v1/sales/{$late['id']}/returns", [
            'items' => [['sale_item_id' => $late['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
            'reason' => 'Wrong one',
        ], 201);

        $rung = (float) $evening['total'] + (float) $late['total'];
        $refunded = (float) $this->lastRefund['refund_total'];

        // ── Quarter to two: what does every screen call today? ───────
        $this->at('2026-10-07 01:45');
        $wrong = [];

        $dash = $this->read('/api/v1/dashboard');
        $this->same($wrong, 'dashboard · today.revenue', $rung, $dash['today']['revenue']);
        $this->same($wrong, 'dashboard · today.sales_count', 2, $dash['today']['sales_count']);
        $last = end($dash['sales_series']);
        $this->same($wrong, 'dashboard · chart ends on', '2026-10-06', $last['date']);
        $this->same($wrong, 'dashboard · chart last revenue', $rung, $last['revenue']);
        $this->same($wrong, 'dashboard · chart last refunds', $refunded, $last['refunds']);
        $this->same($wrong, 'dashboard · till day is open', true, $dash['till']['day_open']);
        $this->same($wrong, 'dashboard · unclosed earlier days', 0, $dash['till']['unclosed_days']);

        $report = $this->as()->getJson('/api/v1/reports/summary?period=daily')->assertOk();
        $this->same($wrong, 'daily report · covers', '2026-10-06', $report->json('data.period.from'));
        $this->same($wrong, 'daily report · revenue', $rung, $report->json('data.totals.revenue'));
        $series = collect($report->json('data.series'));
        $this->same($wrong, 'daily report · one bucket', ['2026-10-06'], $series->pluck('date')->all());
        $this->same($wrong, 'daily report · bucket revenue', $rung, $series->first()['revenue'] ?? null);

        $book = collect($this->read('/api/v1/cashbook?period=custom&from=2026-10-06&to=2026-10-07')['days'])->keyBy('date');
        $this->same($wrong, 'cashbook · the 6th sales', $rung, $book['2026-10-06']['sales_revenue'] ?? null);
        $this->same($wrong, 'cashbook · the 6th refunds', $refunded, $book['2026-10-06']['refunds'] ?? null);
        $this->same($wrong, 'cashbook · the 7th sales', 0.0, $book['2026-10-07']['sales_revenue'] ?? null);

        $ledger = $this->as()->getJson('/api/v1/ledger?period=custom&from=2026-10-06&to=2026-10-06')->assertOk();
        $rows = collect($ledger->json('data.rows') ?? $ledger->json('data'));
        $this->same($wrong, 'ledger · rows on the 6th', ['refund' => 1, 'sale' => 2], $rows->countBy('type')->sortKeys()->all());
        $this->same($wrong, 'ledger · every row dated', ['2026-10-06'], $rows->pluck('date')->unique()->values()->all());
        $none = $this->as()->getJson('/api/v1/ledger?period=custom&from=2026-10-07&to=2026-10-07')->assertOk();
        $this->same($wrong, 'ledger · rows on the 7th', 0, count($none->json('data.rows') ?? $none->json('data')));

        $this->same($wrong, 'sales list · the 6th', 2, $this->listed('/api/v1/sales?from=2026-10-06&to=2026-10-06'));
        $this->same($wrong, 'sales list · the 7th', 0, $this->listed('/api/v1/sales?from=2026-10-07&to=2026-10-07'));

        // No dates given is "today" — and today is the night that is not over.
        $this->same($wrong, 'shift history · today', 1, count($this->read('/api/v1/pos/sessions')['sessions']));
        $this->same($wrong, 'shift history · the 7th', 0, count($this->read('/api/v1/pos/sessions?from=2026-10-07&to=2026-10-07')['sessions']));

        // The till agrees about whose day it is — ONE day, dated the 6th.
        $days = BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->get();
        $this->same($wrong, 'till · days in existence', ['2026-10-06'], $days->map(fn ($d) => $d->trading_date->toDateString())->all());

        // A second cashier coming on at ten to two joins that day, not a new one.
        $second = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $token = $second->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->defaultHeaders = [];
        $this->withToken($token)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])->assertCreated();
        $this->same(
            $wrong,
            'till · days after a second shift',
            ['2026-10-06'],
            BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->get()
                ->map(fn ($d) => $d->trading_date->toDateString())->all(),
        );

        $this->assertSame([], $wrong, "Screens that disagree about tonight:\n  ".implode("\n  ", $wrong));

        // ── Five o'clock: the day turns, once, for all of them ───────
        $this->at('2026-10-07 05:00');
        $wrong = [];

        $dash = $this->read('/api/v1/dashboard');
        $this->same($wrong, 'after five · dashboard today', 0.0, $dash['today']['revenue']);
        $last = end($dash['sales_series']);
        $this->same($wrong, 'after five · chart ends on', '2026-10-07', $last['date']);
        $this->same($wrong, 'after five · unclosed earlier days', 1, $dash['till']['unclosed_days']);
        $this->same($wrong, 'after five · the unclosed day', '2026-10-06', $dash['till']['unclosed_day']);

        $report = $this->as()->getJson('/api/v1/reports/summary?period=daily')->assertOk();
        $this->same($wrong, 'after five · daily report covers', '2026-10-07', $report->json('data.period.from'));

        $this->assertSame([], $wrong, "Screens that did not turn at five:\n  ".implode("\n  ", $wrong));
    }

    public function test_a_shop_that_chose_midnight_gets_midnight_everywhere(): void
    {
        $this->at('2026-10-06 21:00');
        $this->send('/api/v1/shop/settings', ['day_turns_at' => 0], 200, 'put');
        $this->shelve();
        $this->send('/api/v1/pos/session/open', ['opening_float' => 1000], 201);

        $this->at('2026-10-06 22:00');
        $evening = $this->sell(2);                      // the 6th
        $this->at('2026-10-07 01:30');
        $late = $this->sell(3);                         // the 7th
        $this->at('2026-10-07 01:40');
        $refund = $this->send("/api/v1/sales/{$late['id']}/returns", [
            'items' => [['sale_item_id' => $late['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
            'reason' => 'Wrong one',
        ], 201);                                        // the 7th

        // A second cashier comes on at eighteen minutes to two. By this
        // shop's midnight that is the 7th — a new shift AND a new trading
        // day, both of which the server's own clock would file under the 6th.
        $this->at('2026-10-07 01:42');
        $second = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $token = $second->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->defaultHeaders = [];
        $this->withToken($token)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])->assertCreated();

        // The night's own books. Every figure below is the till's own answer
        // at the moment of the sale, so nothing here is worked out by the
        // code being asked.
        $sixth = (float) $evening['total'];
        $seventh = (float) $late['total'];
        $back = (float) $refund['refund_total'];
        $this->assertGreaterThan(0, (float) $late['tax'], 'The item must carry tax, or the tax bucket has nothing to misfile.');
        $profitSixth = $sixth - (float) $evening['tax'] - 2 * self::COST;
        $profitSeventh = $seventh - $back - ((float) $late['tax'] - (float) $refund['refund_tax']) - 3 * self::COST;

        $this->at('2026-10-07 01:45');
        $wrong = [];

        $dash = $this->read('/api/v1/dashboard');
        $this->same($wrong, 'dashboard · today.revenue', $seventh, $dash['today']['revenue']);
        $this->same($wrong, 'dashboard · today.profit', $profitSeventh, $dash['today']['profit']);
        $series = collect($dash['sales_series'])->keyBy('date');
        $this->same($wrong, 'dashboard · chart ends on', '2026-10-07', collect($dash['sales_series'])->last()['date']);
        $this->same($wrong, 'dashboard · the 6th on the chart', $sixth, $series['2026-10-06']['revenue'] ?? null);
        $this->same($wrong, 'dashboard · the 7th on the chart', $seventh, $series['2026-10-07']['revenue'] ?? null);
        $this->same($wrong, 'dashboard · refunds on the 6th', 0.0, $series['2026-10-06']['refunds'] ?? null);
        $this->same($wrong, 'dashboard · refunds on the 7th', $back, $series['2026-10-07']['refunds'] ?? null);
        $this->same($wrong, 'dashboard · profit on the 6th', $profitSixth, $series['2026-10-06']['profit'] ?? null);
        $this->same($wrong, 'dashboard · profit on the 7th', $profitSeventh, $series['2026-10-07']['profit'] ?? null);

        $report = $this->as()->getJson('/api/v1/reports/summary?period=daily')->assertOk();
        $this->same($wrong, 'daily report · covers', '2026-10-07', $report->json('data.period.from'));
        $this->same($wrong, 'daily report · bucket', $seventh, $report->json('data.series.0.revenue'));
        $this->same($wrong, 'daily report · sales counted', 1, $report->json('data.totals.sales_count'));

        $book = collect($this->read('/api/v1/cashbook?period=custom&from=2026-10-06&to=2026-10-07')['days'])->keyBy('date');
        $this->same($wrong, 'cashbook · the 6th', $sixth, $book['2026-10-06']['sales_revenue'] ?? null);
        $this->same($wrong, 'cashbook · the 7th', $seventh, $book['2026-10-07']['sales_revenue'] ?? null);
        $this->same($wrong, 'cashbook · refunds on the 6th', 0.0, $book['2026-10-06']['refunds'] ?? null);
        $this->same($wrong, 'cashbook · refunds on the 7th', $back, $book['2026-10-07']['refunds'] ?? null);

        // Yesterday's cashbook OPENS today's: what moved before the 7th began
        // is the 6th's sale and nothing else.
        $opening = $this->read('/api/v1/cashbook?period=custom&from=2026-10-07&to=2026-10-07')['opening_balance'] ?? null;
        $this->same($wrong, 'cashbook · the 7th opens with', $sixth, $opening);

        foreach (['2026-10-06' => ['sale' => 1], '2026-10-07' => ['refund' => 1, 'sale' => 1]] as $date => $expected) {
            $ledger = $this->as()->getJson("/api/v1/ledger?period=custom&from={$date}&to={$date}")->assertOk();
            $rows = collect($ledger->json('data.rows') ?? $ledger->json('data'));
            $this->same($wrong, "ledger · rows on {$date}", $expected, $rows->countBy('type')->sortKeys()->all());
            $this->same($wrong, "ledger · dated {$date}", [$date], $rows->pluck('date')->unique()->values()->all());
            $this->same($wrong, "sales list · {$date}", 1, $this->listed("/api/v1/sales?from={$date}&to={$date}"));
            $this->same($wrong, "tax report · {$date}", 1, $this->read("/api/v1/reports/tax?period=custom&from={$date}&to={$date}")['totals']['taxable_sales'] ?? null);
            // Two sold on the 6th; three sold and one handed back on the 7th.
            $this->same($wrong, "margins · {$date}", 2.0, $this->unitsKept($date));
        }

        // One shift each side of this shop's midnight.
        $this->same($wrong, 'shift history · the 6th', 1, count($this->read('/api/v1/pos/sessions?from=2026-10-06&to=2026-10-06')['sessions']));
        $this->same($wrong, 'shift history · the 7th', 1, count($this->read('/api/v1/pos/sessions?from=2026-10-07&to=2026-10-07')['sessions']));
        $this->same($wrong, 'shift history · today', 1, count($this->read('/api/v1/pos/sessions')['sessions']));

        // And a trading day each: the till turned when the reports did.
        $this->same(
            $wrong,
            'till · days in existence',
            ['2026-10-06', '2026-10-07'],
            BusinessDay::withoutTenancy()->where('tenant_id', $this->shop->id)->orderBy('trading_date')->get()
                ->map(fn ($d) => $d->trading_date->toDateString())->all(),
        );

        // Who did what, by the same day: trading was opened once on each.
        $this->same($wrong, 'activity · day opened on the 6th', 1, $this->dayOpenings('2026-10-06'));
        $this->same($wrong, 'activity · day opened on the 7th', 1, $this->dayOpenings('2026-10-07'));

        // The settings screen is told the rule it just set, and what day it is.
        $settings = $this->read('/api/v1/shop/settings');
        $this->same($wrong, 'settings · the rule', [
            'zone' => 'Asia/Karachi', 'turns_at_minutes' => 0, 'chosen_hour' => 0, 'today' => '2026-10-07',
        ], $settings['shop_day']);

        $this->assertSame([], $wrong, "Screens that did not move to midnight:\n  ".implode("\n  ", $wrong));
    }

    public function test_the_hour_a_day_turns_is_an_hour_of_the_small_hours_or_nothing(): void
    {
        foreach ([9, 23, -1, 'noon'] as $bad) {
            $this->as()->putJson('/api/v1/shop/settings', ['day_turns_at' => $bad])
                ->assertStatus(422)->assertJsonStructure(['errors' => ['day_turns_at']]);
        }

        // And it can be handed back: null is "where it has always turned".
        $this->as()->putJson('/api/v1/shop/settings', ['day_turns_at' => 2])->assertOk()
            ->assertJsonPath('data.shop_day.turns_at_minutes', 120);
        $this->as()->putJson('/api/v1/shop/settings', ['day_turns_at' => null])->assertOk()
            ->assertJsonPath('data.shop_day.turns_at_minutes', 300)
            ->assertJsonPath('data.shop_day.chosen_hour', null);
    }

    // ── Plumbing ────────────────────────────────────────────────────

    /** Move the clock to a moment on the shop's own wall. */
    private function at(string $wall): void
    {
        $this->travelTo(Carbon::parse($wall, 'Asia/Karachi'));
    }

    private function shelve(): void
    {
        $id = $this->send('/api/v1/products', [
            'name' => 'Night Item',
            'type' => 'product',
            'item_type' => 'physical_product',
            'price' => self::PRICE,
            'cost' => self::COST,
            'tax_rate' => 10,
            'track_inventory' => true,
        ], 201)['id'];

        $this->item = Product::withoutTenancy()->findOrFail($id);

        $this->send('/api/v1/inventory/adjust', [
            'product_id' => $id, 'type' => 'set', 'new_quantity' => 50, 'reason' => 'opening stock',
        ], 201);
    }

    /** @return array<string, mixed> */
    private function sell(int $qty): array
    {
        return $this->send('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->item->id, 'quantity' => $qty]],
            'payment_method' => 'cash',
            // Enough for the tax as well; the till gives change.
            'amount_paid' => $qty * self::PRICE * 2,
        ], 201);
    }

    /** Units of the night's item the margins report says were kept, for one day. */
    private function unitsKept(string $date): ?float
    {
        $rows = $this->read("/api/v1/reports/margins?period=custom&from={$date}&to={$date}")['best'];

        return isset($rows[0]) ? (float) $rows[0]['units'] : 0.0;
    }

    /** How many times the activity trail says a trading day was opened on a date. */
    private function dayOpenings(string $date): int
    {
        return collect($this->as()->getJson("/api/v1/audit-logs?from={$date}&to={$date}&per_page=100")->assertOk()->json('data'))
            ->filter(fn (array $row): bool => $row['event'] === 'created' && $row['entity'] === 'BusinessDay')
            ->count();
    }

    private function listed(string $url): int
    {
        return count($this->as()->getJson($url)->assertOk()->json('data'));
    }

    /** @param  array<int, string>  $wrong */
    private function same(array &$wrong, string $what, mixed $expected, mixed $actual): void
    {
        $norm = static fn (mixed $v): mixed => is_int($v) || is_float($v) || (is_string($v) && is_numeric($v)) ? round((float) $v, 2) : $v;

        if ($norm($expected) != $norm($actual) || gettype($norm($expected)) !== gettype($norm($actual))) {
            $wrong[] = "{$what}: expected ".json_encode($expected).', was '.json_encode($actual);
        }
    }

    private function as(): static
    {
        // A token lives an hour, and this night is longer than that.
        $this->defaultHeaders = [];
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function send(string $url, array $payload, int $expect, string $verb = 'post'): array
    {
        $res = $verb === 'put' ? $this->as()->putJson($url, $payload) : $this->as()->postJson($url, $payload);
        $this->assertSame(
            $expect,
            $res->status(),
            strtoupper($verb)." {$url} answered {$res->status()}: ".json_encode($res->json('errors') ?? $res->json()),
        );

        return $res->json('data') ?? [];
    }

    /** @return array<string, mixed> */
    private function read(string $url): array
    {
        $res = $this->as()->getJson($url);
        $this->assertSame(200, $res->status(), "GET {$url} answered {$res->status()}: ".$res->content());

        return $res->json('data') ?? [];
    }
}
