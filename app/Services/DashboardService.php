<?php

namespace App\Services;

use App\Enums\ReservationStatus;
use App\Enums\SaleStatus;
use App\Enums\TenantStatus;
use App\Models\AuditLog;
use App\Models\Expense;
use App\Models\Order;
use App\Models\HeldSale;
use App\Models\Plan;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Reservation;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Support\BusinessTypes;
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
     *                                  branch, or null for the whole tenant
     *                                  (an owner's All-Branches HQ view).
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

        $revenue = $salesByDay[$today]['revenue'] ?? 0.0;
        $expensesToday = $expensesByDay[$today] ?? 0.0;
        // Net profit: revenue − cost of goods (line snapshots) − expenses.
        $profit = $revenue - ($cogsByDay[$today] ?? 0.0) - $expensesToday;

        $prevRevenue = $salesByDay[$yesterday]['revenue'] ?? 0.0;
        $prevExpenses = $expensesByDay[$yesterday] ?? 0.0;
        $prevProfit = $prevRevenue - ($cogsByDay[$yesterday] ?? 0.0) - $prevExpenses;

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
            // Batches (medicine/perishable lots) expiring within 30 days —
            // includes already-expired stock still on hand. Branch-scoped.
            'expiring_soon_count' => $expiringSoon,
            'products_count' => $hasCatalog
                ? Product::query()
                    ->where('tenant_id', $tenant->id)
                    ->where('is_active', true)
                    ->count()
                : 0,
            // Last 7 days, oldest first, zero-filled — the line chart never has
            // a hole for a day the shop was shut.
            'sales_series' => $this->salesSeries($weekStart, $salesByDay, $cogsByDay, $expensesByDay),
            // This month's spend per category — the donut beside the chart.
            'expense_breakdown' => $keepsBooks ? $this->expenseBreakdown($tenant, $branchId, $monthStart) : [],
            'inventory' => [
                'low_stock' => $lowStock,
                'out_of_stock' => $tracksStock ? $this->outOfStockCount($tenant, $branchId) : 0,
                'expiring_soon' => $expiringSoon,
                'pending_pos' => $tenant->featureEnabled('pos') ? $this->parkedTicketCount($tenant, $branchId) : 0,
            ],
            'order_pipeline' => $takesOrders ? $this->orderPipeline($tenant) : $this->emptyPipeline(),
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
    private function dailySales(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $from): array
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
    private function dailyCogs(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $from): array
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
    private function dailyExpenses(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $from): array
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
     * The 7-day chart, built in PHP from the rollups so a day with no trade
     * still gets a point.
     *
     * @param  array<string, array{sales_count: int, revenue: float, customers_count: int}>  $salesByDay
     * @param  array<string, float>  $cogsByDay
     * @param  array<string, float>  $expensesByDay
     * @return array<int, array{day: string, date: string, revenue: float, expenses: float, profit: float}>
     */
    private function salesSeries(
        \Illuminate\Support\Carbon $from,
        array $salesByDay,
        array $cogsByDay,
        array $expensesByDay,
    ): array {
        $series = [];
        $cursor = $from->copy();

        for ($i = 0; $i < 7; $i++) {
            $key = $cursor->toDateString();
            $revenue = $salesByDay[$key]['revenue'] ?? 0.0;
            $expenses = $expensesByDay[$key] ?? 0.0;

            $series[] = [
                'day' => $cursor->format('D'),
                'date' => $key,
                'revenue' => round($revenue, 2),
                'expenses' => round($expenses, 2),
                // Same definition as today's profit tile, so the last point of
                // the chart always equals the number in the tile.
                'profit' => round($revenue - ($cogsByDay[$key] ?? 0.0) - $expenses, 2),
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
    private function expenseBreakdown(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): array
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
        if ($branchId === null) {
            return Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('track_inventory', true)
                ->whereNotNull('low_stock_threshold')
                ->whereColumn('stock_quantity', '<=', 'low_stock_threshold')
                ->count();
        }

        return Product::query()
            ->where('products.tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->whereNotNull('low_stock_threshold')
            ->leftJoin('branch_stock', function ($join) use ($branchId): void {
                $join->on('branch_stock.product_id', '=', 'products.id')
                    ->whereNull('branch_stock.variant_id')
                    ->where('branch_stock.branch_id', '=', $branchId);
            })
            ->whereRaw('COALESCE(branch_stock.quantity, 0) <= products.low_stock_threshold')
            ->count();
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
            ->expiringWithin(30)
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
    private function topProduct(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): ?array
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
    private function topCategory(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): ?array
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
    private function topCustomer(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): ?array
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
    private function topStaff(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): ?array
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
    private function monthlySales(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): \Illuminate\Database\Eloquent\Builder
    {
        return Sale::query()
            ->where('sales.tenant_id', $tenant->id)
            ->where('sales.status', SaleStatus::Completed)
            ->where('sales.sold_at', '>=', $monthStart)
            ->when($branchId, fn ($q, $b) => $q->where('sales.branch_id', $b));
    }

    /** This month's sold lines (see dailyCogs() on the hand-written soft-delete filter). */
    private function monthlyLineItems(Tenant $tenant, ?string $branchId, \Illuminate\Support\Carbon $monthStart): \Illuminate\Database\Eloquent\Builder
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
    private function branchBreakdown(Tenant $tenant, \Illuminate\Support\Carbon $todayStart, bool $sells = true): array
    {
        if (! $sells) {
            return [];
        }

        $branches = \App\Models\Branch::query()
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
    public function forPlatform(): array
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
                'revenue_this_month' => $this->kpi(
                    round((float) ($revenue->this_month ?? 0), 2),
                    round((float) ($revenue->prev_month ?? 0), 2),
                ),
                'online_orders_today' => $this->kpi((int) ($orders->today ?? 0), (int) ($orders->yesterday ?? 0)),
                'active_riders' => $this->kpi((int) ($riders->active ?? 0), (int) ($riders->active_prev ?? 0)),
                'new_tenants_this_month' => $this->kpi(
                    (int) ($t->new_this_month ?? 0),
                    (int) ($t->new_prev_month ?? 0),
                ),
            ],
            'revenue_series' => $this->revenueSeries(12),
            'tenant_growth' => $this->tenantGrowth(6),
            'business_types' => $this->businessTypeSpread(),
            'plans' => $this->planSpread(),
            'recent_payments' => $this->recentPayments(),
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
     * @return array<int, array{month: string, ym: string, total: float}>
     */
    private function revenueSeries(int $months): array
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
     * Per-plan uptake and takings. Revenue is attributed by the plan each
     * PAYMENT was for, not the payer's current plan — an upgrade must not
     * rewrite last year's takings.
     *
     * @return array<int, array{id: string, name: string, code: string, active_tenants: int, revenue: float}>
     */
    private function planSpread(): array
    {
        $plans = Plan::query()->orderBy('name')->get(['id', 'name', 'code']);

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
                'active_tenants' => (int) ($tenantCounts[$plan->id] ?? 0),
                'revenue' => round((float) ($revenue[$plan->id] ?? 0), 2),
            ])
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
