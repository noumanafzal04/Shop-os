<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\LedgerService;
use App\Services\ReportService;
use App\Services\StockReportService;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\CsvExport;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    /**
     * Period summary: totals + chart series + top products + expense
     * breakdown. period=daily|weekly|monthly|yearly|custom (with from/to).
     */
    public function summary(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $data = $request->validate([
            'period' => ['sometimes', Rule::in(['daily', 'weekly', 'monthly', 'yearly', 'custom'])],
            'from' => ['required_if:period,custom', 'date'],
            'to' => ['required_if:period,custom', 'date', 'after_or_equal:from'],
        ]);

        $period = $reports->resolvePeriod(
            $data['period'] ?? 'monthly',
            $data['from'] ?? null,
            $data['to'] ?? null,
        );

        return ApiResponse::ok($reports->summary(
            $context->id(),
            $period['from'],
            $period['to'],
            $period['granularity'],
        ));
    }

    public function purchases(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $p = $this->period($request, $reports);

        return ApiResponse::ok($reports->purchases($context->id(), $p['from'], $p['to']));
    }

    public function staff(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $p = $this->period($request, $reports);

        return ApiResponse::ok($reports->staffPerformance($context->id(), $p['from'], $p['to']));
    }

    public function tax(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $p = $this->period($request, $reports);

        return ApiResponse::ok($reports->tax($context->id(), $p['from'], $p['to']));
    }

    /**
     * Cashbook: day-by-day money in/out (derived sales + manual income vs
     * expenses + refunds) with a running balance. Part of the Expense & Income
     * module (feature:expenses + permission:expenses.manage).
     */
    public function cashbook(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $p = $this->period($request, $reports);

        return ApiResponse::ok(
            $reports->cashbook($context->id(), $p['from'], $p['to'], $p['granularity']),
        );
    }

    /**
     * The ledger: every movement, one row each, balance carried down the page.
     *
     * The Cashbook above says what each DAY came to. This says what each day
     * was MADE of — the bill, the invoice number, the category, the method.
     * For a books-only business that is not a drill-down, it is the product.
     */
    public function ledger(
        Request $request,
        LedgerService $ledger,
        ReportService $reports,
        TenantContext $context,
        BranchContext $branch,
    ): JsonResponse {
        $p = $this->period($request, $reports);

        $result = $ledger->page($context->id(), $branch->scopeId(), $p['from'], $p['to'], $request);
        $entries = $result['entries'];

        return ApiResponse::paginated($entries, 'OK', [
            'period' => ['from' => $p['from'], 'to' => $p['to']],
            'opening' => $result['opening'],
            'closing' => $result['closing'],
            'totals' => $result['totals'],
        ]);
    }

    /** The whole filtered ledger as a CSV — an export of page one is not one. */
    public function exportLedger(
        Request $request,
        LedgerService $ledger,
        ReportService $reports,
        TenantContext $context,
        BranchContext $branch,
    ): StreamedResponse {
        $p = $this->period($request, $reports);

        return CsvExport::stream(
            "ledger-{$p['from']}-to-{$p['to']}.csv",
            ['Date', 'Type', 'Reference', 'Description', 'Category', 'Method', 'In', 'Out', 'Balance'],
            $ledger->rows($context->id(), $branch->scopeId(), $p['from'], $p['to'], $request),
        );
    }

    /**
     * What each item actually earned. Revenue alone crowns whatever is
     * expensive; margin crowns what pays — and they are rarely the same line.
     */
    public function margins(Request $request, ReportService $reports, TenantContext $context): JsonResponse
    {
        $p = $this->period($request, $reports);

        return ApiResponse::ok($reports->margins($context->id(), $p['from'], $p['to']));
    }

    /** What the shelves are worth — the figure a bank meeting asks for. */
    public function valuation(StockReportService $stock, TenantContext $context, BranchContext $branch): JsonResponse
    {
        return ApiResponse::ok($stock->valuation($context->id(), $branch->scopeId()));
    }

    /**
     * Stock nobody has bought. The quietest way a shop loses cash: nothing
     * prompts you to look at a shelf people don't buy from.
     */
    public function deadStock(
        Request $request,
        StockReportService $stock,
        TenantContext $context,
        BranchContext $branch,
    ): JsonResponse {
        $data = $request->validate(['days' => ['sometimes', 'integer', 'min:7', 'max:1095']]);

        return ApiResponse::ok(
            $stock->deadStock($context->id(), $branch->scopeId(), (int) ($data['days'] ?? 90)),
        );
    }

    // ── Exports ─────────────────────────────────────────────────────
    // A report you cannot take to an accountant is half a report.

    public function exportMargins(Request $request, ReportService $reports, TenantContext $context): StreamedResponse
    {
        $p = $this->period($request, $reports);
        $report = $reports->margins($context->id(), $p['from'], $p['to'], limit: 100000);

        return CsvExport::stream(
            "margins-{$p['from']}-to-{$p['to']}.csv",
            ['item', 'category', 'units', 'revenue', 'cost', 'profit', 'margin_pct'],
            array_map(fn (array $r): array => [
                $r['name'], $r['category'], $r['units'], $r['revenue'], $r['cogs'], $r['profit'], $r['margin_pct'],
            ], $report['best']),
        );
    }

    public function exportValuation(StockReportService $stock, TenantContext $context, BranchContext $branch): StreamedResponse
    {
        $report = $stock->valuation($context->id(), $branch->scopeId());

        return CsvExport::stream(
            'stock-valuation-'.now()->toDateString().'.csv',
            ['item', 'sku', 'category', 'quantity', 'unit_cost', 'cost_value', 'retail_value'],
            array_map(fn (array $r): array => [
                $r['name'], $r['sku'], $r['category'], $r['quantity'], $r['cost'], $r['cost_value'], $r['retail_value'],
            ], $report['items']),
        );
    }

    public function exportDeadStock(
        Request $request,
        StockReportService $stock,
        TenantContext $context,
        BranchContext $branch,
    ): StreamedResponse {
        $days = (int) $request->query('days', 90);
        $report = $stock->deadStock($context->id(), $branch->scopeId(), $days);

        return CsvExport::stream(
            "dead-stock-{$days}days-".now()->toDateString().'.csv',
            ['item', 'sku', 'category', 'quantity', 'unit_cost', 'value', 'last_sold', 'days_idle'],
            array_map(fn (array $r): array => [
                $r['name'], $r['sku'], $r['category'], $r['quantity'], $r['cost'], $r['value'],
                // "Never" says something a blank cell does not.
                $r['last_sold_at'] ?? 'never', $r['days_idle'],
            ], $report['items']),
        );
    }

    /** Shared period validation + resolution. */
    private function period(Request $request, ReportService $reports): array
    {
        $data = $request->validate([
            'period' => ['sometimes', Rule::in(['daily', 'weekly', 'monthly', 'yearly', 'custom'])],
            'from' => ['required_if:period,custom', 'date'],
            'to' => ['required_if:period,custom', 'date', 'after_or_equal:from'],
        ]);

        return $reports->resolvePeriod($data['period'] ?? 'monthly', $data['from'] ?? null, $data['to'] ?? null);
    }
}
