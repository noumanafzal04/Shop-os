<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\TenantStatus;
use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Services\DashboardService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BillingController extends Controller
{
    /**
     * All subscription payments — who paid, how much, when, for which period.
     *
     * ── Every filter here already existed and none of them were reachable ──
     *
     * `tenant_id`, `from` and `to` have been accepted since this endpoint was
     * written, and the screen in front of it sent none of them: it asked for
     * page 1 and drew whatever came back. An admin looking for "what did this
     * shop pay in June" had a filter, a table and no way to connect them. What
     * is new here is `method` and `search`; what is FIXED is that the panel now
     * sends all five.
     *
     * The totals ride along on the response for the same reason the tenant
     * list's bucket counts do: a filtered ledger whose only number is a row
     * count answers "how many payments" when the question was "how much money",
     * and the page on screen is not the answer — it is 20 of them.
     */
    public function payments(Request $request): JsonResponse
    {
        $filtered = fn () => SubscriptionPayment::query()
            ->when($request->query('tenant_id'), fn ($q, $id) => $q->where('tenant_id', $id))
            ->when($request->query('from'), fn ($q, $from) => $q->where('paid_at', '>=', $from))
            ->when($request->query('to'), fn ($q, $to) => $q->where('paid_at', '<=', $to.' 23:59:59'))
            ->when($request->query('method'), fn ($q, $method) => $q->where('method', $method))
            ->when($request->query('search'), function ($q, $search): void {
                // The shop's name, the plan it was on, or the reference typed
                // on the receipt — the three things somebody has in hand when
                // they come looking for one payment.
                $q->where(function ($q) use ($search): void {
                    $q->where('plan_name', 'like', "%{$search}%")
                        ->orWhere('reference', 'like', "%{$search}%")
                        ->orWhereHas('tenant', fn ($t) => $t->where('business_name', 'like', "%{$search}%"));
                });
            });

        $payments = $filtered()
            ->with('tenant:id,business_name,slug')
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

        // select(), never selectRaw(): selectRaw APPENDS, so the aggregate
        // would arrive beside `select *` and MySQL's ONLY_FULL_GROUP_BY
        // refuses that outright. SQLite does not, which is how a query like
        // this passes every test and 500s in production.
        $totals = $filtered()
            ->select(DB::raw('COUNT(*) as payments, COALESCE(SUM(amount), 0) as amount'))
            ->toBase()
            ->first();

        return ApiResponse::paginated($payments, meta: [
            'totals' => [
                'payments' => (int) ($totals->payments ?? 0),
                'amount' => round((float) ($totals->amount ?? 0), 2),
            ],
            // What the ledger was actually paid WITH, over the current filter.
            // Cash and a bank transfer are chased differently when one goes
            // missing, and the split was invisible before.
            'methods' => $filtered()
                ->select(DB::raw('method, COUNT(*) as payments, COALESCE(SUM(amount), 0) as amount'))
                ->groupBy('method')
                ->toBase()
                ->get()
                ->map(fn ($row): array => [
                    'method' => (string) $row->method,
                    'payments' => (int) $row->payments,
                    'amount' => round((float) $row->amount, 2),
                ])
                ->sortByDesc('amount')
                ->values(),
        ]);
    }

    /**
     * Billing overview: revenue, and subscription health buckets.
     */
    public function summary(DashboardService $dashboards): JsonResponse
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
            // The same twelve months the platform dashboard draws, from the
            // same method — see DashboardService::revenueSeries.
            'revenue_series' => $dashboards->revenueSeries(12),
            'outstanding' => $this->outstanding(),
            'chase' => $this->chase(),
        ]);
    }

    /**
     * MONEY THAT IS LATE, which this screen has never once said out loud.
     *
     * Four counts of shops were the whole of it: active, expiring, expired,
     * suspended. Every one of them is a headcount, and nobody chasing
     * subscriptions is chasing heads. "Eleven shops are overdue" and "eleven
     * shops are overdue for 143,000" are different mornings.
     *
     * ── Why the arithmetic is in PHP ───────────────────────────────────
     *
     * A shop owes its plan's price. Joining `plans` here would put an ambiguous
     * `status` and `deleted_at` into a query that scopePaymentStatus already
     * writes unqualified, so instead the shops are counted per plan — plans is
     * a table of a handful of rows — and multiplied out here. That is the same
     * trade scopePaymentStatus itself makes, one line up, for the same reason.
     *
     * A shop with NO plan counts and owes nothing. That is not a rounding
     * error to hide: it is every converted demo waiting to be priced, and the
     * count is how you find them.
     *
     * @return array<string, array{shops: int, amount: float, unpriced: int}>
     */
    private function outstanding(): array
    {
        $prices = Plan::query()->pluck('price', 'id');

        $bucket = function (string $status) use ($prices): array {
            $rows = Tenant::query()
                ->paymentStatus($status)
                ->select(DB::raw('plan_id, COUNT(*) as shops'))
                ->groupBy('plan_id')
                ->toBase()
                ->get();

            $amount = 0.0;
            $shops = 0;
            $unpriced = 0;

            foreach ($rows as $row) {
                $shops += (int) $row->shops;

                if ($row->plan_id === null) {
                    $unpriced += (int) $row->shops;

                    continue;
                }

                $amount += (float) ($prices[$row->plan_id] ?? 0) * (int) $row->shops;
            }

            return ['shops' => $shops, 'amount' => round($amount, 2), 'unpriced' => $unpriced];
        };

        return [
            'unpaid' => $bucket('unpaid'),
            'grace' => $bucket('grace'),
            'suspended' => $bucket('suspended'),
        ];
    }

    /**
     * WHO TO RING TODAY — in grace first, then overdue, longest wait first.
     *
     * In grace before overdue on purpose. A shop inside its grace period is one
     * phone call away from paying and one week away from being switched off;
     * a shop that went past that months ago is a different conversation and is
     * not what the morning is for.
     *
     * @return array<int, array<string, mixed>>
     */
    private function chase(): array
    {
        $prices = Plan::query()->pluck('price', 'id');

        $rows = collect(['grace', 'unpaid'])->flatMap(fn (string $status) => Tenant::query()
            ->paymentStatus($status)
            ->with('plan:id,name')
            ->orderBy('subscription_ends_at')
            ->limit(10)
            ->get(['id', 'business_name', 'phone', 'email', 'plan_id', 'subscription_ends_at'])
            ->map(fn (Tenant $t): array => [
                'id' => $t->id,
                'business_name' => $t->business_name,
                'phone' => $t->phone,
                'email' => $t->email,
                'plan_name' => $t->plan?->name,
                'amount' => $t->plan_id !== null ? round((float) ($prices[$t->plan_id] ?? 0), 2) : null,
                'payment_status' => $status,
                'ends_at' => $t->subscription_ends_at?->toIso8601String(),
                // Whole days, so the panel is never the place this is worked
                // out — two screens doing the same arithmetic is two screens
                // that can disagree about how late somebody is.
                'days_late' => $t->subscription_ends_at !== null
                    ? (int) $t->subscription_ends_at->startOfDay()->diffInDays(now()->startOfDay())
                    : null,
            ]));

        return $rows->take(10)->values()->all();
    }
}
