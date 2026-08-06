<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Database\Seeder;

/**
 * Stable local credentials (survives migrate:fresh --seed):
 *   Super Admin : admin@shopos.test    / password
 *   Shop Owner  : owner@demomart.test  / password
 */
class DemoTenantSeeder extends Seeder
{
    public function run(): void
    {
        $plan = Plan::query()->where('code', 'premium')->first();

        $tenant = Tenant::query()->updateOrCreate(
            ['slug' => 'demo-mart'],
            [
                'business_name' => 'Demo Mart',
                'email' => 'demomart@shopos.test',
                'phone' => '+920000000001',
                'plan_id' => $plan?->id,
                'business_type' => 'mart',
                'subscription_starts_at' => now(),
                'subscription_ends_at' => now()->addYear(),
            ],
        );

        // The three layers a real tenant gets, in the order an admin walks
        // them: the type's proposal, then what this shop was actually given,
        // then how big it is. The plan above decides only what it pays.
        $tenant->applyModules(BusinessTypes::defaultFeatures('mart'), merge: false);
        $tenant->assignLimits(['branches' => 2, 'staff' => 10, 'registers' => 3]);

        User::query()->updateOrCreate(
            ['email' => 'owner@demomart.test'],
            [
                'tenant_id' => $tenant->id,
                'name' => 'Demo Owner',
                'password' => 'password',
                'role' => UserRole::ShopOwner,
                'status' => UserStatus::Active,
                'email_verified_at' => now(),
            ],
        );
    }
}
