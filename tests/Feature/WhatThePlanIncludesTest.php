<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\TenantEntitlement;
use App\Models\User;
use App\Support\PlanLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT A PLAN INCLUDES — branches, staff and tills.
 *
 * These three were assigned per shop and absent from every plan, so "Basic"
 * and "Enterprise" granted exactly the same organisation until somebody
 * typed otherwise. The ladder a customer was being sold did not exist in the
 * software.
 *
 * The arithmetic now has three terms and they stack in one order:
 *
 *     effective  =  (this shop's override  OR  the plan's included)  +  bought
 *
 * Each term is tested here on its own and then together, because the bug
 * this replaces was not any single term being wrong — it was that only one
 * of them existed.
 */
class WhatThePlanIncludesTest extends TestCase
{
    use RefreshDatabase;

    private function plan(array $extra = []): Plan
    {
        return Plan::query()->create(array_merge([
            'name' => 'Growth', 'code' => 'growth-'.uniqid(), 'price' => 9999,
            'billing_period_months' => 1, 'is_active' => true,
        ], $extra));
    }

    /** A shop with NO limits of its own, so the plan is the only voice. */
    private function shopOn(Plan $plan): Tenant
    {
        return Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            'limits' => [],
        ]);
    }

    // ── Term one: the plan ──────────────────────────────────────────────

    public function test_the_plan_decides_how_many_branches_are_included(): void
    {
        $shop = $this->shopOn($this->plan(['max_branches' => 3]));

        $this->assertSame(3, PlanLimits::limit($shop, 'branches'));
    }

    /**
     * A PLAN THAT SAYS NOTHING CHANGES NOTHING.
     *
     * Every plan that existed before these columns holds null in all three.
     * This is the test that keeps the migration safe: null must mean "the
     * platform default", never "unlimited", or every shop on the platform
     * woke up with no ceiling at all.
     */
    public function test_a_plan_with_no_opinion_falls_to_the_platform_default(): void
    {
        $shop = $this->shopOn($this->plan());

        $this->assertSame(1, PlanLimits::limit($shop, 'branches'));
        $this->assertSame(5, PlanLimits::limit($shop, 'staff'));
        $this->assertSame(2, PlanLimits::limit($shop, 'registers'));
    }

    /**
     * AND IT IS NEVER UNLIMITED.
     *
     * `max_products` null means unlimited two lines away in the same
     * registry. If that reading ever leaks across, this fails.
     */
    public function test_organisation_size_is_never_unlimited(): void
    {
        $shop = $this->shopOn($this->plan());

        $this->assertNotNull(PlanLimits::limit($shop, 'staff'));
        $this->assertNull(PlanLimits::limit($shop, 'products'), 'A plan with no product ceiling should be unlimited.');
    }

    // ── Term two: this one shop ─────────────────────────────────────────

    /**
     * ONE SHOP, MORE THAN ITS PLAN — without minting a bespoke plan.
     *
     * The reason the override stays: a chain of four on a three-branch plan
     * is an ordinary commercial conversation, and answering it by cloning
     * the plan is how a platform ends up with ninety of them.
     */
    public function test_a_shop_may_be_given_more_than_its_plan_includes(): void
    {
        $plan = $this->plan(['max_branches' => 3]);
        $shop = Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            'limits' => ['branches' => 6],
        ]);

        $this->assertSame(6, PlanLimits::limit($shop, 'branches'));
    }

    /** And less, which is the direction a downgrade negotiation goes. */
    public function test_a_shop_may_be_held_below_what_its_plan_includes(): void
    {
        $plan = $this->plan(['max_staff' => 50]);
        $shop = Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            'limits' => ['staff' => 10],
        ]);

        $this->assertSame(10, PlanLimits::limit($shop, 'staff'));
    }

    // ── Term three: what was bought ─────────────────────────────────────

    public function test_bought_capacity_stacks_on_top_of_the_plan(): void
    {
        $plan = $this->plan(['max_branches' => 3]);
        $shop = $this->shopOn($plan);

        TenantEntitlement::query()->create([
            'tenant_id' => $shop->id,
            'limit_key' => 'branches',
            'quantity' => 2,
            'unit_price' => 1500,
            'starts_on' => now()->subDay()->toDateString(),
        ]);

        $this->assertSame(5, PlanLimits::limit($shop->fresh(), 'branches'));
    }

    /**
     * ALL THREE TERMS AT ONCE.
     *
     * The override replaces the plan; the grant adds to whichever won. Get
     * the order wrong — add the grant to the plan and then let the override
     * replace the sum — and a shop loses capacity it paid for.
     */
    public function test_an_override_and_a_grant_stack_in_that_order(): void
    {
        $plan = $this->plan(['max_branches' => 3]);
        $shop = Tenant::factory()->provisioned()->create([
            'plan_id' => $plan->id,
            'limits' => ['branches' => 6],
        ]);

        TenantEntitlement::query()->create([
            'tenant_id' => $shop->id,
            'limit_key' => 'branches',
            'quantity' => 2,
            'starts_on' => now()->subDay()->toDateString(),
        ]);

        $this->assertSame(8, PlanLimits::limit($shop->fresh(), 'branches'));
    }

    // ── The admin console ───────────────────────────────────────────────

    public function test_the_platform_can_sell_a_plan_with_an_organisation_size(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $admin = User::factory()->superAdmin()->create();
        $token = $admin->createToken('t', ['access'])->plainTextToken;

        $plan = $this->withToken($token)->postJson('/api/v1/admin/plans', [
            'name' => 'Growth', 'code' => 'growth-'.uniqid(), 'price' => 9999,
            'billing_period_months' => 1, 'grace_period_days' => 7,
            'max_branches' => 3, 'max_staff' => 15, 'max_registers' => 6,
        ])->assertCreated()->json('data');

        $this->assertSame(3, $plan['limits']['branches']);
        $this->assertSame(15, $plan['limits']['staff']);
        $this->assertSame(6, $plan['limits']['registers']);
        // So an empty box on the screen can say what it will actually mean.
        $this->assertSame(1, $plan['defaults']['branches']);
    }

    /**
     * THE SHOP'S OWN SCREEN AGREES WITH THE ARITHMETIC.
     *
     * `snapshot()` is what both the admin console and the shopkeeper's
     * Subscription page read. A plan baseline that only `limit()` knew about
     * would leave both screens printing the old default.
     */
    public function test_the_usage_snapshot_reports_the_plan_baseline(): void
    {
        $shop = $this->shopOn($this->plan(['max_staff' => 15]));

        $staff = collect(PlanLimits::snapshot($shop))->firstWhere('key', 'staff');

        $this->assertSame(15, $staff['limit']);
    }
}
