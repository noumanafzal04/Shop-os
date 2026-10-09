<?php

namespace App\Services;

use App\Enums\OrderStatus;
use App\Enums\ReservationStatus;
use App\Enums\RestaurantTicketStatus;
use App\Enums\TenantStatus;
use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\BankDeposit;
use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\Customer;
use App\Models\DiningTable;
use App\Models\Expense;
use App\Models\HeldSale;
use App\Models\Income;
use App\Models\KitchenTicket;
use App\Models\Order;
use App\Models\Plan;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Reservation;
use App\Models\RestaurantTicket;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\SaleDocument;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DashboardPeriod;
use App\Support\LowStock;
use App\Support\Modules;
use App\Support\Payable;
use App\Support\ServiceDay;
use App\Support\ShopDay;
use App\Support\ShopSettings;
use App\Support\Takings;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Dashboard aggregations.
 *
 * The tenant dashboard's sales/expenses/inventory numbers activate as those
 * modules land (Steps 7-10) — until then the API contract is stable and
 * frontends render honest empty states (the "empty dashboard" edge case).
 * All "today" windows use the tenant's timezone setting when reports land.
 */
class DashboardService
{
    /**
     * @param  string|null  $branchId  Scope the sales/stock figures to one
     *                                 branch, or null for the whole tenant
     *                                 (an owner's All-Branches HQ view).
     * @param  string|null  $from  The period asked about, both ends inclusive —
     * @param  string|null  $to  see DashboardPeriod. With neither, the payload
     *                           is the standing view it has always been:
     *                           today, the week behind it, the month's
     *                           spending and leaders. With either, every flow
     *                           on it is cut to exactly that period.
     */
    public function forTenant(Tenant $tenant, ?string $branchId = null, ?string $from = null, ?string $to = null): array
    {
        // The shop's OWN day, not the server's. See ShopDay: at one in the
        // morning a restaurant still serving is in the evening it opened in,
        // on every figure here and on every report it drills into.
        //
        // Two kinds of thing are kept apart below. A DATE ("2026-10-06") is
        // what a bucket is keyed by and what a typed date column is compared
        // with. A START is the instant that date begins for this shop, and is
        // what a timestamp is compared with. They are the same string only
        // for a shop whose day turns at midnight UTC.
        $today = ShopDay::today($tenant);
        $day = CarbonImmutable::parse($today);
        $yesterday = $day->subDay()->toDateString();
        $monthFrom = $day->startOfMonth()->toDateString();
        $todayStart = ShopDay::startOf($today, $tenant);
        $monthStart = ShopDay::startOf($monthFrom, $tenant);

        // THE PERIOD. Nobody asking is today — set against yesterday, drawn
        // as the last of seven days — which is what this method always read.
        $period = DashboardPeriod::of($from, $to, $today);
        $periodStart = ShopDay::startOf($period->from, $tenant);
        $periodEnd = ShopDay::endOf($period->to, $tenant);

        // What this tenant can even HAVE. A books-only (finance) shop has no
        // catalog, no till and no orders; a services shop carries no stock.
        // Every aggregate below is skipped OUTRIGHT when its module is off:
        // an honest zero costs no query, and hammering tables that can only be
        // empty is how a dashboard gets slow for the tenants doing the least.
        $sells = $tenant->featureEnabled('pos')
            || $tenant->featureEnabled('products')
            || $tenant->featureEnabled('services')
            || $tenant->featureEnabled('marketplace')
            || $tenant->featureEnabled('dine_in');
        $hasCatalog = $tenant->featureEnabled('products') || $tenant->featureEnabled('services');
        $tracksStock = $tenant->featureEnabled('inventory');
        $takesOrders = $tenant->featureEnabled('delivery') || $tenant->featureEnabled('marketplace');
        $keepsBooks = $tenant->featureEnabled('expenses');

        // Six grouped rollups, a day to a row, cover everything the period
        // needs: its own days, the days it is compared with, and the days the
        // chart draws. The tiles, the pills and the chart all read from these
        // arrays, so those panels can never contradict one another.
        $readsFrom = $period->readsFrom();
        $byDay = $this->rollups($tenant, $branchId, $readsFrom, $period->to, $sells, $keepsBooks);

        // TODAY IS ALWAYS ANSWERED, whatever period was asked. The line at the
        // head of the screen ("14 sales so far today") is about now, and a
        // shopkeeper reading last month must not be told the shop is idle.
        // The same arrays when they already reach today — which, with nobody
        // asking, they always do.
        $nearby = $readsFrom <= $yesterday && $period->to >= $today
            ? $byDay
            : $this->rollups($tenant, $branchId, $yesterday, $today, $sells, $keepsBooks);
        $salesByDay = $nearby['sales'];

        $now = $this->summed($nearby, $today, $today);
        $before = $this->summed($nearby, $yesterday, $yesterday);
        $revenue = $now['revenue'];
        $expensesToday = $now['expenses'];
        $incomeToday = $now['other_income'];
        $refundsToday = $now['refunds'];
        $profit = $now['profit'];

        $prevRevenue = $before['revenue'];
        $prevExpenses = $before['expenses'];
        $prevProfit = $before['profit'];

        // The period itself, and what it is set against.
        $inPeriod = $this->summed($byDay, $period->from, $period->to);
        $compared = $this->summed($byDay, $period->comparedFrom, $period->comparedTo);

        // What the panels that are neither tile nor chart are cut to: the
        // period when one was asked for — both ends — and otherwise what each
        // has always read (the month for the leaders, today for the rest).
        $leadersFrom = $period->asked ? $periodStart : $monthStart;
        $leadersUntil = $period->asked ? $periodEnd : null;
        $flowFrom = $period->asked ? $periodStart : $todayStart;
        $flowUntil = $period->asked ? $periodEnd : null;

        // Computed once, published twice: as the legacy top-level counts and
        // inside the inventory alert block the new dashboard reads.
        $lowStock = $tracksStock ? $this->lowStockCount($tenant, $branchId) : 0;
        $expiringSoon = $tracksStock ? $this->expiringSoonCount($tenant, $branchId) : 0;

        return [
            'setup_completed' => $tenant->setup_completed,
            'online_shop_enabled' => $tenant->online_shop_enabled,
            'subscription_expired' => $tenant->subscriptionExpired(),
            'subscription_state' => $tenant->subscriptionState(),
            'grace_ends_at' => $tenant->graceEndsAt()?->toIso8601String(),
            // Which branch these numbers reflect (null = all branches / HQ).
            'branch_scope' => $branchId,
            'today' => [
                'sales_count' => $salesByDay[$today]['sales_count'] ?? 0,
                'revenue' => round($revenue, 2),
                // Non-sale money in. Published separately from `revenue` so a
                // shop can still see what it SOLD, and a books-only business
                // has a figure to put beside what it spent.
                'other_income' => round($incomeToday, 2),
                // Handed back over the counter today. Published beside the
                // revenue it reduces rather than folded into it: a refund is
                // dated by the day it went OUT, and netting it into a revenue
                // figure would silently rewrite the day the sale came in.
                'refunds' => round($refundsToday, 2),
                'expenses' => round($expensesToday, 2),
                'profit' => round($profit, 2),
                // Buyers served, not tickets rung: an identified customer counts
                // once however many times they came back today, and each
                // anonymous walk-in ticket counts as one customer.
                'customers_count' => $salesByDay[$today]['customers_count'] ?? 0,
                // Signed % against the SAME figure yesterday. Null when
                // yesterday was zero — there is no honest percentage against
                // nothing, and the UI must hide the pill rather than print
                // "+100%" on a shop's first day.
                'deltas' => [
                    'revenue' => $this->percentDelta($revenue, $prevRevenue),
                    'expenses' => $this->percentDelta($expensesToday, $prevExpenses),
                    'profit' => $this->percentDelta($profit, $prevProfit),
                ],
            ],
            // THE PERIOD ASKED ABOUT — the same figures as `today`, for the
            // dates in it. The two are one and the same when nobody asked.
            //
            // Published beside `today` rather than in place of it: a key
            // called "today" carrying last month would be a lie in its own
            // name, and the screen needs both — today for the line at its
            // head, the period for everything under it.
            'period' => [
                ...$period->toArray(),
                'sales_count' => $inPeriod['sales_count'],
                'revenue' => round($inPeriod['revenue'], 2),
                'other_income' => round($inPeriod['other_income'], 2),
                'refunds' => round($inPeriod['refunds'], 2),
                'expenses' => round($inPeriod['expenses'], 2),
                'profit' => round($inPeriod['profit'], 2),
                // Buyers, not visits: somebody who came on Monday and again on
                // Thursday is ONE customer of the week. Adding the days up
                // would count them twice, so a run of days is asked on its own.
                'customers_count' => ! $sells ? 0 : ($period->isOneDay()
                    ? ($byDay['sales'][$period->from]['customers_count'] ?? 0)
                    : $this->customersServed($tenant, $branchId, $periodStart, $periodEnd)),
                'deltas' => [
                    'revenue' => $this->percentDelta($inPeriod['revenue'], $compared['revenue']),
                    'expenses' => $this->percentDelta($inPeriod['expenses'], $compared['expenses']),
                    'profit' => $this->percentDelta($inPeriod['profit'], $compared['profit']),
                ],
            ],
            // Orders live tenant-wide (an online order has no branch), so this
            // count is NOT branch-scoped — same as it has always been.
            'pending_orders' => $takesOrders
                ? Order::withoutTenancy()
                    ->where('tenant_id', $tenant->id)
                    ->whereNotIn('status', ['completed', 'cancelled'])
                    ->count()
                : 0,
            'pending_reservations' => $tenant->featureEnabled('reservations')
                ? Reservation::withoutTenancy()
                    ->where('tenant_id', $tenant->id)
                    ->where('status', ReservationStatus::Pending)
                    ->where('expires_at', '>', now())
                    ->count()
                : 0,
            'low_stock_count' => $lowStock,
            // Batches (medicine/perishable lots) inside the shop's own expiry
            // window — 90 days for a pharmacy, 30 for everyone else, or
            // whatever the shop set. Includes already-expired stock still on
            // hand. Branch-scoped.
            'expiring_soon_count' => $expiringSoon,
            'products_count' => $hasCatalog
                ? Product::query()
                    ->where('tenant_id', $tenant->id)
                    ->where('is_active', true)
                    ->count()
                : 0,
            // The period, a point at a time, oldest first and zero-filled — the
            // chart never has a hole for a day the shop was shut. Seven days
            // ending on it when the period is a single day.
            'sales_series' => $this->salesSeries($period, $byDay),
            // Spend per category — the donut beside the chart. The period's
            // when one was asked for; this month's, as ever, when none was.
            'expense_breakdown' => ! $keepsBooks ? [] : ($period->asked
                ? $this->expenseBreakdown($tenant, $branchId, $period->from, $period->to)
                : $this->expenseBreakdown($tenant, $branchId, $monthFrom)),
            'inventory' => [
                'low_stock' => $lowStock,
                'out_of_stock' => $tracksStock ? $this->outOfStockCount($tenant, $branchId) : 0,
                'expiring_soon' => $expiringSoon,
                'pending_pos' => $tenant->featureEnabled('pos') ? $this->parkedTicketCount($tenant, $branchId) : 0,
            ],
            'order_pipeline' => $takesOrders ? $this->orderPipeline($tenant) : $this->emptyPipeline(),
            // The till, at a glance. Deliberately NOT a second copy of the Day
            // screen: what belongs here is the state nothing else surfaces —
            // whether the day was ever closed off, and whether a day from
            // earlier in the week is still hanging open with no roll-up.
            'till' => $tenant->featureEnabled('pos') ? $this->tillToday($tenant, $branchId, $today, $todayStart) : null,
            // Who owes whom. An owner asks this straight after "what did I
            // take", and until now the dashboard could not answer it at all.
            'money_owed' => [
                'receivable' => $sells ? $this->receivable($tenant) : ['total' => 0.0, 'accounts' => 0],
                'payable' => $tracksStock ? $this->payable($tenant) : ['total' => 0.0, 'accounts' => 0],
            ],
            'recent_sales' => $sells ? $this->recentSales($tenant, $branchId) : [],
            'recent_expenses' => $keepsBooks ? $this->recentExpenses($tenant, $branchId) : [],
            // The leaders by revenue — of the period asked about, or of this
            // month when none was. Each is nullable: a shop that sold nothing,
            // or only to walk-ins, genuinely has no top customer.
            'highlights' => [
                'top_product' => $sells ? $this->topProduct($tenant, $branchId, $leadersFrom, $leadersUntil) : null,
                'top_category' => $sells ? $this->topCategory($tenant, $branchId, $leadersFrom, $leadersUntil) : null,
                'top_customer' => $sells ? $this->topCustomer($tenant, $branchId, $leadersFrom, $leadersUntil) : null,
                'top_staff' => $sells ? $this->topStaff($tenant, $branchId, $leadersFrom, $leadersUntil) : null,
            ],
            // What THIS trade needs and nobody else does. Null when the shop
            // is not that trade, so the panel is absent rather than empty —
            // the same rule every other block on this dashboard follows.
            'floor' => $tenant->featureEnabled('dine_in') ? $this->diningFloor($tenant, $branchId) : null,
            // A tenant an admin has not typed yet carries a NULL business_type,
            // and `primary()` takes a string — so the null is answered here
            // rather than by widening a signature every caller relies on.
            'dispensing' => $tenant->business_type !== null
                && BusinessTypes::primary($tenant->business_type) === 'pharmacy'
                ? $this->dispensingToday($tenant, $branchId, $flowFrom, $flowUntil)
                : null,
            // The morning question of a shop that takes work IN: what is on the
            // board, and what has been finished and not yet charged for.
            //
            // Automotive and services both. A job card is work taken in — lines
            // accumulate, nobody knows the price on arrival, it becomes an
            // invoice when the customer collects — and that is a workshop
            // exactly as much as it is a laundry, a tailor or a repair counter.
            //
            // The money half is READY: a job marked ready is finished work, and
            // while its document is open nobody has invoiced it. Work handed
            // back without converting the card is work the shop will never be
            // paid for.
            'bay' => $tenant->business_type !== null
                && in_array(BusinessTypes::primary($tenant->business_type), ['automotive', 'services'], true)
                ? $this->workshopBay($tenant, $branchId)
                : null,
            'activity' => $this->tenantActivity($tenant),
            // HQ comparison: the period's sales per branch. Only for multi-branch
            // tenants (a single-shop owner gets an empty array, no HQ panel).
            'branches' => $this->branchBreakdown($tenant, $flowFrom, $sells, $flowUntil),
        ];
    }

