<?php

namespace App\Services;

use App\Enums\SaleStatus;
use App\Models\Expense;
use App\Models\Income;
use App\Models\PurchaseOrder;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
use App\Models\SupplierPayment;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Business reports over a date range.
 *
 * Edge cases:
 *  - sales crossing midnight → bucketed by the DATE of sold_at, so a 23:59
 *    sale belongs to that day, a 00:01 sale to the next
 *  - cancelled sales and soft-deleted expenses are always excluded
 *  - empty ranges return zeroed series (no missing-day holes in charts)
 */
class ReportService
{
    /**
     * @return array{from: string, to: string, granularity: string}
     */
    public function resolvePeriod(string $period, ?string $from, ?string $to): array
    {
        $today = CarbonImmutable::today();

        return match ($period) {
            'daily' => ['from' => $today->toDateString(), 'to' => $today->toDateString(), 'granularity' => 'day'],
            'weekly' => ['from' => $today->startOfWeek()->toDateString(), 'to' => $today->endOfWeek()->toDateString(), 'granularity' => 'day'],
            'monthly' => ['from' => $today->startOfMonth()->toDateString(), 'to' => $today->endOfMonth()->toDateString(), 'granularity' => 'day'],
            'yearly' => ['from' => $today->startOfYear()->toDateString(), 'to' => $today->endOfYear()->toDateString(), 'granularity' => 'month'],
            default => [
                'from' => $from ?? $today->startOfMonth()->toDateString(),
                'to' => $to ?? $today->toDateString(),
                'granularity' => 'day',
            ],
        };
    }

    public function summary(string $tenantId, ?string $branchId, string $from, string $to, string $granularity = 'day'): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $completedSales = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        $salesCount = (clone $completedSales)->count();
        $revenue = (float) (clone $completedSales)->sum('total');

        // A line has no branch of its own; it inherits the sale's.
        $cogs = (float) SaleItem::query()
            ->where('sale_items.tenant_id', $tenantId)
            ->whereHas('sale', fn ($q) => $q
                ->where('status', SaleStatus::Completed)
                ->whereBetween('sold_at', [$fromStart, $toEnd])
                ->when($branchId, fn ($q) => $q->where('branch_id', $branchId)))
            ->selectRaw('COALESCE(SUM(unit_cost * quantity), 0) as cogs')
            ->value('cogs');

        $expensesTotal = (float) Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->sum('amount');

        // Money the business took in that wasn't a sale — a retainer, an owner's
        // injection, a supplier refund. It was missing from this total while the
        // Cashbook counted it, so the two screens answered the same question
        // differently: a books-only tenant with a paid invoice and a rent bill
        // was told its net was MINUS the rent. Same rule as the Cashbook —
        // sales revenue is derived and never sits in `incomes`, so adding the
        // two can't double-count.
        $otherIncome = (float) Income::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('income_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->sum('amount');

        return [
            'period' => ['from' => $from, 'to' => $to, 'granularity' => $granularity],
            'totals' => [
                'sales_count' => $salesCount,
                'revenue' => round($revenue, 2),
                'other_income' => round($otherIncome, 2),
                'cogs' => round($cogs, 2),
                'gross_profit' => round($revenue - $cogs, 2),
                'expenses' => round($expensesTotal, 2),
                'net_profit' => round($revenue + $otherIncome - $cogs - $expensesTotal, 2),
            ],
            'series' => $this->series($tenantId, $branchId, $fromStart, $toEnd, $granularity),
            'top_products' => $this->topProducts($tenantId, $branchId, $fromStart, $toEnd),
            'expenses_by_category' => $this->expensesByCategory($tenantId, $branchId, $from, $to),
        ];
    }

