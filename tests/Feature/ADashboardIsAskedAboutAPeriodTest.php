<?php

namespace Tests\Feature;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Enums\SaleStatus;
use App\Models\Branch;
use App\Models\Customer;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A SHOP'S DASHBOARD, ASKED ABOUT A PERIOD.
 *
 * It answered one question — today — and could not be asked another. It is
 * asked about two dates now, and the things that can go wrong with that are
 * all quiet ones:
 *
 *   a day added twice, or left out, at either end of the period
 *   a sale at one in the morning filed under the wrong side of a month
 *   a customer who came three times in a week counted as three customers
 *   the comparison set against days that are not its like
 *   a chart whose points do not add up to the tile above it
 *   "today" at the head of the screen going blank because last month was asked
 *   and the phone app — which asks nothing — being answered differently
 *
 * One shop, one fortnight of trade either side of a month end, and each of
 * those asked in turn.
 */
final class ADashboardIsAskedAboutAPeriodTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Customer $ayesha;

    private Customer $bilal;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        // Friday 9 October 2026, three in the afternoon on the shop's wall.
        $this->travelTo(Carbon::parse('2026-10-09 15:00', 'Asia/Karachi'));

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->ayesha = $this->customer('Ayesha', '03001111111');
        $this->bilal = $this->customer('Bilal', '03002222222');

        // ── October ─────────────────────────────────────────────────
        $this->sale('2026-10-09 11:00', 1200, $this->ayesha);                 // today
        $this->sale('2026-10-08 12:00', 400);                                 // yesterday, a walk-in
        $this->sale('2026-10-08 18:00', 600, $this->ayesha);                  // yesterday
        $this->sale('2026-10-05 10:00', 2000, $this->bilal, tax: 100);
        $this->sale('2026-10-01 10:00', 500, $this->ayesha);
        // Half past one on the morning of the 1st is still the night of the
        // 30th: this shop's day turns at five. It belongs to SEPTEMBER.
        $this->sale('2026-10-01 01:30', 250);

        // ── September ───────────────────────────────────────────────
        $this->sale('2026-09-30 20:00', 300);
        $this->sale('2026-09-20 10:00', 5000);
        $this->sale('2026-09-08 10:00', 800, $this->bilal);

        $rent = $this->category('Rent');
        $tea = $this->category('Tea');
        $this->expense('2026-10-09', 100, $rent);
        $this->expense('2026-10-08', 50, $tea);
        $this->expense('2026-10-03', 200, $rent);
        $this->expense('2026-09-25', 900, $rent);
        $this->expense('2026-09-05', 400, $tea);
    }

    public function test_asked_nothing_it_is_the_view_it_has_always_been(): void
    {
        $dash = $this->dashboard();

        // The period is today, set against yesterday — and says nobody chose it.
        $this->assertSame('2026-10-09', $dash['period']['from']);
        $this->assertSame('2026-10-09', $dash['period']['to']);
        $this->assertSame('2026-10-08', $dash['period']['compared_from']);
        $this->assertFalse($dash['period']['asked']);

        // `period` and `today` are one and the same figures.
        foreach (['sales_count', 'revenue', 'other_income', 'refunds', 'expenses', 'profit', 'customers_count', 'deltas'] as $key) {
            $this->assertEquals($dash['today'][$key], $dash['period'][$key], "period.{$key} is not today's");
        }
        $this->assertEquals(1200, $dash['today']['revenue']);
        $this->assertEquals(20.0, $dash['today']['deltas']['revenue']);     // 1,200 against yesterday's 1,000

        // Seven days ending today, a weekday name each — what the phone app draws.
        $this->assertCount(7, $dash['sales_series']);
        $this->assertSame(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'], array_column($dash['sales_series'], 'day'));
        $this->assertSame('2026-10-09', end($dash['sales_series'])['date']);

        // And the two panels that were never about today stay about the MONTH.
        $this->assertEquals(
            [['category' => 'Rent', 'total' => 300.0], ['category' => 'Tea', 'total' => 50.0]],
            $dash['expense_breakdown'],
        );
        // Ayesha: 1,200 + 600 + 500 this month, against Bilal's one 2,000.
        $this->assertSame('Ayesha', $dash['highlights']['top_customer']['name']);
        $this->assertEquals(2300, $dash['highlights']['top_customer']['revenue']);
    }

    public function test_yesterday_is_yesterday_on_everything_that_is_a_flow(): void
    {
        $dash = $this->dashboard('from=2026-10-08&to=2026-10-08');

        $this->assertTrue($dash['period']['asked']);
        $this->assertSame(1, $dash['period']['days']);
        $this->assertEquals(1000, $dash['period']['revenue']);
        $this->assertSame(2, $dash['period']['sales_count']);
        $this->assertSame(2, $dash['period']['customers_count']);
        $this->assertEquals(50, $dash['period']['expenses']);
        $this->assertEquals(950, $dash['period']['profit']);
        // Nothing was sold on the 7th: no honest percentage against nothing.
        $this->assertSame('2026-10-07', $dash['period']['compared_from']);
        $this->assertNull($dash['period']['deltas']['revenue']);

        // One day is not a trend: it is drawn as the last of the seven before it.
        $this->assertCount(7, $dash['sales_series']);
        $this->assertSame('2026-10-02', $dash['sales_series'][0]['date']);
        $this->assertSame('2026-10-08', $dash['sales_series'][6]['date']);
        $this->assertEquals(1000, $dash['sales_series'][6]['revenue']);

        // The spending and the leaders are that day's — not the month's.
        $this->assertEquals([['category' => 'Tea', 'total' => 50.0]], $dash['expense_breakdown']);
        $this->assertSame('Ayesha', $dash['highlights']['top_customer']['name']);
        $this->assertEquals(600, $dash['highlights']['top_customer']['revenue']);

        // TODAY IS STILL TODAY at the head of the screen.
        $this->assertEquals(1200, $dash['today']['revenue']);
        $this->assertSame(1, $dash['today']['sales_count']);
    }

    public function test_a_month_so_far_is_set_against_the_same_days_of_the_month_before(): void
    {
        $dash = $this->dashboard('from=2026-10-01&to=2026-10-09');
        $period = $dash['period'];

        $this->assertSame(9, $period['days']);
        // The 01:30 sale of the 1st is NOT here — it was the night of the 30th.
        $this->assertEquals(4700, $period['revenue']);
        $this->assertSame(5, $period['sales_count']);
        // Ayesha came three times and is one customer; a walk-in; Bilal. Adding
        // the days up would say five.
        $this->assertSame(3, $period['customers_count']);
        $this->assertEquals(350, $period['expenses']);
        // 4,700 − the 100 of sales tax held for the government − 350 spent.
        $this->assertEquals(4250, $period['profit']);

        // 1–9 September: Bilal's 800 and 400 of tea. NOT the nine days before
        // the 1st, which would be 5,550 and read as a collapse.
        $this->assertSame(['2026-09-01', '2026-09-09'], [$period['compared_from'], $period['compared_to']]);
        $this->assertEquals(487.5, $period['deltas']['revenue']);     // 4,700 against 800
        $this->assertEquals(-12.5, $period['deltas']['expenses']);    // 350 against 400
        $this->assertEquals(962.5, $period['deltas']['profit']);      // 4,250 against 400

        // A point a day, named by its date — and the points ARE the tile.
        $series = $dash['sales_series'];
        $this->assertSame('day', $period['series']['bucket']);
        $this->assertCount(9, $series);
        $this->assertSame('1 Oct', $series[0]['day']);
        $this->assertEquals(500, $series[0]['revenue']);
        $this->assertEquals($period['revenue'], array_sum(array_column($series, 'revenue')));
        $this->assertEquals($period['expenses'], array_sum(array_column($series, 'expenses')));
        $this->assertEquals($period['profit'], array_sum(array_column($series, 'profit')));

        $this->assertEquals(
            [['category' => 'Rent', 'total' => 300.0], ['category' => 'Tea', 'total' => 50.0]],
            $dash['expense_breakdown'],
        );
    }

    public function test_last_month_ends_on_its_last_night_and_takes_nothing_from_this_one(): void
    {
        $dash = $this->dashboard('from=2026-09-01&to=2026-09-30');
        $period = $dash['period'];

        // 800 + 5,000 + 300 + the 250 rung at 01:30 on the 1st.
        $this->assertEquals(6350, $period['revenue']);
        $this->assertSame(4, $period['sales_count']);
        $this->assertEquals(1300, $period['expenses']);
        // A whole month against the whole month before it — August, empty.
        $this->assertSame(['2026-08-01', '2026-08-31'], [$period['compared_from'], $period['compared_to']]);
        $this->assertNull($period['deltas']['revenue']);

        $series = $dash['sales_series'];
        $this->assertCount(30, $series);
        $this->assertSame('30 Sep', $series[29]['day']);
        $this->assertEquals(550, $series[29]['revenue']);
        $this->assertEquals(6350, array_sum(array_column($series, 'revenue')));

        // Rent first: 900 against 400 of tea. Nothing of October's.
        $this->assertEquals(
            [['category' => 'Rent', 'total' => 900.0], ['category' => 'Tea', 'total' => 400.0]],
            $dash['expense_breakdown'],
        );
        // The biggest single sale was a walk-in; of the customers with a name
        // it is Bilal — and Ayesha, who leads October, is nowhere in September.
        $this->assertSame('Bilal', $dash['highlights']['top_customer']['name']);

        // The head of the screen is still about now, and still compares with
        // yesterday — which the period asked about does not reach.
        $this->assertEquals(1200, $dash['today']['revenue']);
        $this->assertEquals(20.0, $dash['today']['deltas']['revenue']);
        $this->assertSame('2026-10-09', $period['today']);
    }

    public function test_a_quarter_is_drawn_a_week_at_a_time_and_a_year_a_month_at_a_time(): void
    {
        $quarter = $this->dashboard('from=2026-07-01&to=2026-09-30');
        $this->assertSame('week', $quarter['period']['series']['bucket']);
        $this->assertCount(14, $quarter['sales_series']);
        $this->assertSame('1 Jul', $quarter['sales_series'][0]['day']);
        $this->assertSame('2026-07-07', $quarter['sales_series'][0]['to']);
        $this->assertEquals(6350, array_sum(array_column($quarter['sales_series'], 'revenue')));
        $this->assertEquals(6350, $quarter['period']['revenue']);

        $year = $this->dashboard('from=2026-01-01&to=2026-10-09');
        $this->assertSame('month', $year['period']['series']['bucket']);
        $this->assertSame(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'], array_column($year['sales_series'], 'day'));
        $this->assertEquals(6350, $year['sales_series'][8]['revenue']);
        $this->assertEquals(4700, $year['sales_series'][9]['revenue']);
        $this->assertEquals(11050, $year['period']['revenue']);
        // A year so far against the same days a year back.
        $this->assertSame(['2025-01-01', '2025-10-09'], [$year['period']['compared_from'], $year['period']['compared_to']]);
    }

    public function test_a_period_is_cut_on_the_hour_the_shop_says_its_day_turns(): void
    {
        // This shop turns at midnight instead: the 01:30 sale is the 1st's now.
        $this->shop->forceFill(['settings' => [...($this->shop->settings ?? []), 'day_turns_at' => 0]])->save();
        // And one rung at 01:30 on the 1st of SEPTEMBER — the first hours of
        // the first day anything here is read from. On the server's clock that
        // moment is still August.
        $this->sale('2026-09-01 01:30', 200);

        $october = $this->dashboard('from=2026-10-01&to=2026-10-09');
        $this->assertEquals(4950, $october['period']['revenue']);
        $this->assertEquals(750, $october['sales_series'][0]['revenue']);
        // The 01:30 walk-in is a customer of October: Ayesha, Bilal, and two
        // tickets with no name on them.
        $this->assertSame(4, $october['period']['customers_count']);
        // 1–9 September holds Bilal's 800 and that 200: 4,950 against 1,000.
        $this->assertEquals(395.0, $october['period']['deltas']['revenue']);

        // September keeps its own 01:30 and gives the 1st of October's back.
        $september = $this->dashboard('from=2026-09-01&to=2026-09-30');
        $this->assertEquals(6300, $september['period']['revenue']);
    }

    public function test_one_branch_asked_about_a_period_is_that_branch_in_that_period(): void
    {
        $main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $this->sale('2026-10-08 13:00', 900, null, branch: $gulberg);
        $this->sale('2026-10-09 13:00', 70, null, branch: $gulberg);
        $this->sale('2026-10-08 14:00', 30, null, branch: $main);

        // The whole shop yesterday, side by side: only what each took THAT day.
        $all = $this->dashboard('from=2026-10-08&to=2026-10-08');
        $byBranch = collect($all['branches'])->keyBy('branch');
        $this->assertEquals(900, $byBranch['Gulberg']['revenue']);
        $this->assertSame(1, $byBranch['Gulberg']['sales_count']);
        $this->assertEquals(30, $byBranch[$main->name]['revenue']);

        // Focused on Gulberg, the tiles are Gulberg's yesterday.
        $focused = $this->dashboard('from=2026-10-08&to=2026-10-08', $gulberg);
        $this->assertEquals(900, $focused['period']['revenue']);
        $this->assertEquals(70, $focused['today']['revenue']);
    }

    public function test_a_chemist_is_told_what_was_dispensed_in_the_period(): void
    {
        $chemist = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
            'timezone' => 'Asia/Karachi',
        ]);
        $owner = User::factory()->shopOwner($chemist)->create();
        $this->sale('2026-10-09 10:00', 300, null, shop: $chemist, rx: 'RX-3', prescriber: 'Dr Khan');
        $this->sale('2026-10-08 10:00', 500, null, shop: $chemist, rx: 'RX-1', prescriber: 'Dr Khan');
        $this->sale('2026-10-08 11:00', 200, null, shop: $chemist, rx: 'RX-2', prescriber: 'Dr Raza');

        // Asked nothing: today's one script.
        $this->assertSame(1, $this->dashboard('', null, $owner)['dispensing']['rx_sales']);

        $yesterday = $this->dashboard('from=2026-10-08&to=2026-10-08', null, $owner)['dispensing'];
        $this->assertSame(2, $yesterday['rx_sales']);
        $this->assertEquals(700, $yesterday['rx_revenue']);
        $this->assertSame(2, $yesterday['prescribers']);

        // Two days: three scripts, and Dr Khan is still one prescriber.
        $both = $this->dashboard('from=2026-10-08&to=2026-10-09', null, $owner)['dispensing'];
        $this->assertSame(3, $both['rx_sales']);
        $this->assertSame(2, $both['prescribers']);
    }

    public function test_a_period_that_cannot_be_read_is_refused_in_words(): void
    {
        $ask = fn (string $query) => $this->as($this->owner)->getJson("/api/v1/dashboard?{$query}");

        $ask('from=2026-10-09&to=2026-10-01')->assertStatus(422)
            ->assertJsonPath('errors.to.0', 'The end of the period is before its start.');
        $ask('from=09-10-2026')->assertStatus(422)->assertJsonStructure(['errors' => ['from']]);
        $ask('from=2026-10-01&to=yesterday')->assertStatus(422)->assertJsonStructure(['errors' => ['to']]);
        $ask('from=2020-01-01&to=2026-10-09')->assertStatus(422)
            ->assertJsonPath('errors.from.0', 'Pick a period of three years or less. For anything longer, use Reports.');
    }

    // ── Plumbing ────────────────────────────────────────────────────

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array<string, mixed> */
    private function dashboard(string $query = '', ?Branch $branch = null, ?User $as = null): array
    {
        $request = $this->as($as ?? $this->owner);
        if ($branch !== null) {
            $request = $request->withHeaders(['X-Branch-Id' => $branch->id]);
        }
        $res = $request->getJson('/api/v1/dashboard'.($query === '' ? '' : "?{$query}"));
        $this->assertSame(200, $res->status(), "GET /dashboard?{$query} answered {$res->status()}: ".$res->content());

        return $res->json('data');
    }

    private function customer(string $name, string $phone): Customer
    {
        return Customer::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => $name, 'phone' => $phone]);
    }

    private function category(string $name): ExpenseCategory
    {
        return ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => $name, 'is_active' => true]);
    }

    private function expense(string $date, float $amount, ExpenseCategory $category): void
    {
        Expense::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'expense_category_id' => $category->id,
            'description' => $category->name,
            'amount' => $amount,
            'expense_date' => $date,
        ]);
    }

    /** A sale rung at a moment on the shop's own wall. */
    private function sale(
        string $wall,
        float $total,
        ?Customer $customer = null,
        float $tax = 0,
        ?Branch $branch = null,
        ?Tenant $shop = null,
        ?string $rx = null,
        ?string $prescriber = null,
    ): Sale {
        $shop ??= $this->shop;

        return Sale::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'branch_id' => $branch?->id,
            'customer_id' => $customer?->id,
            'invoice_number' => 'INV-'.str_replace(['-', ' ', ':'], '', $wall).'-'.random_int(100, 999),
            'channel' => SaleChannel::Pos->value,
            'payment_method' => PaymentMethod::Cash->value,
            'status' => SaleStatus::Completed->value,
            'subtotal' => $total - $tax,
            'tax' => $tax,
            'total' => $total,
            'amount_paid' => $total,
            'sold_at' => Carbon::parse($wall, 'Asia/Karachi')->utc(),
            'prescription_number' => $rx,
            'prescriber_name' => $prescriber,
        ]);
    }
}
