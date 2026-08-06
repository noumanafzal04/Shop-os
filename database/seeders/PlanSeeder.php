<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * The starter plans: Basic → Premium → Enterprise. One ladder, three rungs.
 *
 * A plan answers one question — what does this business pay, and how much may
 * it hold. It grants no modules, no branches and no staff seats: those are
 * assigned to each shop when an admin creates it, so a petrol pump, a
 * restaurant and a tyre shop can all sit on the same Basic plan and each keep
 * the modules its trade actually needs.
 *
 * That is why there is no "Online" plan and no "Finance Manager" plan any more.
 * An office that only wants the cashbook is a Basic tenant with Expense Manager
 * ticked and nothing else; a shop that sells online is a tenant with the Online
 * Store module on. Neither needs a plan of its own — which is what four
 * combination plans were quietly costing before: every new sellable module
 * doubled the list. Three rungs that differ only in size will still be three
 * rungs after the tenth module ships.
 *
 * The Super Admin can rename, reprice or add plans from the admin panel; these
 * three are the seeds.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        // Monthly prices in PKR. Recorded, not charged — there is no gateway,
        // so assigning a plan writes a payment row against the amount the shop
        // actually paid. The Super Admin reprices any of these in the panel.
        $tiers = [
            [
                'code' => 'basic',
                'name' => 'Basic',
                'price' => 2500,
                'description' => 'For a single shop: a working catalog and room to grow into.',
                'grace_period_days' => 7,
                'max_products' => 1000,
                'max_storage_mb' => 512,
            ],
            [
                'code' => 'premium',
                'name' => 'Premium',
                'price' => 6000,
                'description' => 'For a growing business: a large catalog with photos on everything.',
                'grace_period_days' => 14,
                'max_products' => 10000,
                'max_storage_mb' => 5120,
            ],
            [
                'code' => 'enterprise',
                'name' => 'Enterprise',
                'price' => 15000,
                'description' => 'For a chain: no catalog ceiling, and the longest grace before anything locks.',
                'grace_period_days' => 30,
                'max_products' => null,   // unlimited
                'max_storage_mb' => 20480,
            ],
        ];

        foreach ($tiers as $tier) {
            Plan::query()->updateOrCreate(
                ['code' => $tier['code']],
                [
                    ...$tier,
                    'billing_period_months' => 1,
                    // Never cap ringing up a sale. A shop that hits a ceiling
                    // mid-afternoon stops trading, and no amount of billing is
                    // worth that.
                    'max_orders_month' => null,
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
