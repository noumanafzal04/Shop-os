<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

class PlanSeeder extends Seeder
{
    /**
     * Starter plans. Two orthogonal dimensions:
     *  - WHICH MODULES a plan grants (its `features`) — merged over the shop's
     *    business-type defaults on assignment (see AssignPlanAction).
     *  - HOW MUCH it allows (its limits) — a shared baseline every plan starts
     *    from. Limits are NOT tiered here on purpose: the model is one common
     *    baseline for everyone, and the odd tenant who needs more gets a
     *    per-tenant EXTEND (tenants.limit_overrides) instead of a bespoke plan.
     *    The Super Admin can create/rename/reprice any plan and set any limits
     *    from the admin panel — these three are just sensible seeds.
     *
     *   Finance Manager         → books only: expenses/income/cashbook, NO till
     *   Business/POS            → in-shop till + back-office, NO online
     *   Online Business         → sell online only, NO POS / expense manager
     *   Business/POS + Online   → everything
     */
    public function run(): void
    {
        // Common baseline limits shared by every seeded plan (NULL = unlimited).
        // Real ceilings are set by the admin per plan; extensions are per-tenant.
        $limits = [
            'max_products' => 1000,
            'max_branches' => 1,
            // Checkout lanes: enough for a small mart out of the box; a big
            // one gets a per-tenant extend rather than a bespoke plan.
            'max_registers' => 3,
            'max_staff' => 15,
            'max_storage_mb' => 1024,
            'max_orders_month' => null, // never cap ringing up a sale
        ];

        // Books only — the standalone Expense/Income manager. Sold to offices,
        // agencies, NGOs and freelancers who have no catalog, no stock and no
        // till: they only want to know where the money goes. Every selling
        // module is explicitly false so assigning this plan STRIPS them even if
        // the business type had switched them on.
        Plan::query()->updateOrCreate(
            ['code' => 'finance-manager'],
            [
                'name' => 'Finance Manager',
                'description' => 'Track expenses, other income and a day-by-day cashbook, with reports. No shop, no stock, no POS till.',
                'price' => 0,
                'billing_period_months' => 1,
                'online_shop_enabled' => false,
                'grace_period_days' => 7,
                'features' => [
                    'expenses' => true, 'pos' => false, 'marketplace' => false,
                    'products' => false, 'inventory' => false, 'services' => false,
                    'delivery' => false, 'reservations' => false, 'dine_in' => false,
                ],
                ...$limits,
                // No catalog on this plan — a product ceiling would be noise.
                'max_products' => 0,
                // …and no till, so no lanes either.
                'max_registers' => 0,
                'is_active' => true,
            ],
        );

        // In-shop only: POS till, expense manager, reports — no marketplace.
        Plan::query()->updateOrCreate(
            ['code' => 'business-pos'],
            [
                'name' => 'Business / POS',
                'description' => 'Run the shop at the counter: POS till (works offline), products, inventory, expenses, invoices and reports. No online store.',
                'price' => 0,
                'billing_period_months' => 1,
                'online_shop_enabled' => false,
                'grace_period_days' => 7,
                // Carry the derived 'products' key (= pos || marketplace) so a
                // seeded plan matches exactly what PlanController::normalizeModules
                // stores — a first admin-panel edit then changes nothing implicit.
                'features' => ['pos' => true, 'expenses' => true, 'marketplace' => false, 'products' => true, 'delivery' => false, 'reservations' => false],
                ...$limits,
                'is_active' => true,
            ],
        );

        // Online only: sell on the marketplace. No POS till, no expense manager
        // (a lean online seller / small stall doesn't need the back-office).
        Plan::query()->updateOrCreate(
            ['code' => 'online-business'],
            [
                'name' => 'Online Business',
                'description' => 'Sell online: marketplace listing, online orders, delivery and reviews. Requires internet. No in-shop POS till.',
                'price' => 0,
                'billing_period_months' => 1,
                'online_shop_enabled' => true,
                'grace_period_days' => 7,
                'features' => ['pos' => false, 'expenses' => false, 'marketplace' => true, 'products' => true],
                ...$limits,
                'is_active' => true,
            ],
        );

        // Everything: counter + online.
        Plan::query()->updateOrCreate(
            ['code' => 'business-pos-online'],
            [
                'name' => 'Business / POS + Online Business',
                'description' => 'Everything: the in-shop POS till plus the full online store (marketplace, online orders, delivery, reservations, reviews).',
                'price' => 0,
                'billing_period_months' => 1,
                'online_shop_enabled' => true,
                'grace_period_days' => 7,
                'features' => ['pos' => true, 'expenses' => true, 'marketplace' => true, 'products' => true],
                ...$limits,
                'is_active' => true,
            ],
        );
    }
}
