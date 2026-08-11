<?php

namespace App\Actions\Tenant;

use App\Exceptions\DomainException;
use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Assigns, changes or renews a tenant's plan, and records the payment that
 * bought the period.
 *
 * This action moves money and dates. It does NOT touch what the shop can do.
 *
 * It used to. A plan carried a module map and assignment merged it over the
 * tenant's, which meant a renewal — the most routine billing event there is —
 * silently revoked any module an admin had granted that shop. Nobody was told;
 * a screen was simply gone the next morning. Modules now belong to the tenant
 * (Tenant::applyModules) and nothing in billing may rewrite them.
 *
 * What a plan still decides is how much the shop may hold: products, storage,
 * orders a month. Those read through PlanLimits, live, so raising a plan's
 * product ceiling lifts every shop on it without touching a single tenant row.
 *
 * Billing:
 *  - renewing the SAME plan while still active → the new period stacks onto
 *    the current end date, so paid days are never lost
 *  - switching plans, or renewing after expiry → the period starts now
 *  - an EXPLICIT period overrides both — see below
 *  - a payment row is written whenever an amount is due (who paid, how much,
 *    for which period) — the billing ledger
 *
 * The explicit period exists because the calendar the software assumes and the
 * one the business runs on are frequently not the same. A shop that paid in
 * cash last Thursday, one moving onto the platform mid-cycle with two months
 * already settled, one given a free month while it finds its feet — all of them
 * were previously typed in as "starts now", and the renewal date was then wrong
 * forever, because every subsequent period stacks onto it. Being able to state
 * the window at the moment the shop is created is the only chance to get that
 * anchor right.
 *
 * `paid_at` is separate from the period for the same reason: WHEN the money
 * arrived and WHAT it bought are different facts, and a shop that pays three
 * days late has not bought three fewer days.
 */
class AssignPlanAction
{
    /**
     * @param  array{amount?: float, method?: string, reference?: string, notes?: string, paid_at?: string}|null  $payment
     * @param  array{starts_at?: string, ends_at?: string}|null  $period  explicit billing window; overrides the default stacking
     */
    public function execute(Tenant $tenant, Plan $plan, ?array $payment = null, ?array $period = null): Tenant
    {
        if (! $plan->is_active) {
            throw DomainException::unprocessable('This plan is not available.', 'PLAN_INACTIVE');
        }

        return DB::transaction(function () use ($tenant, $plan, $payment, $period): Tenant {
            $samePlanRenewal = $tenant->plan_id === $plan->id
                && $tenant->subscription_ends_at !== null
                && $tenant->subscription_ends_at->isFuture();

            // Stack onto remaining paid time for a same-plan renewal; else now.
            $start = $samePlanRenewal ? $tenant->subscription_ends_at->copy() : now();

            // An admin who names the window means it. Stacking exists to
            // protect days the shop already paid for; it must not quietly
            // relocate a window someone typed on purpose.
            if (! empty($period['starts_at'])) {
                $start = Carbon::parse($period['starts_at']);
            }

            $end = ! empty($period['ends_at'])
                ? Carbon::parse($period['ends_at'])
                : $start->copy()->addMonths($plan->billing_period_months);

            if ($end->lessThanOrEqualTo($start)) {
                throw DomainException::unprocessable(
                    'The billing period ends before it starts.',
                    'INVALID_BILLING_PERIOD',
                );
            }

            $tenant->forceFill([
                'plan_id' => $plan->id,
                // A stated start is this subscription's start, full stop. The
                // renewal branch only preserves the original where the admin
                // said nothing, which is what makes "member since" survive
                // twelve renewals.
                'subscription_starts_at' => ! empty($period['starts_at'])
                    ? $start
                    : ($samePlanRenewal ? $tenant->subscription_starts_at : now()),
                'subscription_ends_at' => $end,
            ])->save();

            // Record payment if an amount is due (free plans skip the ledger).
            $amount = $payment['amount'] ?? ($plan->price > 0 ? (float) $plan->price : null);

            if ($amount !== null && $amount > 0) {
                SubscriptionPayment::query()->create([
                    'tenant_id' => $tenant->id,
                    'plan_id' => $plan->id,
                    'plan_name' => $plan->name,
                    'amount' => $amount,
                    'method' => $payment['method'] ?? 'manual',
                    'reference' => $payment['reference'] ?? null,
                    'period_start' => $start->toDateString(),
                    'period_end' => $end->toDateString(),
                    // When the money actually arrived, which is not always the
                    // moment someone got round to typing it in.
                    'paid_at' => empty($payment['paid_at']) ? now() : Carbon::parse($payment['paid_at']),
                    'recorded_by' => auth()->id(),
                    'notes' => $payment['notes'] ?? null,
                ]);
            }

            return $tenant->load('plan');
        });
    }
}
