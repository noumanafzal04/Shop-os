<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Modules;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A PLAN SAYS WHAT IT INCLUDES; A SHOP SAYS WHAT IT HAS.
 *
 * "Plan k andr modules set kr skty? Ya separate khud manual assign kryn?" —
 * both, in the order that keeps each honest. A plan carries a list: what a
 * shop is switched on with when it is first given the plan, and the line
 * between "in the plan" and "an add-on" on every screen after that. The shop's
 * own modules stay the shop's.
 *
 * "Agr usne add-on ly lia, kaise pta chaly ga is sy extra charges lene?" —
 * nobody has to know. Whatever a shop has beyond its plan is on its bill.
 */
class PlanPackagesTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function plan(string $code): Plan
    {
        return Plan::query()->where('code', $code)->firstOrFail();
    }

    private function on(array $features): array
    {
        return array_keys(array_filter(array_intersect_key($features, array_flip(Modules::keys()))));
    }

    // ── what a trade is offered on a plan ─────────────────────────────

    public function test_the_create_screen_is_told_what_basic_gives_a_mart_and_what_can_be_added(): void
    {
        $offer = $this->as($this->admin)
            ->getJson('/api/v1/admin/modules/offer?business_type=mart&plan_id='.$this->plan('basic')->id)
            ->assertOk()->json('data');

        $this->assertSame(['products', 'pos', 'inventory', 'labels'], $offer['included']);
        $this->assertContains('customers', $offer['addons']);
        $this->assertContains('kitchen', $offer['other']);
        $this->assertSame(['products', 'pos'], $offer['essential']);
        $this->assertSame('Basic', $offer['plan']['name']);
        $this->assertEqualsCanonicalizing($offer['included'], array_keys(array_filter($offer['modules'])));

        // No plan chosen yet is still an answer, not an error.
        $this->as($this->admin)->getJson('/api/v1/admin/modules/offer?business_type=food')
            ->assertOk()->assertJsonPath('data.plan', null);
        $this->as($this->admin)->getJson('/api/v1/admin/modules/offer')->assertStatus(422);
    }

    // ── a plan's own list ─────────────────────────────────────────────

    public function test_a_plan_can_be_told_what_it_includes_and_put_back_on_its_rung(): void
    {
        $basic = $this->plan('basic');

        // As seeded it is on its rung of the ladder, and says so.
        $listed = collect($this->as($this->admin)->getJson('/api/v1/admin/plans')->json('data'))->keyBy('code');
        $this->assertSame(['products', 'services', 'pos', 'labels'], $listed['basic']['modules']);
        $this->assertFalse($listed['basic']['modules_own']);

        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$basic->id}", ['modules' => ['products', 'pos', 'customers']])
            ->assertOk()
            ->assertJsonPath('data.modules', ['products', 'pos', 'customers'])
            ->assertJsonPath('data.modules_own', true);

        // …and the create screen now proposes that, with the trade still honoured.
        $offer = $this->as($this->admin)->getJson("/api/v1/admin/modules/offer?business_type=food&plan_id={$basic->id}")->json('data');
        $this->assertSame(['products', 'pos', 'customers', 'kitchen'], $offer['included']);

        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$basic->id}", ['modules' => null])
            ->assertOk()->assertJsonPath('data.modules_own', false);
        $this->assertNull($basic->fresh()->modules);
    }

    public function test_a_plan_cannot_include_a_module_that_does_not_exist(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/plans/'.$this->plan('basic')->id, ['modules' => ['products', 'teleportation']])
            ->assertStatus(422);

        $this->assertNull($this->plan('basic')->modules);
    }

    public function test_changing_what_a_plan_includes_never_changes_what_a_shop_already_has(): void
    {
        $basic = $this->plan('basic');
        $shop = Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => $basic->id]);
        $shop->applyModules(['products' => true, 'pos' => true, 'inventory' => true, 'labels' => true, 'customers' => true]);
        $before = $this->on($shop->fresh()->features);

        // The plan is re-thought to include almost nothing…
        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$basic->id}", ['modules' => ['products']])->assertOk();

        // …and the shop is exactly as it was. What moved is the label.
        $this->assertSame($before, $this->on($shop->fresh()->features));
        $package = $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->assertOk()->json('data.package');
        $this->assertSame(['products', 'pos'], $package['included']);
        $this->assertSame(['inventory', 'labels', 'customers'], $package['addons']);
    }

    // ── what an add-on costs, and what a shop owes ────────────────────

    public function test_add_on_prices_are_set_by_the_platform_owner_and_only_for_real_modules(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['customers' => 500, 'expenses' => 300, 'hrm' => 0]])
            ->assertOk()
            ->assertJsonPath('data.customers', 500)
            ->assertJsonPath('data.expenses', 300)
            // Nought is "free to add", and is not kept as if it were a price.
            ->assertJsonMissingPath('data.hrm');

        $this->as($this->admin)->getJson('/api/v1/admin/modules/prices')->assertOk()->assertJsonPath('data.customers', 500);
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['teleportation' => 100]])->assertStatus(422);
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['customers' => -5]])->assertStatus(422);

        // A shop's own people cannot price the platform.
        $owner = User::factory()->shopOwner(Tenant::factory()->create())->create();
        $this->as($owner)->putJson('/api/v1/admin/modules/prices', ['prices' => ['customers' => 1]])->assertForbidden();
        $this->as($this->admin)->getJson('/api/v1/admin/modules/prices')->assertJsonPath('data.customers', 500);
    }

    public function test_a_shop_that_takes_an_add_on_stays_on_its_plan_and_its_page_says_what_it_now_owes(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['customers' => 500, 'expenses' => 300]])->assertOk();

        $basic = $this->plan('basic');
        $shop = Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => $basic->id]);
        $shop->applyModules(['products' => true, 'pos' => true, 'inventory' => true, 'labels' => true]);

        $package = fn () => $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->assertOk()->json('data.package');
        $this->assertSame([], $package()['addons']);
        $this->assertEquals(2499, $package()['bill']['total']);

        // The admin switches Customers & Khata on for this one shop.
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => ['products' => true, 'pos' => true, 'inventory' => true, 'labels' => true, 'customers' => true],
        ])->assertOk();

        $after = $package();
        // Same plan. No plan was made for it, by anybody or by anything.
        $this->assertSame($basic->id, $shop->fresh()->plan_id);
        $this->assertSame(5, Plan::query()->count() + 1, 'a plan appeared from somewhere');
        $this->assertSame(['customers'], $after['addons']);
        $this->assertSame('Customers & Khata', $after['bill']['addons'][0]['label']);
        $this->assertEquals(500, $after['bill']['addons'][0]['monthly']);
        $this->assertEquals(2999, $after['bill']['total']);
        // Expenses is still on offer to it, at its price.
        $this->assertContains('expenses', $after['offer']['addons']);
    }

    public function test_one_shop_can_be_given_its_own_price_for_an_add_on(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['customers' => 500]])->assertOk();
        $shop = Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => $this->plan('basic')->id]);
        $modules = ['products' => true, 'pos' => true, 'inventory' => true, 'labels' => true, 'customers' => true];

        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => $modules, 'addon_prices' => ['customers' => 300, 'teleportation' => 5],
        ])->assertOk();

        $this->assertSame(['customers' => 300.0], array_map('floatval', $shop->fresh()->addon_prices));
        $bill = $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->json('data.package.bill');
        $this->assertEquals(300, $bill['addons'][0]['monthly']);
        $this->assertEquals(500, $bill['addons'][0]['listed']);
        $this->assertEquals(2799, $bill['total']);

        // Sending the modules alone leaves the price it was given…
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", ['modules' => $modules])->assertOk();
        $this->assertNotNull($shop->fresh()->addon_prices);
        // …and an empty answer puts it back on the platform's.
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", ['modules' => $modules, 'addon_prices' => []])->assertOk();
        $this->assertNull($shop->fresh()->addon_prices);
        $this->assertEquals(2999, $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->json('data.package.bill.total'));
    }
}