    /**
     * Everything that is bucketed by day, for a run of dates: one grouped
     * query each, keyed `Y-m-d`.
     *
     * Bounded at BOTH ends. The lower bound alone was enough while the window
     * always ended today; a period can now end last March, and a shop with
     * three years of sales must not have them all grouped to draw one month.
     *
     * @return array{sales: array<string, array{sales_count: int, revenue: float, customers_count: int}>,
     *               cogs: array<string, float>, expenses: array<string, float>, income: array<string, float>,
     *               refunds: array<string, float>, tax: array<string, float>}
     */
    private function rollups(Tenant $tenant, ?string $branchId, string $from, string $to, bool $sells, bool $keepsBooks): array
    {
        $start = ShopDay::startOf($from, $tenant);
        $end = ShopDay::endOf($to, $tenant);

        return [
            'sales' => $sells ? $this->dailySales($tenant, $branchId, $start, $end) : [],
            'cogs' => $sells ? $this->dailyCogs($tenant, $branchId, $start, $end) : [],
            // Expenses are branch-scoped: a focused branch deducts only its own
            // costs; the all-branches view (branchId null) sums the whole tenant.
            'expenses' => $keepsBooks ? $this->dailyExpenses($tenant, $branchId, $from, $to) : [],
            'income' => $keepsBooks ? $this->dailyIncome($tenant, $branchId, $from, $to) : [],
            // What went back out over the counter. Rolled up the same way as the
            // others so the tile, the delta and the chart cannot disagree —
            // and rolled up at all because they once agreed on a profit that
            // took no account of anything handed back.
            'refunds' => $sells ? $this->dailyRefunds($tenant, $branchId, $start, $end) : [],
            // The sales tax held for the government, day by day: what was charged
            // less what was handed back. Revenue includes it and profit must not —
            // see ReportService::summary, which had the same fault and the same fix.
            'tax' => $sells ? $this->dailyTax($tenant, $branchId, $start, $end) : [],
        ];
    }

