<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
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
        $plan = Plan::query()->where('code', 'business-pos-online')->first();

        $tenant = Tenant::query()->updateOrCreate(
            ['slug' => 'demo-mart'],
            [
                'business_name' => 'Demo Mart',
                'email' => 'demomart@shopos.test',
                'phone' => '+920000000001',
                'plan_id' => $plan?->id,
                'online_shop_enabled' => (bool) $plan?->online_shop_enabled,
                'subscription_starts_at' => now(),
                'subscription_ends_at' => now()->addYear(),
            ],
        );

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
