<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * The ladder: Basic → Standard → Pro → Enterprise.
 *
 * A plan answers one question — what does this business pay, and HOW MUCH may
 * it have. It grants no modules, and that rule has not moved: a petrol pump, a
 * restaurant and a tyre shop can all sit on Basic and each keep the modules
 * its trade actually needs. Capability is decided per shop; capacity is sold.
 *
 * That is why there is no "Online" plan and no "Finance Manager" plan. An
 * office that only wants the cashbook is a Basic tenant with Expense Manager
 * ticked; a shop that sells online is a tenant with the Online Store module
 * on. Neither needs a plan of its own — which is what four combination plans
 * were quietly costing before: every new sellable module doubled the list.
 *
 * ── What changed, and why there are four rungs now ──────────────────────
 *
 * The three rungs differed in two numbers: product ceiling and storage.
 * Neither is a number a shopkeeper has ever asked about. The questions they
 * actually ask on the phone are "how many branches", "how many staff logins"
 * and "how many tills" — and all three were identical on every plan until an
 * admin typed otherwise, so the ladder being sold did not exist in software.
 *
 * Each rung now differs in six things a buyer can see:
 *
 *   branches · staff · tills · bills a month · months of history · offline
 *
 * ── Why the meter is BILLS and not RUPEES ───────────────────────────────
 *
 * Two shops both turning over Rs 5,000,000: one writes 1,000 invoices, the
 * other 20,000. They cost us twenty times apart and the rupee figure cannot
 * tell them apart. Turnover is tracked, and it is not what anyone is charged
 * on. See `PlanLimits::REGISTRY['orders_month']`.
 *
 * ── Why `premium` is called Standard ────────────────────────────────────
 *
 * The code is a slug and shops are linked to the row by id, so renaming the
 * code would be safe here and a needless migration on a live database that
 * already has shops on it. The NAME is what anybody reads. Enterprise keeps
 * both.
 *
 * The Super Admin can rename, reprice or add plans from the admin panel;
 * these four are the seeds.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        // Monthly prices in PKR. Recorded, not charged — there is no gateway,
        // so assigning a plan writes a payment row against the amount the shop
        // actually paid. The Super Admin reprices any of these in the panel.
        // Monthly prices in PKR. Recorded, not charged — there is no gateway,
        // so assigning a plan writes a payment row against the amount the shop
        // actually paid. The Super Admin reprices any of these in the panel.
        //
        // Every column below is a promise a salesperson can make on the phone
        // and the software will keep.
        $tiers = [
            [
                'code' => 'basic',
                'name' => 'Basic',
                'price' => 2499,
                'description' => 'One shop, one counter. Everything a single till needs, and two years of history.',
                'grace_period_days' => 7,
                'max_branches' => 1,
                'max_staff' => 3,
                'max_registers' => 1,
                'max_orders_month' => 5000,
                'max_products' => 1000,
                'max_storage_mb' => 512,
                'retention_months' => 24,
                // Offline selling is the one capability a plan gates, because
                // unlike a module it is not about the SHAPE of the trade —
                // every shop in Pakistan wants it. See PlanLimits.
                'max_offline_selling' => 0,
                'max_offline_days' => 1,
            ],
            [
                'code' => 'premium',
                'name' => 'Standard',
                'price' => 4999,
                'description' => 'A few branches and a team. Offline selling, and five years of history.',
                'grace_period_days' => 14,
                'max_branches' => 3,
                'max_staff' => 10,
                'max_registers' => 3,
                'max_orders_month' => 20000,
                'max_products' => 10000,
                'max_storage_mb' => 5120,
                'retention_months' => 60,
                'max_offline_selling' => 1,
                'max_offline_days' => 3,
            ],
            [
                'code' => 'pro',
                'name' => 'Pro',
                'price' => 7999,
                'description' => 'A real chain: ten branches, no catalog ceiling, and a week of trading offline.',
                'grace_period_days' => 21,
                'max_branches' => 10,
                'max_staff' => 25,
                'max_registers' => 8,
                'max_orders_month' => 100000,
                'max_products' => null,   // unlimited
                'max_storage_mb' => 20480,
                'retention_months' => 120,
                'max_offline_selling' => 1,
                'max_offline_days' => 7,
            ],
            [
                'code' => 'enterprise',
                'name' => 'Enterprise',
                'price' => 15000,
                'description' => 'Sized to the organisation. Nothing is capped, history is kept for good, and the terms are whatever was agreed.',
                'grace_period_days' => 30,
                'max_branches' => 50,
                'max_staff' => 200,
                'max_registers' => 50,
                // Null, not a large number: an organisation on a negotiated
                // contract has no meter, and a ceiling nobody agreed to is a
                // support call waiting to happen.
                'max_orders_month' => null,
                'max_products' => null,
                'max_storage_mb' => null,
                'retention_months' => null,
                'max_offline_selling' => 1,
                'max_offline_days' => 14,
            ],
        ];

        foreach ($tiers as $tier) {
            Plan::query()->updateOrCreate(
                ['code' => $tier['code']],
                [
                    ...$tier,
                    'billing_period_months' => 1,
                    'is_active' => true,
                ],
            );
        }

        $this->retireCombinationPlans();
    }

    /**
     * The four plans that existed only to spell out module combinations —
     * finance-manager, business-pos, online-business, business-pos-online.
     *
     * Delete the ones nobody is on. Deactivate the rest rather than deleting
     * them, so a shop mid-period keeps its subscription dates and its payment
     * history keeps pointing at the plan it was actually sold. They vanish from
     * the assign dropdown either way; an admin moves those tenants to Basic or
     * Premium when their period comes round.
     */
    private function retireCombinationPlans(): void
    {
        $retired = ['finance-manager', 'business-pos', 'online-business', 'business-pos-online'];

        Plan::query()->whereIn('code', $retired)->withCount('tenants')->get()
            ->each(function (Plan $plan): void {
                if ($plan->tenants_count > 0) {
                    $plan->forceFill(['is_active' => false])->save();

                    return;
                }
                $plan->delete();
            });
    }
}
