<?php

namespace App\Actions\Tenant;

use App\Exceptions\DomainException;
use App\Models\Plan;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Assigns (or changes/renews) a tenant's plan and optionally records the
 * payment that bought the period. The Super Admin decides here which bundle a
 * business gets: Business/POS (in-shop only), Online Business (online only),
 * or both.
 *
 * The plan's `features` are the plan-gated modules it grants (pos, expenses,
 * marketplace…); they're merged over the shop's existing (business-type)
 * modules, so assigning a plan actually turns its modules on/off. Modules the
 * plan doesn't name (products, inventory, images…) are left as the business
 * type set them.
 *
 * Billing:
 *  - renewing the SAME plan while still active → new period stacks onto the
 *    current end date (customer doesn't lose paid days)
 *  - switching plans, or renewing after expiry → period starts now
 *  - a payment row is written whenever payment details are supplied (who
 *    paid, how much, for which period) — the billing ledger
 *
 * Edge cases:
 *  - inactive plan → 422 PLAN_INACTIVE
 *  - downgrade (online → in-shop) → online off + marketplace module off,
 *    data PRESERVED
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
                'online_shop_enabled' => $plan->online_shop_enabled,
                // Plan-gated modules win over the business-type defaults.
                'features' => array_merge($tenant->features ?? [], $plan->features ?? []),
                'subscription_starts_at' => $samePlanRenewal ? $tenant->subscription_starts_at : now(),
                'subscription_ends_at' => $end,
            ])->save();

            // Record payment if amount supplied (free plans skip the ledger).
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
