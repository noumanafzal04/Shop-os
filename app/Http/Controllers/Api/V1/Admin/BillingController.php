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

        /**
         * Buckets that actually partition the shops.
         *
         * The line below used to read `// Mutually exclusive buckets (no double
         * counting):` over four counts that were nothing of the kind, and the
         * comment is the reason this went unnoticed — it reads as a statement of
         * fact about the code beneath it, so nobody checked. One suspended shop
         * with a live subscription date counted as BOTH `active` and
         * `suspended`: four numbers summing to two against a total of one.
         *
         * Two independent errors, in opposite directions:
         *
         *   · `suspended` was a STATUS question mixed in with three DATE
         *     questions, and SuspendTenantAction only touches `status` — it
         *     never clears `subscription_ends_at`, so the date bucket keeps its
         *     claim on the shop.
         *   · every shop with a NULL `subscription_ends_at` was in no bucket at
         *     all, because all three date buckets sat behind `whereNotNull`.
         *
         * So the totals were over-counted at one end and under-counted at the
         * other, which is the pattern that makes a wrong dashboard survive: the
         * errors partly cancel, and the number stays plausible.
         *
         * The shape here is lifted from `Tenant::scopePaymentStatus`, which had
         * this right all along — suspended answered first and excluded from
         * everything else, and a null end date read as "owes nothing" rather
         * than as a missing row. One question with two implementations in one
         * codebase, and only one of them correct; this makes it the same answer
         * in both places.
         */
        $suspended = Tenant::query()->where('status', TenantStatus::Suspended);

        // Everyone whose subscription date is still worth asking about.
        $live = Tenant::query()->where('status', '!=', TenantStatus::Suspended);

        return ApiResponse::ok([
            'revenue' => [
                'this_month' => round((float) SubscriptionPayment::query()
                    ->where('paid_at', '>=', $now->copy()->startOfMonth())->sum('amount'), 2),
                'this_year' => round((float) SubscriptionPayment::query()
                    ->where('paid_at', '>=', $now->copy()->startOfYear())->sum('amount'), 2),
                'all_time' => round((float) SubscriptionPayment::query()->sum('amount'), 2),
            ],
            // These four now sum to the number of shops on the platform, and
            // BillingTest asserts exactly that rather than trusting this note.
            'subscriptions' => [
                // A shop with no end date owes nothing — it cannot be behind on
                // a bill it was never given. Same reading as scopePaymentStatus.
                'active' => (clone $live)->where(fn ($q) => $q
                    ->whereNull('subscription_ends_at')
                    ->orWhere('subscription_ends_at', '>', $soon))->count(),
                'expiring_soon' => (clone $live)
                    ->whereBetween('subscription_ends_at', [$now, $soon])->count(),
                'expired' => (clone $live)->where('subscription_ends_at', '<', $now)->count(),
                'suspended' => (clone $suspended)->count(),
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