    /**
     * The rollups added up over a run of dates — a day, a week of the chart,
     * the whole period. ONE definition of every figure, so the tile, the
     * point on the chart and the pill beside them are the same arithmetic.
     *
     * Net profit: everything that came in (sales AND non-sale income)
     * − refunds − the tax held − cost of goods (line snapshots) − expenses.
     * Leaving income out made this the Cashbook's answer minus the whole of
     * what the business earned — for a books-only tenant, a permanent loss.
     *
     * @param  array{sales: array<string, array{sales_count: int, revenue: float, customers_count: int}>,
     *               cogs: array<string, float>, expenses: array<string, float>, income: array<string, float>,
     *               refunds: array<string, float>, tax: array<string, float>}  $byDay
     * @return array{sales_count: int, revenue: float, other_income: float, refunds: float, expenses: float, profit: float}
     */
    private function summed(array $byDay, string $from, string $to): array
    {
        // `Y-m-d` sorts as text exactly as it sorts as a date.
        $within = static fn (string $date): bool => $date >= $from && $date <= $to;
        $sum = static fn (array $days): float => (float) array_sum(array_filter($days, $within, ARRAY_FILTER_USE_KEY));

        $sales = array_filter($byDay['sales'], $within, ARRAY_FILTER_USE_KEY);
        $revenue = (float) array_sum(array_column($sales, 'revenue'));
        $income = $sum($byDay['income']);
        $refunds = $sum($byDay['refunds']);
        $expenses = $sum($byDay['expenses']);

        return [
            'sales_count' => (int) array_sum(array_column($sales, 'sales_count')),
            'revenue' => $revenue,
            'other_income' => $income,
            'refunds' => $refunds,
            'expenses' => $expenses,
            'profit' => $revenue - $refunds - $sum($byDay['tax']) + $income - $sum($byDay['cogs']) - $expenses,
        ];
    }

    /**
     * Buyers served over a run of days: an identified customer once, however
     * many days they came on, and each anonymous walk-in ticket as one.
     */
    private function customersServed(Tenant $tenant, ?string $branchId, CarbonInterface $from, CarbonInterface $until): int
    {
        return (int) Sale::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('status', Takings::COUNTED)
            ->whereBetween('sold_at', [$from, $until])
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->selectRaw('COUNT(DISTINCT COALESCE(customer_id, id)) as customers')
            ->toBase()
            ->value('customers');
    }

