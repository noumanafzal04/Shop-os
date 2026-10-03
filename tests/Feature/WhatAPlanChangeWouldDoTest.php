<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT A PLAN CHANGE WOULD DO, ASKED BEFORE IT DOES IT.
 *
 * The dangerous admin action is not the upgrade, it is the downgrade that
 * looks like a price change and is quietly also a capacity change. An admin
 * moving a shop from Pro to Basic is thinking about Rs 5,500 a month; they
 * are not thinking about the six staff accounts that shop has and the three
 * the new plan includes.
 *
 * So the preview answers the question nobody thinks to ask, it refuses
 * nothing, and it writes nothing.
 */
class WhatAPlanChangeWouldDoTest extends TestCase
{
    use RefreshDatabase;

    private function plan(string $name, array $limits = []): Plan
    {
        return Plan::query()->create(array_merge([
            'name' => $name, 'code' => strtolower($name).'-'.uniqid(),
            'price' => 2499, 'billing_period_months' => 1, 'is_active' => true,
        ], $limits));
    }

    private function admin(): string
    {
        return User::factory()->superAdmin()->create()->createToken('t', ['access'])->plainTextToken;
    }

    public function test_it_says_what_the_price_difference_is(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $basic = $this->plan('Basic', ['price' => 2499]);
        $pro = $this->plan('Pro', ['price' => 7999]);
        $shop = Tenant::factory()->provisioned()->create(['plan_id' => $basic->id, 'limits' => []]);

        $this->withToken($this->admin())
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$pro->id}")
            ->assertOk()
            ->assertJsonPath('data.from.name', 'Basic')
            ->assertJsonPath('data.to.name', 'Pro')
            ->assertJsonPath('data.price_difference', 5500);
    }

    /**
     * THE WHOLE REASON THIS ENDPOINT EXISTS.
     *
     * Four branches open, a plan that includes one: the preview names it
     * before anybody presses anything.
     */
    public function test_a_downgrade_names_every_ceiling_the_shop_would_be_over(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $pro = $this->plan('Pro', ['price' => 7999, 'max_branches' => 10]);
        $basic = $this->plan('Basic', ['price' => 2499, 'max_branches' => 1]);
        $shop = Tenant::factory()->provisioned()->create(['plan_id' => $pro->id, 'limits' => []]);

        // Main already exists; three more makes four.
        foreach (['Model Town', 'DHA', 'Johar Town'] as $name) {
            Branch::withoutTenancy()->create([
                'tenant_id' => $shop->id, 'name' => $name, 'is_active' => true,
            ]);
        }

        $excess = collect(
            $this->withToken($this->admin())
                ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$basic->id}")
                ->assertOk()
                ->json('data.excess'),
        )->keyBy('key');

        $this->assertArrayHasKey('branches', $excess->all(), 'A downgrade past the branch ceiling was not mentioned.');
        $this->assertSame(1, $excess['branches']['to']);
        $this->assertSame(3, $excess['branches']['excess']);
    }

    /** An upgrade has no excess to report, and says so by saying nothing. */
    public function test_an_upgrade_reports_no_excess(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $basic = $this->plan('Basic', ['max_branches' => 1, 'max_staff' => 3]);
        $pro = $this->plan('Pro', ['max_branches' => 10, 'max_staff' => 25]);
        $shop = Tenant::factory()->provisioned()->create(['plan_id' => $basic->id, 'limits' => []]);

        $this->withToken($this->admin())
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$pro->id}")
            ->assertOk()
            ->assertJsonCount(0, 'data.excess');
    }

    /**
     * A PREVIEW THAT CHANGES SOMETHING IS NOT A PREVIEW.
     *
     * The implementation builds the hypothetical shop in memory precisely so
     * that nothing — not a sale, not a sync, not a second admin reading the
     * same row — ever sees a plan nobody agreed to.
     */
    public function test_asking_changes_nothing(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $basic = $this->plan('Basic');
        $pro = $this->plan('Pro');
        $shop = Tenant::factory()->provisioned()->create(['plan_id' => $basic->id, 'limits' => []]);

        $this->withToken($this->admin())
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$pro->id}")
            ->assertOk();

        $this->assertSame($basic->id, $shop->fresh()->plan_id, 'A preview moved the shop onto the other plan.');
    }

    /**
     * AND THE SHOP'S OWN OVERRIDE SURVIVES THE PREVIEW.
     *
     * A shop given 15 staff by hand does not lose them to a plan that
     * includes 3 — the override beats the plan, so there is no excess to
     * report and the preview must not invent one.
     */
    public function test_an_override_is_not_mistaken_for_an_excess(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);

        $pro = $this->plan('Pro', ['max_staff' => 25]);
        $basic = $this->plan('Basic', ['max_staff' => 3]);
        $shop = Tenant::factory()->provisioned()->create([
            'plan_id' => $pro->id,
            'limits' => ['staff' => 15],
        ]);

        $rows = collect(
            $this->withToken($this->admin())
                ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$basic->id}")
                ->assertOk()
                ->json('data.rows'),
        )->keyBy('key');

        $this->assertSame(15, $rows['staff']['to'], 'The preview let a plan overwrite this shop\'s own ceiling.');
    }
}
