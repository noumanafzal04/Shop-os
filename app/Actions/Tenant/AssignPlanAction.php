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
 *  - a payment row is written whenever an amount is due (who paid, how much,
 *    for which period) — the billing ledger
 */
class AssignPlanAction
{
    public function execute(Tenant $tenant, Plan $plan, ?array $payment = null): Tenant
    {
        if (! $plan->is_active) {
            throw DomainException::unprocessable('This plan is not available.', 'PLAN_INACTIVE');
        }

        return DB::transaction(function () use ($tenant, $plan, $payment): Tenant {
            $samePlanRenewal = $tenant->plan_id === $plan->id
                && $tenant->subscription_ends_at !== null
                && $tenant->subscription_ends_at->isFuture();

            // Stack onto remaining paid time for a same-plan renewal; else now.
            $start = $samePlanRenewal ? $tenant->subscription_ends_at : now();
            $end = (clone $start)->addMonths($plan->billing_period_months);

            $tenant->forceFill([
                'plan_id' => $plan->id,
                'subscription_starts_at' => $samePlanRenewal ? $tenant->subscription_starts_at : now(),
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
                    'period_start' => Carbon::parse($start)->toDateString(),
                    'period_end' => Carbon::parse($end)->toDateString(),
                    'paid_at' => now(),
                    'recorded_by' => auth()->id(),
                    'notes' => $payment['notes'] ?? null,
                ]);
            }

            return $tenant->load('plan');
        });
    }
}
