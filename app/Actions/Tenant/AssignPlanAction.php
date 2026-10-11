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
 *  - renewing the SAME plan while it is still running, OR within its grace
 *    days → the new period carries on from the current end date
 *  - switching plans, or renewing once grace is spent → the period starts now
 *  - an EXPLICIT period overrides both — see below
 *  - a payment row is written when an amount was GIVEN (who paid, how much,
 *    for which period) — the billing ledger
 *
 * ── Grace is part of the month that follows ─────────────────────────────
 *
 * A renewal "after expiry" used to start on the day it was typed, whatever
 * "after" meant. For a shop two days into its grace that moved its month two
 * days later — and those two days, on which it traded in full, were never
 * part of any paid period. Every late month moved the renewal date later for
 * good: a shop that always paid on the last day of a fourteen-day grace paid
 * for eight months in twelve.
 *
 * Grace is full use of the product, so paying during it buys the month that
 * began when the last one ended. Once grace is spent the shop is read-only —
 * it has NOT had the use of those days — and a renewal then starts today.
 *
 * ── The ledger holds money somebody typed in ────────────────────────────
 *
 * Given no payment, this used to write one for the plan's price. Both forms
 * that call it say the opposite in so many words — "leave the amount blank if
 * nothing was taken yet", "leave amount blank for a free/complimentary
 * assignment" — and send nothing when the box is blank. So a shop signed up
 * on a promise to pay next week was in the ledger as collected, in cash
 * nobody held, and a free month was revenue. No amount given is no payment.
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
    /** Why a period starts where it does — said to the admin before they save. */
    public const RUNNING = 'running';     // same plan, still inside its paid period

    public const GRACE = 'grace';         // same plan, run out, inside its grace days

    public const LAPSED = 'lapsed';       // same plan, grace spent: read-only

    public const NEW_PLAN = 'new_plan';   // a different plan from the one it is on

    public const FIRST = 'first';         // nothing to carry on from

    public const STATED = 'stated';       // the admin typed the dates

    /**
     * THE PERIOD A PAYMENT TAKEN NOW WOULD BUY — worked out in one place, for
     * the dialog that asks and for the save that follows it.
     *
     * The dialog used to describe the rule in a sentence and leave the admin
     * to work the dates out; what was then recorded was whatever this class
     * made of it. Every later renewal stacks onto that date, so it is the one
     * figure on the form that must not be a surprise.
     *
     * Months are added the way a bank adds them. `addMonths` rolls a date
     * that does not exist into the next month — a shop put on a monthly plan
     * on 31 January was paid up to 3 March, one on 31 August to 1 October —
     * which is days nobody was charged for, an anniversary that crept from
     * the 31st to the 3rd, and a renewal date the bills meter (which clamps,
     * see PlanLimits::periodStart) did not agree with.
     *
     * @param  array{starts_at?: string, ends_at?: string}|null  $period
     * @return array{start: Carbon, end: Carbon, carries_on: bool, because: string}
     */
    public function window(Tenant $tenant, Plan $plan, ?array $period = null): array
    {
        $hasWindow = $tenant->subscription_ends_at !== null;
        $samePlan = $tenant->plan_id === $plan->id && $hasWindow;

        // Still running, or run out and inside its grace: either way the shop
        // has had the use of every day up to now, so the period it is paying
        // for starts where the last paid one ended.
        $state = $samePlan ? $tenant->subscriptionState() : null;
        $carriesOn = $samePlan && $state !== 'read_only';

        $because = match (true) {
            $samePlan && $state === 'active' => self::RUNNING,
            $samePlan && $state === 'grace' => self::GRACE,
            $samePlan => self::LAPSED,
            $tenant->plan_id !== null && $hasWindow => self::NEW_PLAN,
            default => self::FIRST,
        };

        $start = $carriesOn ? $tenant->subscription_ends_at->copy() : now();

        // An admin who names the window means it. Carrying on exists to
        // protect days the shop already paid for; it must not quietly
        // relocate a window someone typed on purpose.
        if (! empty($period['starts_at'])) {
            $start = Carbon::parse($period['starts_at']);
        }

        $end = ! empty($period['ends_at'])
            ? Carbon::parse($period['ends_at'])
            : $start->copy()->addMonthsNoOverflow(max(1, (int) $plan->billing_period_months));

        return [
            'start' => $start,
            'end' => $end,
            'carries_on' => $carriesOn,
            'because' => ! empty($period['starts_at']) || ! empty($period['ends_at']) ? self::STATED : $because,
        ];
    }

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
            $window = $this->window($tenant, $plan, $period);
            $start = $window['start'];
            $end = $window['end'];
            $samePlanRenewal = $window['carries_on'];

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

            // Only what was given. A plan's price is what a period COSTS, not
            // evidence that anybody paid it — see the note at the head.
            $amount = isset($payment['amount']) ? (float) $payment['amount'] : null;

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