    /**
     * Zero-filled buckets — charts never have holes.
     */
    private function series(string $tenantId, ?string $branchId, CarbonImmutable $from, CarbonImmutable $to, string $granularity): array
    {
        $format = $granularity === 'month' ? 'Y-m' : 'Y-m-d';

        $revenueByBucket = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$from, $to])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['sold_at', 'total'])
            ->groupBy(fn (Sale $s) => $s->sold_at->format($format))
            ->map(fn (Collection $sales) => round((float) $sales->sum('total'), 2));

        $expensesByBucket = Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from->toDateString().' 00:00:00', $to->toDateString().' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['expense_date', 'amount'])
            ->groupBy(fn (Expense $e) => $e->expense_date->format($format))
            ->map(fn (Collection $items) => round((float) $items->sum('amount'), 2));

        // Non-sale money in, bucketed the same way. Without it a books-only
        // chart was a single expense line — everything the business earned was
        // simply absent from the picture.
        $incomeByBucket = Income::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('income_date', [$from->toDateString().' 00:00:00', $to->toDateString().' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['income_date', 'amount'])
            ->groupBy(fn (Income $i) => $i->income_date->format($format))
            ->map(fn (Collection $items) => round((float) $items->sum('amount'), 2));

        $buckets = [];
        $cursor = $from;

        while ($cursor <= $to) {
            $key = $cursor->format($format);
            $revenue = $revenueByBucket[$key] ?? 0.0;
            $expenses = $expensesByBucket[$key] ?? 0.0;
            $otherIncome = $incomeByBucket[$key] ?? 0.0;
            $buckets[] = [
                'date' => $key,
                'revenue' => $revenue,
                'other_income' => $otherIncome,
                'expenses' => $expenses,
                // Cash-shaped, deliberately: this is the line a chart draws, so
                // it nets what MOVED in the bucket. The headline `net_profit`
                // also deducts cost of goods, which no per-day bucket carries.
                'profit' => round($revenue + $otherIncome - $expenses, 2),
            ];
            $cursor = $granularity === 'month' ? $cursor->addMonth() : $cursor->addDay();
        }

        return $buckets;
    }

    private function topProducts(string $tenantId, ?string $branchId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        return SaleItem::query()
            ->where('sale_items.tenant_id', $tenantId)
            ->whereHas('sale', fn ($q) => $q
                ->where('status', SaleStatus::Completed)
                ->whereBetween('sold_at', [$from, $to])
                ->when($branchId, fn ($q) => $q->where('branch_id', $branchId)))
            ->selectRaw('product_name, COALESCE(variant_name, "") as variant_name, SUM(quantity) as units, SUM(line_total) as revenue')
            ->groupBy('product_name', 'variant_name')
            ->orderByDesc('revenue')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'name' => $row->variant_name ? "{$row->product_name} / {$row->variant_name}" : $row->product_name,
                'units' => (int) $row->units,
                'revenue' => round((float) $row->revenue, 2),
            ])
            ->all();
    }

    /**
     * What each item actually earned.
     *
     * Revenue alone crowns whatever is expensive; margin crowns what pays. A
     * shop's best-selling line and its most profitable line are frequently not
     * the same item, and only one of those facts changes what you buy next.
     *
     * Costs come from the LINE snapshot, not today's price list — a product
     * repriced last week must not rewrite last month's margin.
     *
     * @return array<string, mixed>
     */
    public function margins(string $tenantId, ?string $branchId, string $from, string $to, int $limit = 50): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $rows = SaleItem::query()
            ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
            ->leftJoin('products', 'products.id', '=', 'sale_items.product_id')
            ->leftJoin('categories', 'categories.id', '=', 'products.category_id')
            ->where('sale_items.tenant_id', $tenantId)
            ->whereNull('sales.deleted_at')
            ->where('sales.status', SaleStatus::Completed)
            ->whereBetween('sales.sold_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('sales.branch_id', $branchId))
            ->groupBy('sale_items.product_name', 'sale_items.variant_name', 'category_name')
            ->selectRaw(implode(', ', [
                'sale_items.product_name as product_name',
                'sale_items.variant_name as variant_name',
                "COALESCE(categories.name, 'Uncategorized') as category_name",
                'SUM(sale_items.quantity) as units',
                'SUM(sale_items.line_total) as revenue',
                'SUM(sale_items.unit_cost * sale_items.quantity) as cogs',
            ]))
            ->get();

        $items = $rows
            ->map(function ($row): array {
                $revenue = round((float) $row->revenue, 2);
                $cogs = round((float) $row->cogs, 2);
                $profit = round($revenue - $cogs, 2);

                return [
                    'name' => $row->variant_name
                        ? "{$row->product_name} / {$row->variant_name}"
                        : $row->product_name,
                    'category' => $row->category_name,
                    'units' => round((float) $row->units, 3),
                    'revenue' => $revenue,
                    'cogs' => $cogs,
                    'profit' => $profit,
                    // Null, not zero, when nothing was taken: there is no
                    // margin on a giveaway, and 0% would read as break-even.
                    'margin_pct' => $revenue > 0 ? round(($profit / $revenue) * 100, 1) : null,
                ];
            })
            ->sortByDesc('profit')
            ->values();

        $byCategory = $rows
            ->groupBy('category_name')
            ->map(function (Collection $group, string $category): array {
                $revenue = round((float) $group->sum(fn ($r) => (float) $r->revenue), 2);
                $cogs = round((float) $group->sum(fn ($r) => (float) $r->cogs), 2);

                return [
                    'category' => $category,
                    'revenue' => $revenue,
                    'cogs' => $cogs,
                    'profit' => round($revenue - $cogs, 2),
                    'margin_pct' => $revenue > 0 ? round((($revenue - $cogs) / $revenue) * 100, 1) : null,
                ];
            })
            ->sortByDesc('profit')
            ->values()
            ->all();

        $revenue = round((float) $items->sum('revenue'), 2);
        $cogs = round((float) $items->sum('cogs'), 2);

        return [
            'period' => ['from' => $from, 'to' => $to],
            'totals' => [
                'revenue' => $revenue,
                'cogs' => $cogs,
                'profit' => round($revenue - $cogs, 2),
                'margin_pct' => $revenue > 0 ? round((($revenue - $cogs) / $revenue) * 100, 1) : null,
            ],
            'best' => $items->take($limit)->all(),
            // Sold at a loss. Usually a costing mistake rather than a decision,
            // and it is invisible in any report ranked by revenue.
            'losing' => $items->filter(fn (array $i): bool => $i['profit'] < 0)
                ->sortBy('profit')
                ->take($limit)
                ->values()
                ->all(),
            'by_category' => $byCategory,
        ];
    }

    /**
     * Purchases report: what was ordered/received/paid and what's outstanding,
     * plus a per-supplier breakdown. Cancelled POs excluded.
     *
     * Deliberately tenant-wide, unlike every other report here. `purchase_orders`
     * has no branch column — an order is raised against a SUPPLIER, and the
     * goods can be received anywhere. Inventing a branch for it (from the
     * receiving line, say) would answer a question nobody asked and would make
     * per-branch purchase totals disagree with the supplier's own statement.
     * If per-branch buying is ever wanted it needs a column and a decision,
     * not a filter bolted on here.
     */
    public function purchases(string $tenantId, string $from, string $to): array
    {
        // Bound the window at whole-day edges (like every other report). Passing
        // the bare date strings [$from, $to] excludes rows ON the last day:
        // the date-cast column stores "…-31 00:00:00", which sorts AFTER the
        // bare "…-31" upper bound — so a PO dated on the period's final day
        // silently vanished (only visible on the last day of a month/period).
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $base = PurchaseOrder::withoutTenancy()
            ->where('purchase_orders.tenant_id', $tenantId)
            ->where('purchase_orders.status', '!=', 'cancelled')
            ->whereBetween('purchase_orders.order_date', [$fromStart, $toEnd]);

        $ordered = (float) (clone $base)->sum('total');
        $paid = (float) (clone $base)->sum('amount_paid');

        $bySupplier = (clone $base)
            ->leftJoin('suppliers', 'purchase_orders.supplier_id', '=', 'suppliers.id')
            ->selectRaw('COALESCE(suppliers.name, "Unknown") as supplier, COUNT(*) as orders, SUM(purchase_orders.total) as total, SUM(purchase_orders.total - purchase_orders.amount_paid) as outstanding')
            ->groupBy('supplier')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($r) => [
                'supplier' => $r->supplier,
                'orders' => (int) $r->orders,
                'total' => round((float) $r->total, 2),
                'outstanding' => round((float) $r->outstanding, 2),
            ])->all();

        return [
            'period' => ['from' => $from, 'to' => $to],
            'totals' => [
                'orders' => (clone $base)->count(),
                'ordered_value' => round($ordered, 2),
                'paid' => round($paid, 2),
                'outstanding' => round($ordered - $paid, 2),
            ],
            'by_supplier' => $bySupplier,
        ];
    }

    /**
     * Staff performance: completed sales grouped by the staff who rang them up.
     */
    public function staffPerformance(string $tenantId, ?string $branchId, string $from, string $to): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $rows = Sale::query()
            ->where('sales.tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('sales.branch_id', $branchId))
            ->whereNotNull('created_by')
            ->selectRaw('created_by, COUNT(*) as sales_count, SUM(total) as revenue')
            ->groupBy('created_by')
            ->orderByDesc('revenue')
            ->get();

        $names = User::query()->whereIn('id', $rows->pluck('created_by'))->pluck('name', 'id');

        return [
            'period' => ['from' => $from, 'to' => $to],
            'staff' => $rows->map(fn ($r) => [
                'staff_id' => $r->created_by,
                'name' => $names[$r->created_by] ?? 'Unknown',
                'sales_count' => (int) $r->sales_count,
                'revenue' => round((float) $r->revenue, 2),
            ])->all(),
        ];
    }

    /**
     * Tax collected on completed sales in the period.
     */
    public function tax(string $tenantId, ?string $branchId, string $from, string $to): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $sales = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        return [
            'period' => ['from' => $from, 'to' => $to],
            'totals' => [
                'taxable_sales' => (clone $sales)->where('tax', '>', 0)->count(),
                'net_sales' => round((float) (clone $sales)->sum('subtotal') - (float) (clone $sales)->sum('discount'), 2),
                'tax_collected' => round((float) (clone $sales)->sum('tax'), 2),
                'gross_sales' => round((float) (clone $sales)->sum('total'), 2),
            ],
        ];
    }

    /**
     * Cashbook: a unified day-by-day money-IN / money-OUT ledger with a running
     * balance. Every figure is DERIVED from its own source, so nothing double
     * counts:
     *   money in  = sales revenue (non-cancelled sales' total) + manual income
     *   money out = expenses + refunds paid back (sale_returns)
     * Sales revenue is NEVER stored in the incomes table, so one sale can't
     * land on both sides. Partially/fully refunded sales keep their original
     * revenue on the day it came in AND show the refund on the day it went out,
     * so the money movement reconciles. Opening balance is the net position
     * accumulated before the period, so the running balance reads like a book.
     */
    public function cashbook(string $tenantId, ?string $branchId, string $from, string $to, string $granularity = 'day'): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();
        $format = $granularity === 'month' ? 'Y-m' : 'Y-m-d';

        // A sale that was later refunded still brought its money in — only a
        // CANCELLED sale never happened.
        $liveSales = [SaleStatus::Completed, SaleStatus::PartiallyRefunded, SaleStatus::Refunded];

        $salesByBucket = Sale::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('status', $liveSales)
            ->whereBetween('sold_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['sold_at', 'total'])
            ->groupBy(fn (Sale $s) => $s->sold_at->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('total'), 2));

        $incomeByBucket = Income::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('income_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['income_date', 'amount'])
            ->groupBy(fn (Income $i) => $i->income_date->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('amount'), 2));

        $expenseByBucket = Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['expense_date', 'amount'])
            ->groupBy(fn (Expense $e) => $e->expense_date->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('amount'), 2));

        $refundByBucket = SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('returned_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['returned_at', 'refund_total'])
            ->groupBy(fn (SaleReturn $r) => $r->returned_at->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('refund_total'), 2));

        // Paying the wholesaler. Counted as its own source rather than as an
        // Expense: fabricating one would double-count the day a shop also files
        // the supplier's bill, and refunds already set the precedent that a
        // distinct kind of movement gets its own column.
        $supplierPaidByBucket = SupplierPayment::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('paid_at', [$fromStart, $toEnd])
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['paid_at', 'amount'])
            ->groupBy(fn (SupplierPayment $p) => $p->paid_at->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('amount'), 2));

        // Opening balance = everything that moved BEFORE the period. The branch
        // filter matters MORE here than in the buckets: money before the window
        // is never drawn as a row, so an unscoped figure cannot be seen and
        // spotted — it just shifts every balance down the page.
        $scope = fn ($q) => $q->when($branchId, fn ($q) => $q->where('branch_id', $branchId));

        $opening = round(
            (float) $scope(Sale::query()->where('tenant_id', $tenantId)
                ->whereIn('status', $liveSales)->where('sold_at', '<', $fromStart))->sum('total')
            + (float) $scope(Income::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('income_date', '<', $from))->sum('amount')
            - (float) $scope(Expense::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('expense_date', '<', $from))->sum('amount')
            - (float) $scope(SaleReturn::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('returned_at', '<', $fromStart))->sum('refund_total')
            - (float) $scope(SupplierPayment::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('paid_at', '<', $fromStart))->sum('amount'),
            2,
        );

        $days = [];
        $cursor = $fromStart;
        $running = $opening;
        $tSales = $tIncome = $tExpenses = $tRefunds = $tSupplier = 0.0;

        while ($cursor <= $toEnd) {
            $key = $cursor->format($format);
            $sales = $salesByBucket[$key] ?? 0.0;
            $income = $incomeByBucket[$key] ?? 0.0;
            $expenses = $expenseByBucket[$key] ?? 0.0;
            $refunds = $refundByBucket[$key] ?? 0.0;
            $supplierPaid = $supplierPaidByBucket[$key] ?? 0.0;
            $moneyIn = round($sales + $income, 2);
            $moneyOut = round($expenses + $refunds + $supplierPaid, 2);
            $net = round($moneyIn - $moneyOut, 2);
            $running = round($running + $net, 2);

            $tSales += $sales;
            $tIncome += $income;
            $tExpenses += $expenses;
            $tRefunds += $refunds;
            $tSupplier += $supplierPaid;

            $days[] = [
                'date' => $key,
                'sales_revenue' => $sales,
                'other_income' => $income,
                'money_in' => $moneyIn,
                'expenses' => $expenses,
                'refunds' => $refunds,
                'supplier_payments' => $supplierPaid,
                'money_out' => $moneyOut,
                'net' => $net,
                'balance' => $running,
            ];

            $cursor = $granularity === 'month' ? $cursor->addMonth() : $cursor->addDay();
        }

        $totalIn = round($tSales + $tIncome, 2);
        $totalOut = round($tExpenses + $tRefunds + $tSupplier, 2);

        return [
            'period' => ['from' => $from, 'to' => $to, 'granularity' => $granularity],
            'opening_balance' => $opening,
            'closing_balance' => round($opening + $totalIn - $totalOut, 2),
            'totals' => [
                'sales_revenue' => round($tSales, 2),
                'other_income' => round($tIncome, 2),
                'money_in' => $totalIn,
                'expenses' => round($tExpenses, 2),
                'refunds' => round($tRefunds, 2),
                'money_out' => $totalOut,
                'net' => round($totalIn - $totalOut, 2),
            ],
            'days' => $days,
        ];
    }

    private function expensesByCategory(string $tenantId, ?string $branchId, string $from, string $to): array
    {
        return Expense::withoutTenancy()
            ->where('expenses.tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->when($branchId, fn ($q) => $q->where('expenses.branch_id', $branchId))
            ->leftJoin('expense_categories', 'expenses.expense_category_id', '=', 'expense_categories.id')
            ->selectRaw('COALESCE(expense_categories.name, "Uncategorized") as category, SUM(expenses.amount) as total')
            ->groupBy('category')
            ->orderByDesc('total')
            ->get()
            ->map(fn ($row) => [
                'category' => $row->category,
                'total' => round((float) $row->total, 2),
            ])
            ->all();
    }
}
