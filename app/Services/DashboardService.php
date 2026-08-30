<?php

namespace App\Services;

use App\Enums\ReservationStatus;
use App\Enums\RestaurantTicketStatus;
use App\Enums\SaleStatus;
use App\Enums\TenantStatus;
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
use App\Models\PurchaseOrder;
use App\Models\Reservation;
use App\Models\RestaurantTicket;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\SaleDocument;
use App\Models\SaleItem;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\LowStock;
use App\Support\Modules;
use App\Support\Payable;
use App\Support\ShopSettings;
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
     */
    public function forTenant(Tenant $tenant, ?string $branchId = null): array
    {
        $todayStart = now()->startOfDay();
        $weekStart = $todayStart->copy()->subDays(6);        // 7 buckets, today last
        $monthStart = $todayStart->copy()->startOfMonth();
        $today = $todayStart->toDateString();
        $yesterday = $todayStart->copy()->subDay()->toDateString();

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

        // Three grouped rollups cover the whole 7-day window. Today's tiles,
        // yesterday's deltas and the chart series all read from these arrays,
        // so those panels can never contradict one another.
        $salesByDay = $sells ? $this->dailySales($tenant, $branchId, $weekStart) : [];
        $cogsByDay = $sells ? $this->dailyCogs($tenant, $branchId, $weekStart) : [];
        // Expenses are branch-scoped: a focused branch deducts only its own
        // costs; the all-branches view (branchId null) sums the whole tenant.
        $expensesByDay = $keepsBooks ? $this->dailyExpenses($tenant, $branchId, $weekStart) : [];
        $incomeByDay = $keepsBooks ? $this->dailyIncome($tenant, $branchId, $weekStart) : [];

        $revenue = $salesByDay[$today]['revenue'] ?? 0.0;
        $expensesToday = $expensesByDay[$today] ?? 0.0;
        $incomeToday = $incomeByDay[$today] ?? 0.0;
        // Net profit: everything that came in (sales AND non-sale income)
        // − cost of goods (line snapshots) − expenses. Leaving income out made
        // this the Cashbook's answer minus the whole of what the business
        // earned — for a books-only tenant, a permanent loss.
        $profit = $revenue + $incomeToday - ($cogsByDay[$today] ?? 0.0) - $expensesToday;

        $prevRevenue = $salesByDay[$yesterday]['revenue'] ?? 0.0;
        $prevExpenses = $expensesByDay[$yesterday] ?? 0.0;
        $prevIncome = $incomeByDay[$yesterday] ?? 0.0;
        $prevProfit = $prevRevenue + $prevIncome - ($cogsByDay[$yesterday] ?? 0.0) - $prevExpenses;

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
            // Last 7 days, oldest first, zero-filled — the line chart never has
            // a hole for a day the shop was shut.
            'sales_series' => $this->salesSeries($weekStart, $salesByDay, $cogsByDay, $expensesByDay, $incomeByDay),
            // This month's spend per category — the donut beside the chart.
            'expense_breakdown' => $keepsBooks ? $this->expenseBreakdown($tenant, $branchId, $monthStart) : [],
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
            'till' => $tenant->featureEnabled('pos') ? $this->tillToday($tenant, $branchId, $todayStart) : null,
            // Who owes whom. An owner asks this straight after "what did I
            // take", and until now the dashboard could not answer it at all.
            'money_owed' => [
                'receivable' => $sells ? $this->receivable($tenant) : ['total' => 0.0, 'accounts' => 0],
                'payable' => $tracksStock ? $this->payable($tenant) : ['total' => 0.0, 'accounts' => 0],
            ],
            'recent_sales' => $sells ? $this->recentSales($tenant, $branchId) : [],
            'recent_expenses' => $keepsBooks ? $this->recentExpenses($tenant, $branchId) : [],
            // This month's leaders by revenue. Each is nullable: a shop that
            // sold nothing, or only to walk-ins, genuinely has no top customer.
            'highlights' => [
                'top_product' => $sells ? $this->topProduct($tenant, $branchId, $monthStart) : null,
                'top_category' => $sells ? $this->topCategory($tenant, $branchId, $monthStart) : null,
                'top_customer' => $sells ? $this->topCustomer($tenant, $branchId, $monthStart) : null,
                'top_staff' => $sells ? $this->topStaff($tenant, $branchId, $monthStart) : null,
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
                ? $this->dispensingToday($tenant, $branchId, $todayStart)
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
            // HQ comparison: today's sales per branch. Only for multi-branch
            // tenants (a single-shop owner gets an empty array, no HQ panel).
            'branches' => $this->branchBreakdown($tenant, $todayStart, $sells),
        ];
    }

    /**
     * Completed sales bucketed by DAY over the window: one grouped query that
     * feeds today's tiles, yesterday's deltas and the 7-day chart.
     *
     * @return array<string, array{sales_count: int, revenue: float, customers_count: int}>
     */
    private function dailySales(Tenant $tenant, ?string $branchId, Carbon $from): array
    {
        $day = $this->dayExpression('sold_at');

        return Sale::query()
            ->where('tenant_id', $tenant->id)
            ->where('status', SaleStatus::Completed)
            ->where('sold_at', '>=', $from)
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
    private function dailyCogs(Tenant $tenant, ?string $branchId, Carbon $from): array
    {
        $day = $this->dayExpression('sales.sold_at');

        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereNull('sales.deleted_at')
            ->where('sales.status', SaleStatus::Completed)
            ->where('sales.sold_at', '>=', $from)
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
    private function dailyExpenses(Tenant $tenant, ?string $branchId, Carbon $from): array
    {
        $day = $this->dayExpression('expense_date');

        return Expense::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->where('expense_date', '>=', $from->toDateString())
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
    private function dailyIncome(Tenant $tenant, ?string $branchId, Carbon $from): array
    {
        $day = $this->dayExpression('income_date');

        return Income::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('branch_id', $b))
            ->where('income_date', '>=', $from->toDateString())
            ->selectRaw("{$day} as day, COALESCE(SUM(amount), 0) as total")
            ->groupByRaw($day)
            ->toBase()
            ->get()
            ->mapWithKeys(fn ($row): array => [$row->day => (float) $row->total])
            ->all();
    }

    /**
     * The 7-day chart, built in PHP from the rollups so a day with no trade
     * still gets a point.
     *
     * @param  array<string, array{sales_count: int, revenue: float, customers_count: int}>  $salesByDay
     * @param  array<string, float>  $cogsByDay
     * @param  array<string, float>  $expensesByDay
     * @param  array<string, float>  $incomeByDay
     * @return array<int, array{day: string, date: string, revenue: float, other_income: float, expenses: float, profit: float}>
     */
    private function salesSeries(
        Carbon $from,
        array $salesByDay,
        array $cogsByDay,
        array $expensesByDay,
        array $incomeByDay,
    ): array {
        $series = [];
        $cursor = $from->copy();

        for ($i = 0; $i < 7; $i++) {
            $key = $cursor->toDateString();
            $revenue = $salesByDay[$key]['revenue'] ?? 0.0;
            $expenses = $expensesByDay[$key] ?? 0.0;
            $otherIncome = $incomeByDay[$key] ?? 0.0;

            $series[] = [
                'day' => $cursor->format('D'),
                'date' => $key,
                'revenue' => round($revenue, 2),
                'other_income' => round($otherIncome, 2),
                'expenses' => round($expenses, 2),
                // Same definition as today's profit tile, so the last point of
                // the chart always equals the number in the tile.
                'profit' => round($revenue + $otherIncome - ($cogsByDay[$key] ?? 0.0) - $expenses, 2),
            ];

            $cursor = $cursor->addDay();
        }

        return $series;
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
     * This month's expenses per category, biggest first.
     *
     * @return array<int, array{category: string, total: float}>
     */
    private function expenseBreakdown(Tenant $tenant, ?string $branchId, Carbon $monthStart): array
    {
        return Expense::withoutTenancy()
            ->where('expenses.tenant_id', $tenant->id)
            ->when($branchId, fn ($q, $b) => $q->where('expenses.branch_id', $b))
            ->where('expenses.expense_date', '>=', $monthStart->toDateString())
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
    private function tillToday(Tenant $tenant, ?string $branchId, Carbon $todayStart): array
    {
        $today = $todayStart->toDateString();

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
        $todayDays = $openDays->filter(fn (BusinessDay $d): bool => $d->trading_date->toDateString() === $today);
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
        $row = Payable::billable(PurchaseOrder::withoutTenancy())
            ->where('tenant_id', $tenant->id)
            ->whereColumn('amount_paid', '<', 'total')
            ->selectRaw('COALESCE(SUM(total - amount_paid), 0) as owed, COUNT(DISTINCT supplier_id) as accounts')
            ->toBase()
            ->first();

        return [
            'total' => round((float) ($row->owed ?? 0), 2),
            'accounts' => (int) ($row->accounts ?? 0),
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
    private function topProduct(Tenant $tenant, ?string $branchId, Carbon $monthStart): ?array
    {
        $row = $this->monthlyLineItems($tenant, $branchId, $monthStart)
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
    private function topCategory(Tenant $tenant, ?string $branchId, Carbon $monthStart): ?array
    {
        // Left joins throughout: a line whose product (or whose product's
        // category) has since been deleted still sold, and belongs somewhere.
        $row = $this->monthlyLineItems($tenant, $branchId, $monthStart)
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
    private function topCustomer(Tenant $tenant, ?string $branchId, Carbon $monthStart): ?array
    {
        $row = $this->monthlySales($tenant, $branchId, $monthStart)
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
    private function topStaff(Tenant $tenant, ?string $branchId, Carbon $monthStart): ?array
    {
        $row = $this->monthlySales($tenant, $branchId, $monthStart)
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
     * This month's completed sales, fully qualified so the highlight queries can
     * join tables that carry their own `status` / `name` columns.
     */
    private function monthlySales(Tenant $tenant, ?string $branchId, Carbon $monthStart): Builder
    {
        return Sale::query()
            ->where('sales.tenant_id', $tenant->id)
            ->where('sales.status', SaleStatus::Completed)
            ->where('sales.sold_at', '>=', $monthStart)
            ->when($branchId, fn ($q, $b) => $q->where('sales.branch_id', $b));
    }

    /** This month's sold lines (see dailyCogs() on the hand-written soft-delete filter). */
    private function monthlyLineItems(Tenant $tenant, ?string $branchId, Carbon $monthStart): Builder
    {
        return SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->where('sale_items.tenant_id', $tenant->id)
            ->whereNull('sales.deleted_at')
            ->where('sales.status', SaleStatus::Completed)
            ->where('sales.sold_at', '>=', $monthStart)
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

        $openTabs = RestaurantTicket::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->where('status', RestaurantTicketStatus::Open->value);

        // Fired and not yet served. `ready_at` splits the two states a kitchen
        // actually distinguishes: still cooking, versus sitting under the lamp
        // waiting for someone to run it — the second is the one that gets cold.
        // `forAnOpenTab` — the same rule the pass reads. Without it this counted
        // every un-served docket ever fired, so the number an owner reads to
        // know what the kitchen owes grew by one for every tab anybody had ever
        // cancelled and never came down.
        $kots = KitchenTicket::query()
            ->where('tenant_id', $tenant->id)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->forAnOpenTab()
            ->whereNull('served_at');

        return [
            'tables' => (int) $tables->count(),
            'occupied' => (int) (clone $tables)->whereHas('openTicket')->count(),
            'open_tabs' => (int) $openTabs->count(),
            'kot_waiting' => (int) (clone $kots)->whereNull('ready_at')->count(),
            'kot_ready' => (int) (clone $kots)->whereNotNull('ready_at')->count(),
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
    private function dispensingToday(Tenant $tenant, ?string $branchId, Carbon $todayStart): array
    {
        $rx = Sale::query()
            ->where('tenant_id', $tenant->id)
            ->where('status', SaleStatus::Completed->value)
            ->whereNotNull('prescription_number')
            ->where('prescription_number', '!=', '')
            ->where('sold_at', '>=', $todayStart)
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
    private function branchBreakdown(Tenant $tenant, Carbon $todayStart, bool $sells = true): array
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
            ->where('status', SaleStatus::Completed)
            ->where('sold_at', '>=', $todayStart)
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
     */
    public function forPlatform(bool $withRevenue = true): array
    {
        $now = now();
        $monthStart = $now->copy()->startOfMonth();
        $prevMonthStart = $monthStart->copy()->subMonth();
        // The same instant one month/one day back — comparing a part-finished
        // period against a whole one would read as a permanent decline.
        $monthAgo = $now->copy()->subMonth();
        $todayStart = $now->copy()->startOfDay();
        $yesterdayStart = $todayStart->copy()->subDay();
        $dayAgo = $now->copy()->subDay();

        $t = Tenant::query()
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
            ]), [
                TenantStatus::Active->value,
                TenantStatus::Suspended->value,
                $monthStart,
                $prevMonthStart, $monthStart,
                $monthStart,
                $now,
                $monthAgo, $monthAgo,
            ])
            ->toBase()
            ->first();

        $revenue = SubscriptionPayment::query()
            ->selectRaw(
                'SUM(CASE WHEN paid_at >= ? THEN amount ELSE 0 END) as this_month,'
                .' SUM(CASE WHEN paid_at >= ? AND paid_at < ? THEN amount ELSE 0 END) as prev_month',
                [$monthStart, $prevMonthStart, $monthStart],
            )
            ->toBase()
            ->first();

        $orders = Order::withoutTenancy()
            ->selectRaw(
                'SUM(CASE WHEN placed_at >= ? THEN 1 ELSE 0 END) as today,'
                .' SUM(CASE WHEN placed_at >= ? AND placed_at < ? THEN 1 ELSE 0 END) as yesterday',
                [$todayStart, $yesterdayStart, $dayAgo],
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
            'tenants' => [
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
