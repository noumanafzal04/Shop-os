<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\PlatformSetting;
use App\Models\Tenant;
use App\Models\User;
use App\Support\ModulePackages;
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

    // ── one box changed is one price changed ──────────────────────────

    public function test_a_price_changed_on_one_screen_does_not_undo_one_set_from_another(): void
    {
        // The list was saved whole — every box a screen held, as it had loaded
        // them. Two screens open on it, both showing Customers & Khata at 500:
        $prices = fn (array $body) => $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', $body);
        $prices(['prices' => ['customers' => 500]])->assertOk();

        // The first prices Delivery.
        $prices(['changes' => ['delivery' => 300]])->assertOk()
            ->assertJsonPath('data.delivery', 300)
            ->assertJsonPath('data.customers', 500);

        // The second, still showing the list as it loaded it — no Delivery —
        // re-prices Customers & Khata. It says what it changed, and Delivery
        // is not something it changed.
        $prices(['changes' => ['customers' => 700]])->assertOk()
            ->assertJsonPath('data.customers', 700)
            ->assertJsonPath('data.delivery', 300);

        $this->as($this->admin)->getJson('/api/v1/admin/modules/prices')
            ->assertJsonPath('data.delivery', 300)
            ->assertJsonPath('data.customers', 700);
    }

    public function test_a_box_cleared_takes_that_price_off_and_no_other(): void
    {
        $prices = fn (array $body) => $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', $body);
        $prices(['prices' => ['customers' => 500, 'delivery' => 300, 'expenses' => 200]])->assertOk();

        $prices(['changes' => ['customers' => null]])->assertOk()
            ->assertJsonMissingPath('data.customers')
            ->assertJsonPath('data.delivery', 300)
            ->assertJsonPath('data.expenses', 200);

        // Nought is the same as blank: free to add, and not kept as a price.
        $prices(['changes' => ['delivery' => 0]])->assertOk()
            ->assertJsonMissingPath('data.delivery')
            ->assertJsonPath('data.expenses', 200);

        // And the bill follows the list, not a memory of it.
        $basic = $this->plan('basic');
        $shop = Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => $basic->id]);
        $shop->applyModules(['products' => true, 'pos' => true, 'customers' => true, 'expenses' => true]);
        $bill = $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$shop->id}")->assertOk()->json('data.package.bill');
        $monthly = collect($bill['addons'])->pluck('monthly', 'key');
        $this->assertSame(0, (int) $monthly['customers']);
        $this->assertSame(200, (int) $monthly['expenses']);
    }

    public function test_what_was_changed_is_held_to_the_same_rules_as_the_list(): void
    {
        $prices = fn (array $body) => $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', $body);
        $prices(['prices' => ['customers' => 500]])->assertOk();

        $prices(['changes' => ['teleportation' => 100]])->assertStatus(422)->assertJsonValidationErrors('changes');
        $prices(['changes' => ['customers' => -5]])->assertStatus(422);
        // Neither, or both: which of them is meant is not something to guess.
        $prices([])->assertStatus(422)->assertJsonValidationErrors('changes');
        $prices(['changes' => ['customers' => 1], 'prices' => ['customers' => 2]])->assertStatus(422);

        $owner = User::factory()->shopOwner(Tenant::factory()->create())->create();
        $this->as($owner)->putJson('/api/v1/admin/modules/prices', ['changes' => ['customers' => 1]])->assertForbidden();

        // None of that priced anything.
        $this->as($this->admin)->getJson('/api/v1/admin/modules/prices')->assertExactJson([
            'success' => true, 'message' => 'OK', 'data' => ['customers' => 500], 'errors' => [], 'meta' => [],
        ]);
    }

    public function test_the_whole_list_is_still_taken_from_the_screen_already_out_there(): void
    {
        // The backend is deployed before the panel: for that while, the
        // screen in people's browsers still sends the list whole.
        $prices = fn (array $body) => $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', $body);
        $prices(['prices' => ['customers' => 500, 'delivery' => 300]])->assertOk();

        $prices(['prices' => ['customers' => 600]])->assertOk()
            ->assertJsonPath('data.customers', 600)
            ->assertJsonMissingPath('data.delivery');
        // And emptied, which is how that screen clears its last price.
        $prices(['prices' => []])->assertOk()->assertJsonMissingPath('data.customers');
    }

    public function test_a_change_starts_from_the_list_as_it_is_and_not_as_it_was_remembered(): void
    {
        $prices = fn (array $body) => $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', $body);
        $prices(['prices' => ['customers' => 500]])->assertOk();
        // Read once: the settings are now remembered for five minutes.
        $this->as($this->admin)->getJson('/api/v1/admin/modules/prices')->assertJsonPath('data.customers', 500);

        // Another server prices Delivery. This one's memory is none the wiser.
        PlatformSetting::query()->whereKey('module_addon_prices')
            ->update(['value' => json_encode(['customers' => 500, 'delivery' => 300])]);

        $prices(['changes' => ['expenses' => 200]])->assertOk()
            ->assertJsonPath('data.expenses', 200)
            ->assertJsonPath('data.customers', 500)
            ->assertJsonPath('data.delivery', 300);
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

    // ── where a price can ever be charged ─────────────────────────────

    public function test_a_module_in_every_plan_is_said_to_be_an_add_on_nowhere(): void
    {
        // The question that found this: "I put Rs 25,000 on Products and
        // nothing changed." Nothing could — Products is in every plan, and no
        // trade that sells can open without it, so no shop ever has it as an
        // add-on. The price list has to be able to say so.
        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        $this->assertSame([], $reach['products']['plans']);
        $this->assertSame([], $reach['pos']['plans']);
        $this->assertSame(0, $reach['products']['shops']);
    }

    public function test_a_module_past_a_plan_says_which_plans_it_is_an_add_on_on(): void
    {
        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        // Delivery arrives with Pro: an add-on on the two rungs below it, and
        // on neither of the two that include it. Cheapest first.
        $this->assertSame(['Basic', 'Standard'], $reach['delivery']['plans']);
        // Customers & Khata arrives with Standard.
        $this->assertSame(['Basic'], $reach['customers']['plans']);
        // Every real module is answered for, and nothing else.
        $this->assertEqualsCanonicalizing(Modules::keys(), array_keys($reach));
    }

    public function test_it_counts_the_shops_that_have_it_as_an_add_on_today(): void
    {
        $basic = $this->plan('basic');
        $pro = $this->plan('pro');

        $withIt = fn (Plan $plan, array $extra = []) => Tenant::factory()
            ->create(['business_type' => 'mart', 'plan_id' => $plan->id] + $extra)
            ->applyModules(['products' => true, 'pos' => true, 'inventory' => true, 'labels' => true, 'delivery' => true, 'marketplace' => true, 'images' => true]);

        $withIt($basic);                       // an add-on: Basic does not include delivery
        $withIt($basic);                       // and again
        $withIt($pro);                         // NOT an add-on: Pro includes it
        $withIt($basic, ['is_demo' => true, 'demo_expires_at' => now()->addDay()]); // a demo pays nothing
        Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => $basic->id])
            ->applyModules(['products' => true, 'pos' => true]); // on Basic, without it
        Tenant::factory()->create(['business_type' => 'mart', 'plan_id' => null])
            ->applyModules(['products' => true, 'pos' => true, 'delivery' => true, 'marketplace' => true, 'images' => true]); // on no plan: nothing to be past, and no bill

        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        $this->assertSame(2, $reach['delivery']['shops']);
        // Having Products is having what the plan gave: nobody pays for it.
        $this->assertSame(0, $reach['products']['shops']);
    }

    public function test_a_module_every_plan_includes_can_still_be_on_somebodys_bill(): void
    {
        // What the first answer got wrong, on the very database it was asked
        // about: a business that only keeps books, on Enterprise, had been
        // given Products. Products is not usual for that trade, so no plan
        // includes it FOR that trade — it is an add-on there, and the Rs
        // 25,000 was on that business's bill while the screen said it was
        // charged to nobody.
        $enterprise = $this->plan('enterprise');
        $books = Tenant::factory()->create(['business_name' => 'Ledger & Sons', 'business_type' => 'finance', 'plan_id' => $enterprise->id]);
        $books->applyModules(['expenses' => true, 'products' => true]);

        $this->as($this->admin)->putJson('/api/v1/admin/modules/prices', ['prices' => ['products' => 25000]])->assertOk();

        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        // Still in every plan, for every trade that usually takes it…
        $this->assertSame([], $reach['products']['plans']);
        // …and on one bill all the same. The shop is named.
        $this->assertSame(1, $reach['products']['shops']);
        $this->assertSame(['Ledger & Sons'], $reach['products']['named']);

        // It is not a figure of speech: that is what the business is billed.
        $bill = $this->as($this->admin)->getJson("/api/v1/admin/tenants/{$books->id}")->assertOk()->json('data.package.bill');
        $products = collect($bill['addons'])->firstWhere('key', 'products');
        $this->assertSame(25000, (int) $products['monthly']);
    }

    public function test_a_shop_on_a_plan_no_longer_offered_is_still_counted(): void
    {
        // Standard is switched off. Nothing on offer leaves Delivery out for a
        // mart below Pro except Basic — and the shop still on Standard has it
        // past its plan exactly as before.
        $standard = $this->plan('premium');
        Tenant::factory()->create(['business_name' => 'Old Standard Mart', 'business_type' => 'mart', 'plan_id' => $standard->id])
            ->applyModules(['products' => true, 'pos' => true, 'delivery' => true, 'marketplace' => true, 'images' => true]);
        $standard->update(['is_active' => false]);

        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        $this->assertSame(['Basic'], $reach['delivery']['plans']);
        $this->assertSame(1, $reach['delivery']['shops']);
        $this->assertSame(['Old Standard Mart'], $reach['delivery']['named']);
    }

    public function test_the_first_three_are_named_and_the_rest_are_counted(): void
    {
        $basic = $this->plan('basic');
        foreach (['Delta Mart', 'Alpha Mart', 'Echo Mart', 'Charlie Mart', 'Bravo Mart'] as $name) {
            Tenant::factory()->create(['business_name' => $name, 'business_type' => 'mart', 'plan_id' => $basic->id])
                ->applyModules(['products' => true, 'pos' => true, 'delivery' => true, 'marketplace' => true, 'images' => true]);
        }

        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');

        $this->assertSame(5, $reach['delivery']['shops']);
        // By name — the same three every time it is asked.
        $this->assertSame(['Alpha Mart', 'Bravo Mart', 'Charlie Mart'], $reach['delivery']['named']);
        // Nobody has Products past a plan here, so nobody is named for it.
        $this->assertSame([], $reach['products']['named']);
    }

    public function test_the_answer_follows_the_plans_as_they_stand(): void
    {
        // Basic is told it includes Delivery. It is then an add-on on
        // Standard alone — worked out, not written down somewhere as "core".
        $basic = $this->plan('basic');
        $this->as($this->admin)->putJson("/api/v1/admin/plans/{$basic->id}", [
            'modules' => [...ModulePackages::ofPlan($basic), 'delivery', 'marketplace', 'images'],
        ])->assertOk();

        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');
        $this->assertSame(['Standard'], $reach['delivery']['plans']);

        // And a plan that is switched off is nobody's plan.
        $this->plan('premium')->update(['is_active' => false]);
        $reach = $this->as($this->admin)->getJson('/api/v1/admin/modules/reach')->assertOk()->json('data');
        $this->assertSame([], $reach['delivery']['plans']);
    }

    public function test_only_somebody_who_may_see_shops_is_told(): void
    {
        // Console staff with no leave to look at shops…
        $this->as(User::factory()->adminStaff([])->create())->getJson('/api/v1/admin/modules/reach')->assertForbidden();
        // …and with it.
        $this->as(User::factory()->adminStaff(['tenants.view'])->create())->getJson('/api/v1/admin/modules/reach')->assertOk();
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
