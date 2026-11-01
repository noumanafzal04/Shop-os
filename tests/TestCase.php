<?php

namespace Tests;

use App\Actions\Auth\IssueTokensAction;
use App\Actions\Demo\CreateDemoShopAction;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * A BESPOKE PLAN, made by an admin for one big customer — the old
     * Enterprise figures. The seeded ladder has three rungs since launch
     * (Basic · Standard · Premium); a test that needs a plan off the ladder,
     * dearer and with a longer grace, makes this one.
     */
    /**
     * A DEMO SHOP, as the landing page used to open one (`POST /demo`, withdrawn
     * at launch). The shops already open keep their keep/convert path and their
     * prune, so the tests of those make one the same way the door did.
     *
     * @return array{tenant: Tenant, owner: User, token: string}
     */
    protected function openDemoShop(string $trade): array
    {
        ['tenant' => $tenant, 'owner' => $owner] = app(CreateDemoShopAction::class)->execute($trade);
        $issued = app(IssueTokensAction::class)->execute($owner, 'demo');

        return ['tenant' => $tenant, 'owner' => $owner, 'token' => (string) $issued['access_token']];
    }

    protected function bespokePlan(): Plan
    {
        return Plan::query()->updateOrCreate(['code' => 'enterprise'], [
            'name' => 'Enterprise',
            'price' => 15000,
            'billing_period_months' => 1,
            'grace_period_days' => 30,
            'max_branches' => 50,
            'max_warehouses' => 20,
            'max_staff' => 200,
            'max_registers' => 50,
            'max_orders_month' => null,
            'max_products' => null,
            'max_storage_mb' => null,
            'retention_months' => null,
            'max_offline_selling' => 1,
            'max_offline_days' => 14,
            'is_active' => true,
        ]);
    }
}
