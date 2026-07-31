<?php

namespace App\Services;

use App\Enums\SaleStatus;
use App\Models\Expense;
use App\Models\Income;
use App\Models\PurchaseOrder;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleReturn;
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

    public function summary(string $tenantId, string $from, string $to, string $granularity = 'day'): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $completedSales = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd]);

        $salesCount = (clone $completedSales)->count();
        $revenue = (float) (clone $completedSales)->sum('total');

        $cogs = (float) SaleItem::query()
            ->where('sale_items.tenant_id', $tenantId)
            ->whereHas('sale', fn ($q) => $q
                ->where('status', SaleStatus::Completed)
                ->whereBetween('sold_at', [$fromStart, $toEnd]))
            ->selectRaw('COALESCE(SUM(unit_cost * quantity), 0) as cogs')
            ->value('cogs');

        $expensesTotal = (float) Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->sum('amount');

        return [
            'period' => ['from' => $from, 'to' => $to, 'granularity' => $granularity],
            'totals' => [
                'sales_count' => $salesCount,
                'revenue' => round($revenue, 2),
                'cogs' => round($cogs, 2),
                'gross_profit' => round($revenue - $cogs, 2),
                'expenses' => round($expensesTotal, 2),
                'net_profit' => round($revenue - $cogs - $expensesTotal, 2),
            ],
            'series' => $this->series($tenantId, $fromStart, $toEnd, $granularity),
            'top_products' => $this->topProducts($tenantId, $fromStart, $toEnd),
            'expenses_by_category' => $this->expensesByCategory($tenantId, $from, $to),
        ];
    }

    /**
     * Zero-filled buckets — charts never have holes.
     */
    private function series(string $tenantId, CarbonImmutable $from, CarbonImmutable $to, string $granularity): array
    {
        $format = $granularity === 'month' ? 'Y-m' : 'Y-m-d';

        $revenueByBucket = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$from, $to])
            ->get(['sold_at', 'total'])
            ->groupBy(fn (Sale $s) => $s->sold_at->format($format))
            ->map(fn (Collection $sales) => round((float) $sales->sum('total'), 2));

        $expensesByBucket = Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from->toDateString().' 00:00:00', $to->toDateString().' 23:59:59'])
            ->get(['expense_date', 'amount'])
            ->groupBy(fn (Expense $e) => $e->expense_date->format($format))
            ->map(fn (Collection $items) => round((float) $items->sum('amount'), 2));

        $buckets = [];
        $cursor = $from;

        while ($cursor <= $to) {
            $key = $cursor->format($format);
            $revenue = $revenueByBucket[$key] ?? 0.0;
            $expenses = $expensesByBucket[$key] ?? 0.0;
            $buckets[] = [
                'date' => $key,
                'revenue' => $revenue,
                'expenses' => $expenses,
                'profit' => round($revenue - $expenses, 2),
            ];
            $cursor = $granularity === 'month' ? $cursor->addMonth() : $cursor->addDay();
        }

        return $buckets;
    }

    private function topProducts(string $tenantId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        return SaleItem::query()
            ->where('sale_items.tenant_id', $tenantId)
            ->whereHas('sale', fn ($q) => $q
                ->where('status', SaleStatus::Completed)
                ->whereBetween('sold_at', [$from, $to]))
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
     * Purchases report: what was ordered/received/paid and what's outstanding,
     * plus a per-supplier breakdown. Cancelled POs excluded.
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
    public function staffPerformance(string $tenantId, string $from, string $to): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $rows = Sale::query()
            ->where('sales.tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd])
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
    public function tax(string $tenantId, string $from, string $to): array
    {
        $fromStart = CarbonImmutable::parse($from)->startOfDay();
        $toEnd = CarbonImmutable::parse($to)->endOfDay();

        $sales = Sale::query()
            ->where('tenant_id', $tenantId)
            ->where('status', SaleStatus::Completed)
            ->whereBetween('sold_at', [$fromStart, $toEnd]);

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
    public function cashbook(string $tenantId, string $from, string $to, string $granularity = 'day'): array
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
            ->get(['sold_at', 'total'])
            ->groupBy(fn (Sale $s) => $s->sold_at->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('total'), 2));

        $incomeByBucket = Income::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('income_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->get(['income_date', 'amount'])
            ->groupBy(fn (Income $i) => $i->income_date->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('amount'), 2));

        $expenseByBucket = Expense::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
            ->get(['expense_date', 'amount'])
            ->groupBy(fn (Expense $e) => $e->expense_date->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('amount'), 2));

        $refundByBucket = SaleReturn::withoutTenancy()
            ->where('tenant_id', $tenantId)
            ->whereBetween('returned_at', [$fromStart, $toEnd])
            ->get(['returned_at', 'refund_total'])
            ->groupBy(fn (SaleReturn $r) => $r->returned_at->format($format))
            ->map(fn (Collection $r) => round((float) $r->sum('refund_total'), 2));

        // Opening balance = everything that moved BEFORE the period.
        $opening = round(
            (float) Sale::query()->where('tenant_id', $tenantId)
                ->whereIn('status', $liveSales)->where('sold_at', '<', $fromStart)->sum('total')
            + (float) Income::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('income_date', '<', $from)->sum('amount')
            - (float) Expense::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('expense_date', '<', $from)->sum('amount')
            - (float) SaleReturn::withoutTenancy()->where('tenant_id', $tenantId)
                ->where('returned_at', '<', $fromStart)->sum('refund_total'),
            2,
        );

        $days = [];
        $cursor = $fromStart;
        $running = $opening;
        $tSales = $tIncome = $tExpenses = $tRefunds = 0.0;

        while ($cursor <= $toEnd) {
            $key = $cursor->format($format);
            $sales = $salesByBucket[$key] ?? 0.0;
            $income = $incomeByBucket[$key] ?? 0.0;
            $expenses = $expenseByBucket[$key] ?? 0.0;
            $refunds = $refundByBucket[$key] ?? 0.0;
            $moneyIn = round($sales + $income, 2);
            $moneyOut = round($expenses + $refunds, 2);
            $net = round($moneyIn - $moneyOut, 2);
            $running = round($running + $net, 2);

            $tSales += $sales;
            $tIncome += $income;
            $tExpenses += $expenses;
            $tRefunds += $refunds;

            $days[] = [
                'date' => $key,
                'sales_revenue' => $sales,
                'other_income' => $income,
                'money_in' => $moneyIn,
                'expenses' => $expenses,
                'refunds' => $refunds,
                'money_out' => $moneyOut,
                'net' => $net,
                'balance' => $running,
            ];

            $cursor = $granularity === 'month' ? $cursor->addMonth() : $cursor->addDay();
        }

        $totalIn = round($tSales + $tIncome, 2);
        $totalOut = round($tExpenses + $tRefunds, 2);

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

    private function expensesByCategory(string $tenantId, string $from, string $to): array
    {
        return Expense::withoutTenancy()
            ->where('expenses.tenant_id', $tenantId)
            ->whereBetween('expense_date', [$from.' 00:00:00', $to.' 23:59:59'])
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