    /**
     * Completed sales bucketed by DAY over the window: one grouped query that
     * feeds today's tiles, yesterday's deltas and the 7-day chart.
     *
     * @return array<string, array{sales_count: int, revenue: float, customers_count: int}>
     */
    private function dailySales(Tenant $tenant, ?string $branchId, CarbonInterface $from, CarbonInterface $until): array
    {
        $day = ShopDay::dateSql('sold_at', $tenant);

        return Sale::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('status', Takings::COUNTED)
            ->whereBetween('sold_at', [$from, $until])
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->selectRaw(
                "{$day} as day, COUNT(*) as sales_count, COALESCE(SUM(total), 0) as revenue,"
                // A walk-in has no customer row, so the sale's own id stands in
                // for "one anonymous buyer" — collapsing every walk-in of the
                // day into a single customer would be a lie.
                .' COUNT(DISTINCT COALESCE(customer_id, id)) as customers_count'
            )
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => [
                'sales_count' => (int) $row->sales_count,
                'revenue' => (float) $row->revenue,
                'customers_count' => (int) $row->customers_count,
            ]])
            ->all();
    }

    /**
     * Cost of goods sold per day, from the line snapshots. Joined rather than
     * whereHas'd so the sale's date can be grouped on — which means the sales
     * table's own soft-delete filter has to be spelled out by hand.
     *
     * @return array<string, float>
     */
    private function dailyCogs(Tenant $tenant, ?string $branchId, CarbonInterface $from, CarbonInterface $until): array
    {
        $day = ShopDay::dateSql('sales.sold_at', $tenant);

        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereNull('sales.deleted_at')
            ->whereIn('sales.status', Takings::COUNTED)
            ->whereBetween('sales.sold_at', [$from, $until])
            ->when($branchId, fn ($q, $b) => $q->where('sales.branch_id', $b))
            ->selectRaw("{$day} as day, COALESCE(SUM(sale_items.unit_cost * sale_items.quantity), 0) as cogs")
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => (float) $row->cogs])
            ->all();
    }

    /**
     * @return array<string, float>
     */
    /**
     * What was refunded per day, by the day it was HANDED BACK.
     *
     * Not by the day of the sale: a bag returned on Thursday against Monday's
     * invoice belongs to Thursday's money-out, and Monday has already been
     * counted, closed and banked. The cashbook has always dated refunds this
     * way — this is the same rule, for the tiles and the chart.
     */
    private function dailyRefunds(Tenant $tenant, ?string $branchId, CarbonInterface $from, CarbonInterface $until): array
    {
        $day = ShopDay::dateSql('returned_at', $tenant);

        return SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('returned_at', [$from, $until])
            ->selectRaw("{$day} as day, COALESCE(SUM(refund_total), 0) as total")
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => (float) $row->total])
            ->all();
    }

    /**
     * Sales tax still held, per day: charged on that day's sales, less what
     * that day's returns handed back.
     *
     * @return array<string, float>
     */
    private function dailyTax(Tenant $tenant, ?string $branchId, CarbonInterface $from, CarbonInterface $until): array
    {
        $sold = ShopDay::dateSql('sold_at', $tenant);
        $charged = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('status', Takings::COUNTED)
            ->whereBetween('sold_at', [$from, $until])
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->selectRaw("{$sold} as day, COALESCE(SUM(tax), 0) as total")
            ->groupByRaw($sold)
            ->toBase()
            ->get();

        $back = ShopDay::dateSql('returned_at', $tenant);
        $returned = SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('returned_at', [$from, $until])
            ->selectRaw("{$back} as day, COALESCE(SUM(refund_tax), 0) as total")
            ->groupByRaw($back)
            ->toBase()
            ->get();

        $byDay = [];
        foreach ($charged as $row) {
            $byDay[$row->day] = (float) $row->total;
        }
        foreach ($returned as $row) {
            $byDay[$row->day] = ($byDay[$row->day] ?? 0.0) - (float) $row->total;
        }

        return $byDay;
    }

    private function dailyExpenses(Tenant $tenant, ?string $branchId, string $from, string $to): array
    {
        $day = $this->dayExpression('expense_date');

        return Expense::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            // Both ends spelled to the second, as the reports spell them: SQLite
            // keeps "2026-10-09 00:00:00" in this column, which as text is
            // AFTER a bare "2026-10-09" — and the last day would be left out.
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->selectRaw("{$day} as day, COALESCE(SUM(amount), 0) as total")
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => (float) $row->total])
            ->all();
    }

    /**
     * Money in that wasn't a sale, per day — a retainer, an owner's injection,
     * a supplier refund.
     *
     * The dashboard used to know nothing about it, so profit was
     * revenue − cost − expenses and a business whose earnings ARE income (a
     * consultant, an agency, anything on the books-only plan) was shown a
     * permanent loss the size of its own rent. The Cashbook had it right all
     * along; this is the same sum, bucketed like the others.
     *
     * @return array<string, float>
     */
    private function dailyIncome(Tenant $tenant, ?string $branchId, string $from, string $to): array
    {
        $day = $this->dayExpression('income_date');

        return Income::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->whereBetween('income_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->selectRaw("{$day} as day, COALESCE(SUM(amount), 0) as total")
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => (float) $row->total])
            ->all();
    }

    /**
     * The chart, built in PHP from the rollups so a day with no trade still
     * gets a point.
     *
     * Each point is `summed()` over the dates it covers — the same sum the
     * tiles are, so the points of a period add up to its tile and the last
     * point of "today" always equals the number in the tile.
     *
     * `day` is what the axis calls the point ("Mon", "9 Oct", "Oct") and
     * `date` the first date it covers; both names are older than the period
     * and are kept, because the phone app reads them. `to` is the last date —
     * the same as `date` until a point is a week or a month wide.
     *
     * @return array<int, array{day: string, date: string, to: string, revenue: float,
     *                          other_income: float, refunds: float, expenses: float, profit: float}>
     */
    private function salesSeries(DashboardPeriod $period, array $byDay): array
    {
        return array_map(function (array $bucket) use ($byDay): array {
            $sum = $this->summed($byDay, $bucket['from'], $bucket['to']);

            return [
                'day' => $bucket['label'],
                'date' => $bucket['from'],
                'to' => $bucket['to'],
                'revenue' => round($sum['revenue'], 2),
                'other_income' => round($sum['other_income'], 2),
                'refunds' => round($sum['refunds'], 2),
                'expenses' => round($sum['expenses'], 2),
                'profit' => round($sum['profit'], 2),
            ];
        }, $period->buckets());
    }

    /**
     * Signed change against the previous period, or null when there is no
     * baseline. Divided by the magnitude of the baseline so a loss that
     * shrinks reads as a rise, not a fall.
     */
    private function percentDelta(float $current, float $previous): ?float
    {
        if (abs($previous) < 0.005) {
            return null;
        }

        return round((($current - $previous) / abs($previous)) * 100, 1);
    }

    /**
     * Expenses per category, biggest first — from a date, and up to one when
     * a period was asked for.
     *
     * @return array<int, array{category: string, total: float}>
     */
    private function expenseBreakdown(Tenant $tenant, ?string $branchId, string $from, ?string $to = null): array
    {
        return Expense::withoutTenancy()
            ->where('expenses.tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('expenses.branch_id', $b))
            ->where('expenses.expense_date', '>=', $from)
            ->when($to, fn ($q, $until) => $q->where('expenses.expense_date', '<=', $until.' 23:59:59'))
            ->leftJoin('expense_categories', 'expenses.expense_category_id', '=', 'expense_categories.id')
            ->selectRaw('COALESCE(expense_categories.name, \'Uncategorized\') as category, SUM(expenses.amount) as total')
            ->groupBy(DB::raw('COALESCE(expense_categories.name, \'Uncategorized\')'))
            ->orderByDesc('total')
            ->toBase()
            ->get()
            ->map(fn ($row): array => [
                'category' => (string) $row->category,
                'total' => round((float) $row->total, 2),
            ])
            ->all();
    }

    /**
     * Low-stock item count. All-branches uses the rollup stock_quantity; a
     * single branch compares that branch's on-hand (branch_stock) to the
     * product's threshold.
     */
    private function lowStockCount(Tenant $tenant, ?string $branchId): int
    {
        // THE SAME RULE THE LIST USES — see LowStock.
        //
        // Both arms of this were blind to sizes, and the branch arm doubly so:
        // `whereNull('branch_stock.variant_id')` skips exactly the rows a
        // varianted product's stock lives on, so the join found nothing, the
        // COALESCE made it nought, and every sized product was counted as low.
        // The number on the dashboard and the rows on the screen it links to
        // have to be the same question.
        return LowStock::apply(
            Product::query()->where('products.tenant_id', $tenant->id),
            $branchId,
        )->count();
    }

    /**
     * Sold out: tracked items at (or below) zero on hand. No threshold needed —
     * an item nobody set a threshold for is still out of stock at zero.
     */
    private function outOfStockCount(Tenant $tenant, ?string $branchId): int
    {
        if ($branchId === null) {
            return Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('track_inventory', true)
                ->where('stock_quantity', '<=', 0)
                ->count();
        }

        return Product::query()
            ->where('products.tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->leftJoin('branch_stock', function ($join) use ($branchId): void {
                $join->on('branch_stock.product_id', '=', 'products.id')
                    ->whereNull('branch_stock.variant_id')
                    ->where('branch_stock.branch_id', '=', $branchId);
            })
            ->whereRaw('COALESCE(branch_stock.quantity, 0) <= 0')
            ->count();
    }

    private function expiringSoonCount(Tenant $tenant, ?string $branchId): int
    {
        return ProductBatch::query()
            ->where('tenant_id', $tenant->id)
            // The shop's own window, resolved in ONE place. The tile and the
            // screen it links to must agree about which lots are urgent — a
            // tile reading "0 expiring soon" over a list of dying stock is
            // worse than either being wrong on its own.
            ->expiringWithin(ShopSettings::expiringSoonDays($tenant))
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->count();
    }

    /** Carts a cashier parked and never came back to — money left on the counter. */
    private function parkedTicketCount(Tenant $tenant, ?string $branchId): int
    {
        return HeldSale::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->count();
    }

    /**
     * Online orders by stage. The four buckets fold the seven order states into
     * what a shop actually watches; cancelled orders are not a stage, they are
     * an outcome, so they are left out. pending + preparing + delivery always
     * equals `pending_orders`.
     *
     * @return array{pending: int, preparing: int, delivery: int, completed: int}
     */
    private function orderPipeline(Tenant $tenant): array
    {
        $counts = Order::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->selectRaw('status, COUNT(*) as orders')
            ->groupBy('status')
            ->toBase()
            ->pluck('orders', 'status');

        $of = fn (string ...$states): int => (int) collect($states)
            ->sum(fn (string $s): int => (int) ($counts[$s] ?? 0));

        return [
            'pending' => $of('pending', 'confirmed'),
            'preparing' => $of('preparing', 'ready'),
            'delivery' => $of('out_for_delivery'),
            'completed' => $of('completed'),
        ];
    }

    /** @return array{pending: int, preparing: int, delivery: int, completed: int} */
    private function emptyPipeline(): array
    {
        return ['pending' => 0, 'preparing' => 0, 'delivery' => 0, 'completed' => 0];
    }

    /**
     * Today at the till — and the one thing no other screen shouts about.
     *
     * A trading day that was never closed off never gets its roll-up, so the
     * shop's record of that day quietly does not exist. Nobody discovers it
     * until they go looking for a figure months later, which is far too late.
     * Deliberately NOT a second copy of the Day screen: no drawer arithmetic
     * happens here, because a dashboard is loaded far more often than a day is
     * closed.
     *
     * @return array{day_open: bool, day_id: string|null, open_shifts: int,
     *               banked_today: float, unclosed_day: string|null, unclosed_days: int}
     */
    private function tillToday(Tenant $tenant, ?string $branchId, string $today, CarbonInterface $todayStart): array
    {

        $openDays = BusinessDay::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('status', BusinessDay::STATUS_OPEN)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->orderBy('trading_date')
            ->get(['id', 'trading_date']);

        // A day belongs to a branch, so the all-branches view is looking at
        // SEVERAL of today's days at once. Counting one branch's shifts and
        // calling it the chain's would tell an owner every till was counted out
        // while two sites were still selling.
        // "Today or later": a day opened in the small hours after the last
        // one was closed off is dated by the calendar (BusinessDay::
        // tradingDateAt), a date the shop's business day has not reached yet.
        // It is the day being traded, not an absent one.
        $todayDays = $openDays->filter(fn (BusinessDay $d): bool => $d->trading_date->toDateString() >= $today);
        $unclosed = $openDays->filter(fn (BusinessDay $d): bool => $d->trading_date->toDateString() < $today);

        return [
            'day_open' => $todayDays->isNotEmpty(),
            'day_id' => $todayDays->first()?->id,
            'open_shifts' => $todayDays->isEmpty() ? 0 : CashSession::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->whereIn('business_day_id', $todayDays->pluck('id'))
                ->where('status', 'open')
                ->count(),
            'banked_today' => round((float) BankDeposit::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
                ->where('deposited_at', '>=', $todayStart)
                ->sum('amount'), 2),
            // The OLDEST day still hanging open. Null is the healthy answer.
            'unclosed_day' => $unclosed->first()?->trading_date->toDateString(),
            'unclosed_days' => $unclosed->count(),
        ];
    }

    /**
     * Khata — what customers owe the shop.
     *
     * Positive balances only. A customer holding credit is not a debt, and
     * netting the two would report a book that is half the size it is.
     *
     * @return array{total: float, accounts: int}
     */
    private function receivable(Tenant $tenant): array
    {
        $row = Customer::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('credit_balance', '>', 0)
            ->selectRaw('COALESCE(SUM(credit_balance), 0) as owed, COUNT(*) as accounts')
            ->toBase()
            ->first();

        return [
            'total' => round((float) ($row->owed ?? 0), 2),
            'accounts' => (int) ($row->accounts ?? 0),
        ];
    }

    /**
     * What the shop owes its suppliers.
     *
     * Drafts are excluded along with cancellations: a PO nobody has placed is
     * a shopping list, not a bill, and counting it would inflate the figure an
     * owner uses to decide whether they can pay someone this week.
     *
     * @return array{total: float, accounts: int}
     */
    private function payable(Tenant $tenant): array
    {
        /**
         * OWED FOR WHAT ARRIVED, NETTED PER SUPPLIER.
         *
         * This was two mistakes deep. It first read `total` — the ordered
         * value — so the owner's dashboard billed them for goods still on a
         * van. That was fixed by naming the column once (Payable::AMOUNT) and
         * the figure was still wrong, because the RULE was still written here:
         * summing `received_total - amount_paid` across ORDERS, skipping every
         * order where the shop had paid MORE than arrived.
         *
         * An overpaid order is ordinary — pay the bill, the van is two cartons
         * short — and those rupees are credit with that wholesaler. Dropping
         * them made this 7% higher than the Suppliers screen on a real shop.
         *
         * One rule now, in Payable::owedByShop, read by all three.
         */
        $owed = Payable::owedByShop($tenant->id);

        return [
            'total' => $owed['total'],
            'accounts' => $owed['accounts'],
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function recentSales(Tenant $tenant, ?string $branchId): array
    {
        return Sale::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->orderByDesc('sold_at')
            ->limit(6)
            // Cancelled sales stay in the list: the status pill is the point.
            ->get(['id', 'invoice_number', 'customer_name', 'total', 'status', 'sold_at'])
            ->map(fn (Sale $sale): array => [
                'id' => $sale->id,
                'invoice_number' => $sale->invoice_number,
                'customer' => $sale->customer_name ?: 'Walk-in',
                'total' => round((float) $sale->total, 2),
                'status' => $sale->status->value,
                'sold_at' => $sale->sold_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function recentExpenses(Tenant $tenant, ?string $branchId): array
    {
        return Expense::withoutTenancy()
            ->where('expenses.tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('expenses.branch_id', $b))
            ->leftJoin('expense_categories', 'expenses.expense_category_id', '=', 'expense_categories.id')
            ->orderByDesc('expenses.expense_date')
            ->orderByDesc('expenses.created_at')
            ->limit(6)
            ->get([
                'expenses.id',
                'expenses.description',
                'expenses.amount',
                'expenses.expense_date',
                DB::raw('COALESCE(expense_categories.name, \'Uncategorized\') as category'),
            ])
            ->map(fn (Expense $expense): array => [
                'id' => $expense->id,
                'category' => (string) $expense->getAttribute('category'),
                // An expense has no vendor column — the description IS the
                // "paid to / paid for" line the shop typed. Sent under both
                // names so the UI can label the column either way.
                'payee' => $expense->description,
                'description' => $expense->description,
                'date' => $expense->expense_date?->toDateString(),
                'amount' => round((float) $expense->amount, 2),
            ])
            ->all();
    }

    /**
     * @return array{name: string, units: float, revenue: float}|null
     */
    private function topProduct(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): ?array
    {
        $row = $this->soldLines($tenant, $branchId, $from, $until)
            ->selectRaw('sale_items.product_name as name, SUM(sale_items.quantity) as units, SUM(sale_items.line_total) as revenue')
            ->groupBy('sale_items.product_name')
            ->orderByDesc('revenue')
            ->toBase()
            ->first();

        return $row === null ? null : [
            'name' => (string) $row->name,
            // Units can be fractional — 2.5 kg of rice is one line.
            'units' => round((float) $row->units, 3),
            'revenue' => round((float) $row->revenue, 2),
        ];
    }

    /**
     * @return array{name: string, revenue: float}|null
     */
    private function topCategory(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): ?array
    {
        // Left joins throughout: a line whose product (or whose product's
        // category) has since been deleted still sold, and belongs somewhere.
        $row = $this->soldLines($tenant, $branchId, $from, $until)
            ->leftJoin('products', 'products.id', '=', 'sale_items.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->selectRaw('COALESCE(categories.name, \'Uncategorized\') as name, SUM(sale_items.line_total) as revenue')
            // Group by the EXPRESSION, not the alias: products.name and
            // categories.name are both in scope here, so "group by name" is
            // ambiguous and the query dies at the driver.
            ->groupBy(DB::raw('COALESCE(categories.name, \'Uncategorized\')'))
            ->orderByDesc('revenue')
            ->toBase()
            ->first();

        return $row === null ? null : [
            'name' => (string) $row->name,
            'revenue' => round((float) $row->revenue, 2),
        ];
    }

    /**
     * @return array{id: string, name: string, sales_count: int, revenue: float}|null
     */
    private function topCustomer(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): ?array
    {
        $row = $this->soldSales($tenant, $branchId, $from, $until)
            ->join('customers', 'customers.id', '=', 'sales.customer_id')
            ->selectRaw('customers.id as id, customers.name as name, COUNT(*) as sales_count, SUM(sales.total) as revenue')
            ->groupBy('customers.id', 'customers.name')
            ->orderByDesc('revenue')
            ->toBase()
            ->first();

        return $row === null ? null : [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'sales_count' => (int) $row->sales_count,
            'revenue' => round((float) $row->revenue, 2),
        ];
    }

    /**
     * @return array{id: string, name: string, sales_count: int, revenue: float}|null
     */
    private function topStaff(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): ?array
    {
        $row = $this->soldSales($tenant, $branchId, $from, $until)
            ->whereNotNull('sales.created_by')
            ->join('users', 'users.id', '=', 'sales.created_by')
            ->selectRaw('users.id as id, users.name as name, COUNT(*) as sales_count, SUM(sales.total) as revenue')
            ->groupBy('users.id', 'users.name')
            ->orderByDesc('revenue')
            ->toBase()
            ->first();

        return $row === null ? null : [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'sales_count' => (int) $row->sales_count,
            'revenue' => round((float) $row->revenue, 2),
        ];
    }

    /**
     * Completed sales from an instant — and up to one, when a period was asked
     * for — fully qualified so the highlight queries can join tables that
     * carry their own `status` / `name` columns.
     */
    private function soldSales(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): Builder
    {
        return Sale::query()
            ->where('sales.tenant_id', $tenant->id)
            ->whereIn('sales.status', Takings::COUNTED)
            ->where('sales.sold_at', '>=', $from)
            ->when($until, fn ($q, $end) => $q->where('sales.sold_at', '<=', $end))
            ->when($branchId, fn ($q, $b) => $q->where('sales.branch_id', $b));
    }

    /** The lines of those sales (see dailyCogs() on the hand-written soft-delete filter). */
    private function soldLines(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): Builder
    {
        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereNull('sales.deleted_at')
            ->whereIn('sales.status', Takings::COUNTED)
            ->where('sales.sold_at', '>=', $from)
            ->when($until, fn ($q, $end) => $q->where('sales.sold_at', '<=', $end))
            ->when($branchId, fn ($q, $b) => $q->where('sales.branch_id', $b));
    }

    /**
     * The shop's own timeline. `at` is always a real ISO-8601 instant so the UI
     * can format it — never a bare or partial date string.
     *
     * @return array<int, array<string, mixed>>
     */
    /**
     * The restaurant floor, right now.
     *
     * At 8pm a kitchen does not want today's revenue — it wants how many tables
     * are sat, whose bill is still running, and what is stacking up on the pass.
     * None of it is a "today" figure: every number here is the state of this
     * minute, which is why nothing is windowed by date.
     *
     * Occupancy is derived from open tickets, never from a column on the table
     * — the same rule DiningTable::isOccupied follows, so the dashboard and the
     * floor plan can never disagree about whether table 4 is free.
     *
     * Branch-scoped since 2026-08-10. It could not be before: the three floor
     * tables carried no `branch_id` at all, so a two-site restaurant ran one
     * shared floor and one shared kitchen queue while its takings report was
     * correctly split — which made the floor look like a display glitch rather
     * than a missing dimension.
     *
     * @return array{tables: int, occupied: int, open_tabs: int, kot_waiting: int, kot_ready: int}
     */
    private function diningFloor(Tenant $tenant, ?string $branchId): array
    {
        $tables = DiningTable::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('is_active', true);

        // A BILL THAT IS RUNNING IS A BILL NOBODY HAS PAID.
        //
        // A takeaway rung at the till is paid before the kitchen sees it, and
        // is left open only so its docket stays on the pass. Counted here it
        // made "bills running" four on a floor with every table empty — four
        // orders already in the drawer, waiting on nothing but the cook.
        $openTabs = RestaurantTicket::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('from_counter', false)
            ->where('status', RestaurantTicketStatus::Open->value);

        // Fired and not yet served. `ready_at` splits the two states a kitchen
        // actually distinguishes: still cooking, versus sitting under the lamp
        // waiting for someone to run it — the second is the one that gets cold.
        // `forAnOpenTab` — the same rule the pass reads. Without it this counted
        // every un-served docket ever fired, so the number an owner reads to
        // know what the kitchen owes grew by one for every tab anybody had ever
        // cancelled and never came down.
        //
        // …AND THE SAME WINDOW. The pass shows this service only (ServiceDay),
        // and what an earlier one left behind is counted apart, on the pass,
        // where somebody can clear it. Counted in here it made "in the
        // kitchen" a number that could only be explained by scrolling a board
        // that no longer shows the tickets it was counting.
        $kots = KitchenTicket::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->stillOwed()
            ->inService(ServiceDay::began($tenant));

        return [
            'tables' => (int) $tables->count(),
            'occupied' => (int) (clone $tables)->whereHas('openTicket')->count(),
            'open_tabs' => (int) $openTabs->count(),
            'kot_waiting' => (int) (clone $kots)->where('status', '!=', 'ready')->count(),
            'kot_ready' => (int) (clone $kots)->where('status', 'ready')->count(),
        ];
    }

    /**
     * What was dispensed against a prescription today.
     *
     * A medical store's day splits in two: over-the-counter trade, and the
     * prescriptions it is legally answerable for. Only the second has a
     * prescriber's name attached to it, and only the second is what an
     * inspector asks about — but the dashboard counted them together, so the
     * one figure a pharmacist would be asked to produce did not exist anywhere.
     *
     * `prescription_number` is the marker: a sale that captured one IS an Rx
     * sale, whatever else was in the basket beside it.
     *
     * @return array{rx_sales: int, rx_revenue: float, prescribers: int}
     */
    private function dispensingToday(Tenant $tenant, ?string $branchId, CarbonInterface $from, ?CarbonInterface $until = null): array
    {
        $rx = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('status', Takings::COUNTED)
            ->whereNotNull('prescription_number')
            ->where('prescription_number', '!=', '')
            ->where('sold_at', '>=', $from)
            ->when($until, fn (Builder $q, $end) => $q->where('sold_at', '<=', $end))
            ->when($branchId, fn (Builder $q) => $q->where('branch_id', $branchId));

        return [
            'rx_sales' => (int) (clone $rx)->count(),
            'rx_revenue' => (float) (clone $rx)->sum('total'),
            // Distinct prescribers, because a name that appears on half the
            // day's scripts is worth knowing about.
            'prescribers' => (int) (clone $rx)
                ->whereNotNull('prescriber_name')
                ->where('prescriber_name', '!=', '')
                ->distinct()
                ->count('prescriber_name'),
        ];
    }

    /**
     * The cars in the bay, and the work already done that nobody has billed.
     *
     * `work_status` says where the CAR is; `status` says whether the paperwork
     * is live. Every figure here is scoped to OPEN documents, because a
     * converted job card is an invoice and has left the bay board — folding
     * those in would count last month's work as outstanding.
     *
     * The value on `ready` is the one worth reading. A job marked ready is
     * finished; if it is still open, nobody has charged for it. That is a
     * number a workshop owner can act on this afternoon, and it did not exist
     * anywhere before.
     */
    private function workshopBay(Tenant $tenant, ?string $branchId): array
    {
        $open = fn () => SaleDocument::query()
            ->where('tenant_id', $tenant->id)
            ->where('kind', SaleDocument::KIND_JOB_CARD)
            ->where('status', SaleDocument::STATUS_OPEN)
            ->when($branchId, fn (Builder $q) => $q->where('branch_id', $branchId));

        $byStage = (clone $open())
            ->selectRaw('work_status, COUNT(*) as cars, COALESCE(SUM(total), 0) as value')
            ->groupBy('work_status')
            ->get()
            ->keyBy('work_status');

        $stage = fn (string $key): array => [
            'cars' => (int) ($byStage[$key]->cars ?? 0),
            'value' => round((float) ($byStage[$key]->value ?? 0), 2),
        ];

        return [
            'received' => $stage(SaleDocument::WORK_RECEIVED),
            'in_progress' => $stage(SaleDocument::WORK_IN_PROGRESS),
            // Done, and not yet charged for.
            'ready' => $stage(SaleDocument::WORK_READY),
            // Past the time somebody was told. Counted across every stage,
            // because a car promised for Tuesday is late whether it is on the
            // ramp or waiting to be collected.
            'overdue' => (int) (clone $open())
                ->whereNotNull('promised_at')
                ->where('promised_at', '<', now())
                ->count(),
        ];
    }

    private function tenantActivity(Tenant $tenant): array
    {
        return AuditLog::query()
            ->where('audit_logs.tenant_id', $tenant->id)
            ->leftJoin('users', 'users.id', '=', 'audit_logs.user_id')
            // Several rows can share a timestamp to the second; the id breaks
            // the tie so the timeline never reshuffles between requests.
            ->orderByDesc('audit_logs.created_at')
            ->orderByDesc('audit_logs.id')
            ->limit(8)
            ->get([
                'audit_logs.id',
                'audit_logs.event',
                'audit_logs.auditable_type',
                'audit_logs.auditable_id',
                'audit_logs.created_at',
                DB::raw('users.name as actor_name'),
            ])
            ->map(fn (AuditLog $log): array => [
                'id' => $log->id,
                'event' => $log->event,
                'entity' => class_basename($log->auditable_type),
                'entity_id' => $log->auditable_id,
                'actor' => $log->getAttribute('actor_name') ?? 'System',
                'at' => $log->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * "2026-01-31" from a date or timestamp column. MySQL runs production,
     * SQLite runs the tests, and neither spells this the same way.
     */
    /**
     * A typed DATE column as `Y-m-d` — an expense's date, an income's.
     *
     * Deliberately not ShopDay: somebody typed these as a date on a calendar,
     * and a rent bill dated the 6th is the 6th's whatever hour the shop's day
     * turns. Only a MOMENT is moved by that hour.
     */
    private function dayExpression(string $column): string
    {
        return match (DB::connection()->getDriverName()) {
            'sqlite' => "strftime('%Y-%m-%d', {$column})",
            'pgsql' => "to_char({$column}, 'YYYY-MM-DD')",
            default => "DATE_FORMAT({$column}, '%Y-%m-%d')",
        };
    }

    /**
     * Today's completed-sales count + revenue for every active branch — the
     * per-branch comparison behind the HQ dashboard. Empty for single-branch
     * tenants.
     *
     * @param  bool  $sells  False for a books-only tenant (Finance) — it has no
     *                       sales to compare, so the whole panel is skipped
     *                       rather than rendering a row of zeros per site.
     * @return array<int, array{branch_id: string, branch: string, sales_count: int, revenue: float}>
     */
    private function branchBreakdown(Tenant $tenant, CarbonInterface $from, bool $sells = true, ?CarbonInterface $until = null): array
    {
        if (! $sells) {
            return [];
        }

        $branches = Branch::query()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get(['id', 'name']);

        if ($branches->count() < 2) {
            return [];
        }

        // One grouped aggregate, not a query per branch — a chain with 30 sites
        // must not cost 30 round trips on every dashboard load.
        $totals = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->whereIn('status', Takings::COUNTED)
            ->where('sold_at', '>=', $from)
            ->when($until, fn ($q, $end) => $q->where('sold_at', '<=', $end))
            ->whereIn('branch_id', $branches->pluck('id'))
            ->selectRaw('branch_id, COUNT(*) as sales_count, COALESCE(SUM(total), 0) as revenue')
            ->groupBy('branch_id')
            ->get()
            ->keyBy('branch_id');

        return $branches->map(fn ($b) => [
            'branch_id' => $b->id,
            'branch' => $b->name,
            'sales_count' => (int) ($totals[$b->id]->sales_count ?? 0),
            'revenue' => round((float) ($totals[$b->id]->revenue ?? 0), 2),
        ])->all();
    }

    /**
     * Super Admin dashboard: the whole platform in one request.
     *
     * Every figure is a grouped aggregate — nothing loops over tenants or
     * plans issuing queries, because this payload grows with the platform.
     * Tenant-scoped models (Order, Rider) go through withoutTenancy() so a
     * stray tenant context can never narrow a platform-wide number.
     */
    /**
     * @param  bool  $withRevenue  false strips the money — see DashboardController
     * @param  string|null  $from  The period asked about, both ends inclusive —
     * @param  string|null  $to  see DashboardPeriod. With neither it is the
     *                           seven days ending today: a single day of a
     *                           platform paid by the month is mostly noughts.
     */
    public function forPlatform(bool $withRevenue = true, ?string $from = null, ?string $to = null): array
    {
        $now = now();

        // THE PERIOD, on the platform's own calendar — the server's, as every
        // platform figure and the billing ledger's date filter already are.
        // Not a shop's day: the platform is not standing in any shop.
        $period = DashboardPeriod::of($from, $to, $now->toDateString(), 'week');
        $periodStart = Carbon::parse($period->from)->startOfDay();
        $periodEnd = Carbon::parse($period->to)->endOfDay();
        $comparedStart = Carbon::parse($period->comparedFrom)->startOfDay();
        // A period still running is set against the same PART of the one
        // before — up to this hour of its last day. Against the whole of it,
        // every morning would read as a decline.
        $comparedEnd = $period->to === $period->today
            ? Carbon::parse($period->comparedTo)->setTimeFrom($now)
            : Carbon::parse($period->comparedTo)->endOfDay();
        $monthStart = $now->copy()->startOfMonth();
        $prevMonthStart = $monthStart->copy()->subMonth();
        // The same instant one month/one day back — comparing a part-finished
        // period against a whole one would read as a permanent decline.
        $monthAgo = $now->copy()->subMonth();
        $todayStart = $now->copy()->startOfDay();
        $yesterdayStart = $todayStart->copy()->subDay();
        $dayAgo = $now->copy()->subDay();

        // REAL SHOPS ONLY, on every figure below.
        //
        // A demo is a real tenant row handed to a stranger from the landing
        // page and deleted the next day. Counting one as a business overstates
        // the platform, and `new_this_month` was the worst of them: demos are
        // given away from a public page, so a growth figure that includes them
        // is a marketing metric measuring its own landing page.
        //
        // `Tenant::real()` was written for exactly this — its docblock names
        // "every platform figure" — and until now nothing called it. The
        // marketplace fences demos itself, which is why nobody noticed.
        $t = Tenant::query()
            ->real()
            ->selectRaw(implode(', ', [
                'COUNT(*) as total',
                'SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as active',
                'SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as suspended',
                'SUM(CASE WHEN online_shop_enabled = 1 THEN 1 ELSE 0 END) as online_shops',
                'SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as new_this_month',
                'SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) as new_prev_month',
                'SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) as total_last_month',
                'SUM(CASE WHEN subscription_ends_at > ? THEN 1 ELSE 0 END) as live_subs',
                // Subscriptions that were still running a month ago. Status has
                // no history table, so the baseline is "ended after then, and
                // the shop already existed then" — an approximation, but an
                // explainable one.
                'SUM(CASE WHEN subscription_ends_at > ? AND created_at <= ? THEN 1 ELSE 0 END) as live_subs_prev',
                // The period asked about: who joined in it, who joined in the
                // one it is set against, and who was KEPT in it — a shop that
                // began as a demo and was turned into a business.
                'SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) as joined',
                'SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) as joined_before',
                'SUM(CASE WHEN converted_at >= ? AND converted_at <= ? THEN 1 ELSE 0 END) as kept',
            ]), [
                TenantStatus::Active->value,
                TenantStatus::Suspended->value,
                $monthStart,
                $prevMonthStart, $monthStart,
                $monthStart,
                $now,
                $monthAgo, $monthAgo,
                $periodStart, $periodEnd,
                $comparedStart, $comparedEnd,
                $periodStart, $periodEnd,
            ])
            ->toBase()
            ->first();

        $revenue = SubscriptionPayment::query()
            ->selectRaw(
                'SUM(CASE WHEN paid_at >= ? THEN amount ELSE 0 END) as this_month,'
                .' SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN amount ELSE 0 END) as prev_month,'
                .' SUM(CASE WHEN paid_at >= ? AND paid_at <= ? THEN amount ELSE 0 END) as in_period,'
                .' SUM(CASE WHEN paid_at >= ? AND paid_at <= ? THEN 1 ELSE 0 END) as payments,'
                .' SUM(CASE WHEN paid_at >= ? AND paid_at <= ? THEN amount ELSE 0 END) as before_period',
                [
                    $monthStart, $prevMonthStart, $monthStart,
                    $periodStart, $periodEnd,
                    $periodStart, $periodEnd,
                    $comparedStart, $comparedEnd,
                ],
            )
            ->toBase()
            ->first();

        $cancelled = OrderStatus::Cancelled->value;
        $orders = Order::withoutTenancy()
            ->selectRaw(
                'SUM(CASE WHEN placed_at >= ? THEN 1 ELSE 0 END) as today,'
                .' SUM(CASE WHEN placed_at >= ? AND placed_at < ? THEN 1 ELSE 0 END) as yesterday,'
                .' SUM(CASE WHEN placed_at >= ? AND placed_at <= ? THEN 1 ELSE 0 END) as in_period,'
                .' SUM(CASE WHEN placed_at >= ? AND placed_at <= ? THEN 1 ELSE 0 END) as before_period,'
                // What those orders came to — the shops' money, not the
                // platform's. An order that was called off came to nothing.
                .' SUM(CASE WHEN placed_at >= ? AND placed_at <= ? AND status <> ? THEN total ELSE 0 END) as value',
                [
                    $todayStart, $yesterdayStart, $dayAgo,
                    $periodStart, $periodEnd,
                    $comparedStart, $comparedEnd,
                    $periodStart, $periodEnd, $cancelled,
                ],
            )
            ->toBase()
            ->first();

        // People who signed up to BUY — the other side of the marketplace.
        $customers = User::query()
            ->where('role', UserRole::Customer)
            ->selectRaw(
                'SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) as joined,'
                .' SUM(CASE WHEN created_at >= ? AND created_at <= ? THEN 1 ELSE 0 END) as joined_before',
                [$periodStart, $periodEnd, $comparedStart, $comparedEnd],
            )
            ->toBase()
            ->first();

        $riders = Rider::withoutTenancy()
            ->selectRaw(
                'SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,'
                .' SUM(CASE WHEN is_active = 1 AND created_at <= ? THEN 1 ELSE 0 END) as active_prev',
                [$monthAgo],
            )
            ->toBase()
            ->first();

        // Omitted rather than zeroed for staff without `billing.view`. A zero
        // is an answer — and the wrong one; an absent key is the panel's cue to
        // leave the tile and the two revenue panels out altogether.
        $money = $withRevenue ? [
            'revenue_this_month' => $this->kpi(
                round((float) ($revenue->this_month ?? 0), 2),
                round((float) ($revenue->prev_month ?? 0), 2),
            ),
        ] : [];

        return [
            // The period every figure under `in_period` is cut to, and what it
            // was set against — so the screen says both rather than guessing.
            'period' => $period->toArray(),
            // WHAT HAPPENED IN IT. Flows only: each is a count or a sum of
            // things that took place between the two dates, beside the same
            // for the period it is compared with. What the platform IS —
            // shops, subscriptions, riders — is `kpis`, and is always now.
            'in_period' => [
                // The money is withheld exactly as it is everywhere else on
                // this payload: the keys are absent, not zero.
                ...($withRevenue ? [
                    'revenue' => $this->kpi(
                        round((float) ($revenue->in_period ?? 0), 2),
                        round((float) ($revenue->before_period ?? 0), 2),
                    ),
                    'payments' => (int) ($revenue->payments ?? 0),
                ] : []),
                'new_tenants' => $this->kpi((int) ($t->joined ?? 0), (int) ($t->joined_before ?? 0)),
                'kept_from_demo' => (int) ($t->kept ?? 0),
                'online_orders' => $this->kpi((int) ($orders->in_period ?? 0), (int) ($orders->before_period ?? 0)),
                'orders_value' => round((float) ($orders->value ?? 0), 2),
                'new_customers' => $this->kpi((int) ($customers->joined ?? 0), (int) ($customers->joined_before ?? 0)),
            ],
            'tenants' => [
                // Published, not dropped: "how many people are trying it" is a
                // real question, and the answer belongs beside the businesses
                // rather than inside them.
                'demos' => Tenant::query()->demo()->count(),
                'total' => (int) ($t->total ?? 0),
                'active' => (int) ($t->active ?? 0),
                'suspended' => (int) ($t->suspended ?? 0),
                'online_shops' => (int) ($t->online_shops ?? 0),
                'new_this_month' => (int) ($t->new_this_month ?? 0),
            ],
            'kpis' => [
                'total_tenants' => $this->kpi((int) ($t->total ?? 0), (int) ($t->total_last_month ?? 0)),
                'active_subscriptions' => $this->kpi((int) ($t->live_subs ?? 0), (int) ($t->live_subs_prev ?? 0)),
                ...$money,
                'online_orders_today' => $this->kpi((int) ($orders->today ?? 0), (int) ($orders->yesterday ?? 0)),
                'active_riders' => $this->kpi((int) ($riders->active ?? 0), (int) ($riders->active_prev ?? 0)),
                'new_tenants_this_month' => $this->kpi(
                    (int) ($t->new_this_month ?? 0),
                    (int) ($t->new_prev_month ?? 0),
                ),
            ],
            ...($withRevenue ? [
                'revenue_series' => $this->revenueSeries(12),
                'recent_payments' => $this->recentPayments(),
            ] : []),
            'tenant_growth' => $this->tenantGrowth(6),
            'business_types' => $this->businessTypeSpread(),
            'plans' => $this->planSpread($withRevenue),
            'modules' => $this->moduleAdoption(),
            'activity' => $this->recentActivity(),
            'recent_tenants' => Tenant::query()
                ->real()
                ->with('plan:id,name,code')
                ->latest()
                ->limit(5)
                ->get(['id', 'business_name', 'status', 'online_shop_enabled', 'plan_id', 'created_at']),
        ];
    }

    /**
     * One KPI tile: the figure, the period it is measured against, and the
     * change between them.
     *
     * @return array{value: int|float, previous: int|float, delta_pct: float|null}
     */
    private function kpi(int|float $current, int|float $previous): array
    {
        return [
            'value' => $current,
            'previous' => $previous,
            // A prior period with nothing in it is no baseline at all — the UI
            // hides the pill rather than showing an invented "+100%".
            'delta_pct' => $previous > 0
                ? round((($current - $previous) / $previous) * 100, 1)
                : null,
        ];
    }

    /**
     * Subscription revenue per calendar month, zero-filled so the chart has no
     * holes for months nobody paid in.
     *
     * Public because the billing screen draws the same trend, and two copies of
     * "revenue per month" is how two screens end up disagreeing about what the
     * platform earned — the mistake this file's own `summary` docblock is a
     * monument to.
     *
     * @return array<int, array{month: string, ym: string, total: float}>
     */
    public function revenueSeries(int $months): array
    {
        $from = now()->startOfMonth()->subMonths($months - 1);

        $totals = SubscriptionPayment::query()
            ->where('paid_at', '>=', $from)
            ->selectRaw($this->yearMonth('paid_at').' as ym, SUM(amount) as total')
            ->groupBy('ym')
            ->toBase()
            ->pluck('total', 'ym');

        return array_map(fn (array $m): array => [
            'month' => $m['month'],
            'ym' => $m['ym'],
            'total' => round((float) ($totals[$m['ym']] ?? 0), 2),
        ], $this->monthWindow($months));
    }

    /**
     * Sign-ups per month split by where those tenants stand today (status is
     * current, not historical — a shop suspended last week counts as suspended
     * in the month it joined).
     *
     * @return array<int, array{month: string, ym: string, active: int, suspended: int, total: int}>
     */
    private function tenantGrowth(int $months): array
    {
        $from = now()->startOfMonth()->subMonths($months - 1);

        $rows = Tenant::query()
            ->real()
            ->where('created_at', '>=', $from)
            ->selectRaw($this->yearMonth('created_at').' as ym, status, COUNT(*) as tenants')
            ->groupBy('ym', 'status')
            ->toBase()
            ->get();

        return array_map(function (array $m) use ($rows): array {
            $forMonth = $rows->where('ym', $m['ym']);
            $active = (int) $forMonth->where('status', TenantStatus::Active->value)->sum('tenants');
            $suspended = (int) $forMonth->where('status', TenantStatus::Suspended->value)->sum('tenants');

            return [
                'month' => $m['month'],
                'ym' => $m['ym'],
                'active' => $active,
                'suspended' => $suspended,
                'total' => $active + $suspended,
            ];
        }, $this->monthWindow($months));
    }

    /**
     * How the platform's tenants split across business types, biggest first.
     * Only types anyone actually uses appear — a donut of five empty slices
     * says nothing. Labels come from the registry so they never drift.
     *
     * @return array<int, array{type: string|null, label: string, count: int}>
     */
    private function businessTypeSpread(): array
    {
        return Tenant::query()
            ->real()
            ->selectRaw('business_type, COUNT(*) as tenants')
            ->groupBy('business_type')
            ->orderByDesc('tenants')
            ->toBase()
            ->get()
            ->map(fn ($row): array => [
                'type' => $row->business_type,
                'label' => $row->business_type === null
                    ? 'Unspecified'
                    : (BusinessTypes::get($row->business_type)['label'] ?? Str::headline($row->business_type)),
                'count' => (int) $row->tenants,
            ])
            ->all();
    }

    /**
     * Which modules the platform's shops actually run.
     *
     * Modules are assigned per tenant, not bundled into a plan, so the plan
     * ladder no longer says anything about what is being used. This is the only
     * place the platform can see what it is really shipping — and the only
     * warning that a module nobody switches on is being built for nobody.
     *
     * One query. The counting happens in PHP because `features` is a JSON
     * column and no two drivers aggregate inside one the same way.
     *
     * @return array<int, array{key: string, label: string, count: int, share: float}>
     */
    private function moduleAdoption(): array
    {
        $rows = Tenant::query()
            ->real()
            ->where('status', TenantStatus::Active)
            ->toBase()
            ->pluck('features');

        $total = $rows->count();
        $counts = array_fill_keys(array_keys(Modules::all()), 0);

        foreach ($rows as $features) {
            $map = is_array($features) ? $features : (json_decode((string) $features, true) ?: []);

            foreach ($map as $key => $enabled) {
                // A key the registry no longer knows is not a module any more.
                if ($enabled && array_key_exists($key, $counts)) {
                    $counts[$key]++;
                }
            }
        }

        $catalog = Modules::all();

        return collect($counts)
            ->map(fn (int $count, string $key): array => [
                'key' => $key,
                'label' => $catalog[$key]['label'] ?? Str::headline($key),
                'count' => $count,
                // Against ACTIVE tenants: a suspended shop is not running
                // anything, and counting it would flatter every number here.
                'share' => $total > 0 ? round(($count / $total) * 100, 1) : 0.0,
            ])
            ->sortByDesc('count')
            ->values()
            ->all();
    }

    /**
     * Per-plan uptake and takings. Revenue is attributed by the plan each
     * PAYMENT was for, not the payer's current plan — an upgrade must not
     * rewrite last year's takings.
     *
     * @return array<int, array{id: string, name: string, code: string, price: float,
     *                          is_custom: bool, active_tenants: int, revenue: float}>
     */
    /**
     * @param  bool  $withRevenue  false drops the per-plan takings
     *
     * The takings had to be dropped HERE as well as from the KPI tile: this
     * panel is about how tenants are distributed across the ladder, and it was
     * carrying `revenue` per plan alongside. Stripping the headline figure
     * while a table underneath still added up to it would have been the
     * appearance of a gate rather than a gate.
     */
    private function planSpread(bool $withRevenue = true): array
    {
        $plans = Plan::query()->orderBy('name')->get(['id', 'name', 'code', 'price', 'is_custom', 'is_active']);

        $tenantCounts = Tenant::query()
            ->real()
            ->where('status', TenantStatus::Active)
            ->whereNotNull('plan_id')
            ->selectRaw('plan_id, COUNT(*) as tenants')
            ->groupBy('plan_id')
            ->toBase()
            ->pluck('tenants', 'plan_id');

        $revenue = SubscriptionPayment::query()
            ->whereNotNull('plan_id')
            ->selectRaw('plan_id, SUM(amount) as total')
            ->groupBy('plan_id')
            ->toBase()
            ->pluck('total', 'plan_id');

        return $plans
            ->map(fn (Plan $plan): array => [
                'id' => $plan->id,
                'name' => $plan->name,
                'code' => $plan->code,
                'price' => round((float) $plan->price, 2),
                // A bespoke enterprise deal is not part of the ladder and must
                // not be read as one.
                'is_custom' => (bool) $plan->is_custom,
                'is_active' => (bool) $plan->is_active,
                'active_tenants' => (int) ($tenantCounts[$plan->id] ?? 0),
                ...($withRevenue ? ['revenue' => round((float) ($revenue[$plan->id] ?? 0), 2)] : []),
            ])
            // A retired plan that still holds tenants or took money stays —
            // that is a real obligation. One that never did anything is just
            // a card in the way.
            ->filter(fn (array $p): bool => $p['is_active'] || $p['active_tenants'] > 0 || $p['revenue'] > 0)
            ->sortByDesc('active_tenants')
            ->values()
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function recentPayments(): array
    {
        return SubscriptionPayment::query()
            ->with('tenant:id,business_name')
            ->latest('paid_at')
            ->limit(5)
            ->get()
            ->map(fn (SubscriptionPayment $p): array => [
                'id' => $p->id,
                'tenant' => $p->tenant?->business_name,
                'tenant_id' => $p->tenant_id,
                'plan_name' => $p->plan_name,
                'amount' => round((float) $p->amount, 2),
                'currency' => $p->currency,
                'method' => $p->method,
                // The ledger is written only when money has actually been
                // recorded — there is no gateway and so no pending/failed
                // state. Sent as a field anyway so the UI's status pill has
                // something real to bind to.
                'status' => 'paid',
                'reference' => $p->reference,
                'period_start' => $p->period_start?->toDateString(),
                'period_end' => $p->period_end?->toDateString(),
                'paid_at' => $p->paid_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * Platform timeline. `at` is always a real ISO-8601 instant so the UI can
     * format it — never a bare or partial date string.
     *
     * @return array<int, array<string, mixed>>
     */
    private function recentActivity(): array
    {
        return AuditLog::query()
            ->with('user:id,name,email')
            ->latest('created_at')
            ->limit(8)
            ->get()
            ->map(fn (AuditLog $log): array => [
                'id' => $log->id,
                'actor' => $log->user?->name ?? 'System',
                'action' => $log->event,
                'subject' => class_basename($log->auditable_type),
                'subject_id' => $log->auditable_id,
                'tenant_id' => $log->tenant_id,
                'at' => $log->created_at?->toIso8601String(),
            ])
            ->all();
    }

    /**
     * The last N calendar months, oldest first: the chart's x-axis, built in
     * PHP so a month with no rows still gets a bucket.
     *
     * @return array<int, array{ym: string, month: string}>
     */
    private function monthWindow(int $months): array
    {
        $cursor = now()->startOfMonth()->subMonths($months - 1);
        $window = [];

        for ($i = 0; $i < $months; $i++) {
            $window[] = ['ym' => $cursor->format('Y-m'), 'month' => $cursor->format('M')];
            $cursor = $cursor->addMonth();
        }

        return $window;
    }

    /**
     * "2026-01" from a timestamp column. MySQL runs production, SQLite runs
     * the tests, and neither spells this the same way.
     */
    private function yearMonth(string $column): string
    {
        return match (DB::connection()->getDriverName()) {
            'sqlite' => "strftime('%Y-%m', {$column})",
            'pgsql' => "to_char({$column}, 'YYYY-MM')",
            default => "DATE_FORMAT({$column}, '%Y-%m')",
        };
    }
}
