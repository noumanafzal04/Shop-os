<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Services\ReportService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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
