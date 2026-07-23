<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\TenantStatus;
use App\Http\Controllers\Controller;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BillingController extends Controller
{
    /**
     * All subscription payments — who paid, how much, when, for which period.
     */
    public function payments(Request $request): JsonResponse
    {
        $payments = SubscriptionPayment::query()
            ->with('tenant:id,business_name,slug')
            ->when($request->query('tenant_id'), fn ($q, $id) => $q->where('tenant_id', $id))
            ->when($request->query('from'), fn ($q, $from) => $q->where('paid_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('paid_at', '<=', $to.' 23:59:59'))
            ->orderByDesc('paid_at')
            ->paginate(min((int) $request->query('per_page', 20), 100))
            ->through(fn (SubscriptionPayment $p) => [
                'id' => $p->id,
                'tenant' => ['id' => $p->tenant?->id, 'business_name' => $p->tenant?->business_name],
                'plan_name' => $p->plan_name,
                'amount' => $p->amount,
                'currency' => $p->currency,
                'method' => $p->method,
                'reference' => $p->reference,
                'period_start' => $p->period_start->toDateString(),
                'period_end' => $p->period_end->toDateString(),
                'paid_at' => $p->paid_at->toIso8601String(),
            ]);

        return ApiResponse::paginated($payments);
    }

    /**
     * Billing overview: revenue, and subscription health buckets.
     */
    public function summary(): JsonResponse
    {
        $now = now();
        $soon = now()->addDays(7);

        $withSub = Tenant::query()->whereNotNull('subscription_ends_at');

        return ApiResponse::ok([
            'revenue' => [
                'this_month' => round((float) SubscriptionPayment::query()
                    ->where('paid_at', '>=', $now->copy()->startOfMonth())->sum('amount'), 2),
                'this_year' => round((float) SubscriptionPayment::query()
                    ->where('paid_at', '>=', $now->copy()->startOfYear())->sum('amount'), 2),
                'all_time' => round((float) SubscriptionPayment::query()->sum('amount'), 2),
            ],
            // Mutually exclusive buckets (no double counting):
            'subscriptions' => [
                'active' => (clone $withSub)->where('subscription_ends_at', '>', $soon)->count(),
                'expiring_soon' => (clone $withSub)
                    ->whereBetween('subscription_ends_at', [$now, $soon])->count(),
                'expired' => (clone $withSub)->where('subscription_ends_at', '<', $now)->count(),
                'suspended' => Tenant::query()->where('status', TenantStatus::Suspended)->count(),
            ],
            'recent_payments' => SubscriptionPayment::query()
                ->with('tenant:id,business_name')
                ->latest('paid_at')
                ->limit(5)
                ->get()
                ->map(fn (SubscriptionPayment $p) => [
                    'tenant' => $p->tenant?->business_name,
                    'plan_name' => $p->plan_name,
                    'amount' => $p->amount,
                    'paid_at' => $p->paid_at->toIso8601String(),
                ]),
        ]);
    }
}
