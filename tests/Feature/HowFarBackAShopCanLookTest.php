<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Plan;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Retention;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * HOW FAR BACK A SHOP CAN LOOK — stated, because it was not.
 *
 * Plans sell a retention window: two years of history on the cheap one, five
 * on the next. Nothing in the schema knew that. The word "retention"
 * appeared nowhere in `app/` except on a rider application, so the promise
 * lived entirely in whatever a salesperson said on the phone — and a shop
 * had no way to read what it had been sold.
 *
 * The window is now ENFORCED, and the support cost that held it back for a
 * day is paid in a specific way: nothing is ever hidden silently. Every
 * fenced read carries `meta.retention` — the months, the date history starts
 * from, and whether this particular request reached past it — so a shop that
 * cannot find last March is told its plan keeps 24 months rather than left
 * to conclude its records are gone.
 *
 * See `ArchivedIsNotDeletedTest` for the other half: what the fence must
 * never touch.
 */
class HowFarBackAShopCanLookTest extends TestCase
{
    use RefreshDatabase;

    private function shopOn(?int $retentionMonths): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => 1, 'is_active' => true,
            'retention_months' => $retentionMonths,
        ]);

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    public function test_a_shop_can_read_the_window_it_was_sold(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [, $owner] = $this->shopOn(24);

        $this->as($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()
            ->assertJsonPath('data.plan.retention_months', 24);
    }

    /**
     * NULL IS NO LIMIT, AND IT IS THE DEFAULT.
     *
     * Every plan that existed before this column did keeps everything. A
     * column appearing must never narrow a shop's window.
     */
    public function test_a_plan_with_no_window_set_keeps_everything(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [, $owner] = $this->shopOn(null);

        $this->as($owner)->getJson('/api/v1/shop/subscription')
            ->assertOk()
            ->assertJsonPath('data.plan.retention_months', null);
    }

    public function test_the_platform_can_set_a_window_on_a_plan(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $admin = User::factory()->superAdmin()->create();

        $plan = $this->as($admin)->postJson('/api/v1/admin/plans', [
            'name' => 'Basic', 'code' => 'basic-'.uniqid(), 'price' => 2499,
            'billing_period_months' => 1, 'grace_period_days' => 7, 'retention_months' => 24,
        ])->assertCreated()->json('data');

        $this->assertSame(24, $plan['limits']['retention_months']);
    }

    /**
     * THE WINDOW IS THE WINDOW.
     *
     * A four-year-old sale is not on a two-year plan's list. This is the
     * mutation target for the whole feature: delete the `Retention::fence`
     * call in `SaleController::filtered` and this is the test that fails.
     */
    public function test_a_sale_older_than_the_window_is_archived(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(24);
        $old = $this->saleAgedBy($shop, 4);

        $found = collect(
            $this->as($owner)->getJson('/api/v1/sales?per_page=100')->assertOk()->json('data'),
        )->pluck('id');

        $this->assertFalse($found->contains($old->id), 'A sale past the plan window was still listed.');
    }

    /**
     * AND THE SHOP IS TOLD, ON EVERY READ.
     *
     * Not only on the read that hits the wall. A notice that appears for the
     * first time at the moment history runs out teaches a shopkeeper nothing
     * — by then they are already on the phone. `reached` is the part that
     * changes with the request.
     */
    public function test_the_list_says_how_far_back_it_goes(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [, $owner] = $this->shopOn(24);

        $inside = $this->as($owner)->getJson('/api/v1/sales')->assertOk();
        $inside->assertJsonPath('meta.retention.months', 24);
        $inside->assertJsonPath('meta.retention.reached', false);
        $this->assertSame(
            now()->subMonthsNoOverflow(24)->toDateString(),
            $inside->json('meta.retention.from'),
        );

        $this->as($owner)->getJson('/api/v1/sales?from=2019-01-01')
            ->assertOk()
            ->assertJsonPath('meta.retention.reached', true);
    }

    /** A plan that keeps everything says nothing, because there is nothing to say. */
    public function test_an_unlimited_plan_carries_no_notice(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(null);
        $old = $this->saleAgedBy($shop, 4);

        $response = $this->as($owner)->getJson('/api/v1/sales?per_page=100')->assertOk();

        $this->assertNull($response->json('meta.retention'));
        $this->assertContains($old->id, collect($response->json('data'))->pluck('id')->all());
    }

    /**
     * ARCHIVED, NOT DELETED — the whole design in one test.
     *
     * The same shop, the same rows, a wider plan: last year is back. If the
     * fence ever became a delete this is the test that would say so, and it
     * is the reason an upgrade is worth buying.
     */
    public function test_raising_the_plan_brings_the_history_back(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(24);
        $old = $this->saleAgedBy($shop, 4);

        $this->assertNotContains(
            $old->id,
            collect($this->as($owner)->getJson('/api/v1/sales?per_page=100')->json('data'))->pluck('id')->all(),
        );

        $shop->plan->update(['retention_months' => 120]);

        $this->assertContains(
            $old->id,
            collect($this->as($owner)->getJson('/api/v1/sales?per_page=100')->json('data'))->pluck('id')->all(),
            'The rows were gone, not archived.',
        );
    }

    /**
     * A REPORT CANNOT OUTRUN THE WINDOW EITHER.
     *
     * Thirteen report endpoints resolve their period through one method, and
     * the clamp lives there. A report that quietly answered for five years
     * while the list beside it stopped at two would make the list look
     * broken.
     */
    public function test_a_report_window_is_clamped_to_the_plan(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(24);

        // Money, not just a notice. The first version of this test asserted
        // only `meta.retention`, which comes from the plan and would have
        // stayed green with the clamp deleted — the notice and the clamp are
        // computed independently, so one cannot stand as evidence for the
        // other.
        $this->saleAgedBy($shop, 4);

        $response = $this->as($owner)
            ->getJson('/api/v1/reports/summary?period=custom&from=2019-01-01&to='.now()->toDateString())
            ->assertOk();

        $response->assertJsonPath('meta.retention.reached', true);
        $this->assertSame(now()->subMonthsNoOverflow(24)->toDateString(), $response->json('meta.retention.from'));
        $this->assertEquals(
            0,
            $response->json('data.totals.revenue') ?? $response->json('data.revenue'),
            'A report counted revenue from outside the plan window.',
        );
    }

    /**
     * THE MONTH-END BOUNDARY.
     *
     * `subMonths` on 31 March gives 3 March of the previous month-count,
     * which moves the horizon FORWARD and hides two days the shop paid for.
     * The same overflow bug that broke the billing anniversary, in the other
     * direction.
     */
    public function test_the_horizon_does_not_overflow_a_short_month(): void
    {
        $this->travelTo('2026-03-31');

        $plan = Plan::query()->create([
            'name' => 'Edge', 'code' => 'edge-'.uniqid(), 'price' => 1,
            'billing_period_months' => 1, 'is_active' => true, 'retention_months' => 1,
        ]);
        $shop = Tenant::factory()->provisioned()->create(['plan_id' => $plan->id]);

        $this->assertSame('2026-02-28', Retention::horizon($shop->fresh())->toDateString());

        $this->travelBack();
    }

    private function saleAgedBy(Tenant $shop, int $years): Sale
    {
        return Sale::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'invoice_number' => 'INV-OLD-'.uniqid(),
            'channel' => 'walk_in',
            'status' => 'completed',
            'subtotal' => 100, 'discount' => 0, 'tax' => 0, 'total' => 100,
            'amount_paid' => 100, 'change_due' => 0,
            'payment_method' => 'cash',
            'sold_at' => now()->subYears($years),
            'created_at' => now()->subYears($years),
            'updated_at' => now()->subYears($years),
        ]);
    }
}
