<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\TenantEntitlement;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlanLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * EXTRA CAPACITY, AS A ROW RATHER THAN A NUMBER.
 *
 * A shop on Standard gets ten staff accounts and needs thirteen. Writing 13
 * into `tenants.limits` gives it thirteen and loses everything else: why,
 * who is paying for the three, and when it ends. "Five extra users until the
 * end of Ramzan" could not be written down at all, so it was granted for
 * ever and quietly became the deal.
 *
 * An ADD-ON is capacity with a price. A TEMPORARY GRANT is capacity with an
 * end date. They are one table, and most of what follows is the arithmetic
 * of adding them to a ceiling without breaking the two cases that are not
 * addition: unlimited, and a window that has closed.
 */
class CapacityBoughtRatherThanAssumedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => 1, 'max_products' => 1000, 'is_active' => true,
        ]);

        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
            /**
             * STATED, NOT INHERITED.
             *
             * `provisioned()` assigns a staff ceiling of its own, and the
             * first version of this test asserted the platform DEFAULT of 5
             * against it. The arithmetic was right the whole time; the test
             * was describing a shop it had not built. A fixture that leaves
             * its own premise to a factory is a fixture that will be read as
             * a product failure.
             */
            'limits' => ['staff' => 5],
        ]);
    }

    /**
     * `array_merge`, NOT `+`.
     *
     * The union operator keeps the LEFT side's value for a key that appears
     * in both, so `$extra` could not override the default `starts_on` — and
     * the test for "a grant that has not started yet" silently built one
     * that started yesterday, failed, and looked like a product fault.
     */
    private function grant(string $key, int $qty, array $extra = []): TenantEntitlement
    {
        return TenantEntitlement::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id,
            'limit_key' => $key,
            'quantity' => $qty,
            'starts_on' => now()->subDay()->toDateString(),
        ], $extra));
    }

    private function limit(string $key): ?int
    {
        return PlanLimits::limit($this->shop->fresh(), $key);
    }

    public function test_the_plan_still_decides_when_nothing_was_bought(): void
    {
        $this->assertSame(1000, $this->limit('products'));
        $this->assertSame(5, $this->limit('staff'), 'The ceiling this shop was assigned.');
    }

    public function test_an_add_on_lifts_the_ceiling_without_replacing_it(): void
    {
        $this->grant('staff', 3, ['unit_price' => 400]);

        $this->assertSame(8, $this->limit('staff'), '5 assigned + 3 bought.');

        // AND THE BASELINE IS STILL READABLE. The whole point of a row is
        // that "assigned 5, plus 3 bought" survives, rather than one 8 that
        // explains nothing.
        $this->assertSame(5, PlanLimits::baseline($this->shop->fresh(), 'staff'));
        $this->assertSame(3, PlanLimits::granted($this->shop->fresh(), 'staff'));
    }

    public function test_grants_stack(): void
    {
        $this->grant('staff', 3, ['unit_price' => 400]);
        $this->grant('staff', 2, ['note' => 'Goodwill while the new branch opens']);

        $this->assertSame(10, $this->limit('staff'));
    }

    public function test_an_add_on_sits_on_top_of_an_assigned_limit_too(): void
    {
        // The admin assigned twelve; three more were then bought. 15, and
        // both halves still visible.
        $this->shop->forceFill(['limits' => ['staff' => 12]])->save();
        $this->grant('staff', 3, ['unit_price' => 400]);

        $this->assertSame(15, $this->limit('staff'));
    }

    /**
     * UNLIMITED PLUS ANYTHING IS STILL UNLIMITED.
     *
     * The one direction a grant must never move a shop. A null baseline that
     * came back as 0 + 3 would turn no ceiling at all into three.
     */
    public function test_a_grant_never_puts_a_ceiling_on_an_unlimited_shop(): void
    {
        $this->shop->plan->forceFill(['max_products' => null])->save();
        $this->grant('products', 500, ['unit_price' => 1000]);

        $this->assertNull($this->limit('products'));
        $this->assertTrue($this->row('products')['unlimited']);
    }

    private function row(string $key): array
    {
        foreach (PlanLimits::snapshot($this->shop->fresh()) as $r) {
            if ($r['key'] === $key) {
                return $r;
            }
        }

        $this->fail("No usage row for {$key}.");
    }

    // ── The window ───────────────────────────────────────────────────

    public function test_a_grant_that_has_not_started_gives_nothing_yet(): void
    {
        $this->grant('staff', 5, ['starts_on' => now()->addWeek()->toDateString()]);

        $this->assertSame(5, $this->limit('staff'));
    }

    public function test_a_grant_that_has_lapsed_gives_nothing_any_more(): void
    {
        $this->grant('staff', 5, [
            'starts_on' => now()->subMonths(2)->toDateString(),
            'ends_on' => now()->subDay()->toDateString(),
        ]);

        $this->assertSame(5, $this->limit('staff'));
    }

    /**
     * "UNTIL 31 DECEMBER" MEANS THROUGH THE 31st.
     *
     * The day it ends is a day it is still in force. Comparing against a
     * timestamp would end it at midnight on the 30th and take five staff
     * accounts away a day early — on a date somebody typed meaning the
     * opposite.
     */
    public function test_the_last_day_of_a_grant_is_still_a_day_of_it(): void
    {
        $this->grant('staff', 5, ['ends_on' => now()->toDateString()]);

        $this->assertSame(10, $this->limit('staff'));
    }

    /**
     * A LAPSED GRANT IS KEPT, NOT DELETED.
     *
     * It is the answer to why the shop had thirteen staff in November, and
     * deleting it would make that month's invoice unexplainable.
     */
    public function test_a_lapsed_grant_is_still_on_the_record(): void
    {
        $gone = $this->grant('staff', 5, [
            'starts_on' => now()->subMonths(2)->toDateString(),
            'ends_on' => now()->subDay()->toDateString(),
            'note' => 'Ramzan cover',
        ]);

        $this->assertTrue($gone->fresh()->hasExpired());
        $this->assertSame('Ramzan cover', $gone->fresh()->note);
        $this->assertNotNull(TenantEntitlement::withoutTenancy()->find($gone->id));
    }

    // ── What it is worth ─────────────────────────────────────────────

    public function test_an_add_on_knows_what_it_bills(): void
    {
        $this->assertSame(1200.0, $this->grant('staff', 3, ['unit_price' => 400])->periodValue());
    }

    /**
     * NULL IS NOT ZERO.
     *
     * Zero is "we agreed it is free". Null is "nobody set a price". An
     * invoice run that treated them alike would bill nothing and say
     * nothing.
     */
    public function test_a_free_grant_and_an_unpriced_one_are_different_answers(): void
    {
        $this->assertNull($this->grant('staff', 2)->periodValue());
        $this->assertSame(0.0, $this->grant('branches', 1, ['unit_price' => 0])->periodValue());
    }

    public function test_the_usage_screen_says_how_much_was_bought(): void
    {
        $this->grant('staff', 3, ['unit_price' => 400]);

        $row = $this->row('staff');
        $this->assertSame(8, $row['limit']);
        $this->assertSame(5, $row['baseline']);
        $this->assertSame(3, $row['granted']);
    }

    // ── The door ─────────────────────────────────────────────────────

    /**
     * BUILT AND REACHABLE.
     *
     * The first version of this had the model, the arithmetic and twelve
     * green tests, and no endpoint — so no admin could grant anything and
     * the whole thing was a capability nobody could use. `ReachableTest`
     * said so, which is exactly what it is for.
     */
    public function test_an_admin_can_sell_capacity_and_the_shop_gets_it(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $created = $this->as($admin)
            ->postJson("/api/v1/admin/tenants/{$this->shop->id}/entitlements", [
                'limit_key' => 'staff',
                'quantity' => 3,
                'unit_price' => 400,
                'note' => 'Sold with the Gulberg branch',
            ])
            ->assertCreated()
            ->json('data');

        $this->assertSame(8, $this->limit('staff'));
        $this->assertSame(3, $created['quantity']);
    }

    public function test_a_typo_in_the_meter_name_is_refused(): void
    {
        $admin = User::factory()->superAdmin()->create();

        // A free string in the database on purpose, but a row granting
        // "stafff" would lift nothing, explain nothing and never error.
        $this->as($admin)
            ->postJson("/api/v1/admin/tenants/{$this->shop->id}/entitlements", [
                'limit_key' => 'stafff', 'quantity' => 3,
            ])
            ->assertStatus(422);
    }

    public function test_the_list_shows_lapsed_grants_as_history(): void
    {
        $admin = User::factory()->superAdmin()->create();

        $this->grant('staff', 5, [
            'starts_on' => now()->subMonths(2)->toDateString(),
            'ends_on' => now()->subDay()->toDateString(),
            'note' => 'Ramzan cover',
        ]);
        $this->grant('branches', 1, ['unit_price' => 2000]);

        $rows = collect($this->as($admin)
            ->getJson("/api/v1/admin/tenants/{$this->shop->id}/entitlements")
            ->assertOk()->json('data'));

        $this->assertCount(2, $rows);
        $this->assertSame(['live', 'expired'], $rows->pluck('state')->sort()->reverse()->values()->all());
        $this->assertSame(2000.0, (float) $rows->firstWhere('limit_key', 'branches')['period_value']);
    }

    /**
     * ENDING IS NOT DELETING.
     *
     * A grant that has already been billed cannot be made never to have
     * existed. Withdrawing one ends it TODAY — inclusive, so the shop keeps
     * the capacity for the rest of the day rather than losing three staff
     * accounts mid-shift.
     */
    public function test_withdrawing_a_grant_ends_it_today_and_keeps_the_row(): void
    {
        $admin = User::factory()->superAdmin()->create();
        $grant = $this->grant('staff', 3, ['unit_price' => 400]);

        $this->as($admin)
            ->deleteJson("/api/v1/admin/tenants/{$this->shop->id}/entitlements/{$grant->id}")
            ->assertOk();

        $this->assertSame(now()->toDateString(), $grant->fresh()->ends_on->toDateString());
        $this->assertSame(8, $this->limit('staff'), 'Still in force for the rest of today.');
        $this->assertNotNull(TenantEntitlement::withoutTenancy()->find($grant->id));
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }
}
