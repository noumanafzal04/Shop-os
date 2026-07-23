<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

class PlanSeeder extends Seeder
{
    /**
     * Three plans, three capability bundles. A plan's `features` are the
     * plan-gated modules it grants; on assignment they're merged over the
     * shop's business-type defaults (see AssignPlanAction). Modules a plan
     * doesn't name (products, inventory, images…) come from the business type.
     *
     *   Business/POS            → in-shop till + back-office, NO online
     *   Online Business         → sell online only, NO POS / expense manager
     *   Business/POS + Online   → everything
     */
    public function run(): void
    {
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
                'features' => ['pos' => true, 'expenses' => true, 'marketplace' => false, 'delivery' => false, 'reservations' => false],
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
                'features' => ['pos' => false, 'expenses' => false, 'marketplace' => true],
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
                'features' => ['pos' => true, 'expenses' => true, 'marketplace' => true],
                'is_active' => true,
            ],
        );
    }
}
