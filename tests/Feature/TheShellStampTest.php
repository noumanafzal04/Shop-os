<?php

namespace Tests\Feature;

use App\Http\Middleware\StampTheShell;
use App\Models\Branch;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * EVERY ANSWER SAYS WHETHER THE SHELL'S KEPT ANSWERS STILL STAND.
 *
 * A device keeps who-am-I, the shop's settings and its branches, so opening a
 * screen does not ask for them. It can only do that safely if it is TOLD when
 * one of them changed somewhere else — an admin switching a module on, the
 * owner changing a cashier's permissions from the office. That telling is one
 * header on every signed-in answer.
 *
 * Two things are held here, and the second matters as much as the first:
 *
 *   it MOVES for every change a kept answer is made from
 *   it does NOT move for the shop's ordinary day — a product, a sale — or a
 *     device would ask for everything again after every bill
 */
class TheShellStampTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $plan = Plan::query()->create(['name' => 'Pro', 'code' => 'pro-test', 'price' => 7999, 'billing_period_months' => 1]);
        $this->shop = Tenant::factory()->provisioned()->create(['plan_id' => $plan->id]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->create([
            'role' => 'staff', 'tenant_id' => $this->shop->id, 'permissions' => [Permissions::SALES_MANAGE],
        ]);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $who): static
    {
        $token = $who->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** The stamp a device would see on its next request. */
    private function stampFor(User $who, string $path = '/api/v1/shop/settings'): ?string
    {
        return $this->as($who)->getJson($path)->assertOk()->headers->get(StampTheShell::HEADER);
    }

    /** Timestamps are whole seconds; the next change has to happen in a later one. */
    private function later(): void
    {
        $this->travel(5)->seconds();
    }

    // ── it is there, and it is steady ───────────────────────────────────

    public function test_a_signed_in_answer_carries_the_stamp(): void
    {
        $stamp = $this->stampFor($this->owner);

        $this->assertNotNull($stamp, 'a signed-in answer carried no stamp — the device has nothing to compare');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{16}$/', $stamp);
    }

    public function test_it_does_not_move_while_nothing_changes(): void
    {
        $first = $this->stampFor($this->owner);
        $this->later();

        $this->assertSame($first, $this->stampFor($this->owner), 'time passing moved the stamp — every device would ask again on every request');
    }

    public function test_it_is_the_same_whatever_is_asked(): void
    {
        // A device hears it on whatever it happens to ask first. Two values
        // for one moment would read as a change each time they alternated.
        $onSettings = $this->stampFor($this->owner, '/api/v1/shop/settings');
        $onBranches = $this->stampFor($this->owner, '/api/v1/branches');
        $onProducts = $this->stampFor($this->owner, '/api/v1/products');
        $onMe = $this->stampFor($this->owner, '/api/v1/auth/me');

        $this->assertSame($onSettings, $onBranches);
        $this->assertSame($onSettings, $onProducts);
        $this->assertSame($onSettings, $onMe, 'who-am-I stamps differently from the shop\'s own screens');
    }

    public function test_it_is_this_persons_shop_that_is_stamped_whoever_asked_last(): void
    {
        // The shop a request works in is held for the length of that request
        // — and, in a worker that serves many, is still lying there when the
        // next one starts. Who-am-I resolves no shop of its own; it must not
        // pick up the last caller's.
        $otherOwner = User::factory()->shopOwner(Tenant::factory()->provisioned()->create())->create();
        $mine = $this->stampFor($this->owner);

        $this->stampFor($otherOwner);

        $this->assertSame($mine, $this->stampFor($this->owner, '/api/v1/auth/me'), 'who-am-I was stamped with the shop of whoever asked before');
    }

    public function test_a_shop_left_lying_from_the_last_request_is_not_believed(): void
    {
        // One route answers a signed-in person without resolving their shop
        // (the token refresh). In a worker that serves many requests, the
        // shop the LAST caller worked in is still held when it runs.
        $otherShop = Tenant::factory()->provisioned()->create();
        $context = app(TenantContext::class);
        $context->set($otherShop);
        $request = Request::create('/api/v1/auth/refresh', 'POST');
        $request->setUserResolver(fn () => $this->owner->fresh());

        $response = (new StampTheShell($context))->handle($request, fn () => response()->json([]));

        $this->assertNull(
            $response->headers->get(StampTheShell::HEADER),
            'an answer was stamped with the shop of whoever asked before — the device would read it as a change',
        );
        $context->clear();
    }

    public function test_an_answer_to_nobody_carries_none(): void
    {
        $this->app['auth']->forgetGuards();

        $this->getJson('/api/v1/cities')->assertOk()->assertHeaderMissing(StampTheShell::HEADER);
        $this->getJson('/api/v1/products')->assertUnauthorized()->assertHeaderMissing(StampTheShell::HEADER);
    }

    public function test_a_browser_on_another_origin_is_allowed_to_read_it(): void
    {
        // The panel is served from one origin and the API from another. A
        // browser hides every response header the server does not name.
        $this->assertContains(StampTheShell::HEADER, config('cors.exposed_headers'));

        $exposed = $this->as($this->owner)
            ->withHeader('Origin', 'http://localhost:5177')
            ->getJson('/api/v1/shop/settings')
            ->headers->get('Access-Control-Expose-Headers');

        $this->assertStringContainsStringIgnoringCase(StampTheShell::HEADER, (string) $exposed);
    }

    // ── it moves for what the kept answers are made of ──────────────────

    public function test_saving_the_shops_settings_moves_it(): void
    {
        $before = $this->stampFor($this->owner);
        $this->later();

        $this->as($this->owner)->putJson('/api/v1/shop/settings', ['receipt_footer' => 'Shukriya'])->assertOk();

        $this->assertNotSame($before, $this->stampFor($this->owner));
        // …and for everybody in the shop, not only whoever saved.
        $this->assertNotSame($before, $this->stampFor($this->cashier, '/api/v1/products'));
    }

    public function test_an_admin_switching_a_module_moves_the_shops_stamp(): void
    {
        $before = $this->stampFor($this->owner);
        $this->later();

        $modules = $this->shop->features;
        $modules['delivery'] = ! ($modules['delivery'] ?? false);
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$this->shop->id}/modules", ['modules' => $modules])->assertOk();

        $this->assertNotSame($before, $this->stampFor($this->owner), 'a module was switched for this shop and its devices were told nothing');
    }

    public function test_an_admin_changing_the_shops_limits_moves_it(): void
    {
        $before = $this->stampFor($this->owner);
        $this->later();

        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$this->shop->id}/limits", ['limits' => ['branches' => 4], 'mode' => 'set'])->assertOk();

        $this->assertNotSame($before, $this->stampFor($this->owner));
    }

    public function test_changing_the_terms_of_the_plan_the_shop_is_on_moves_it(): void
    {
        $before = $this->stampFor($this->owner);
        $this->later();

        Plan::query()->findOrFail($this->shop->plan_id)->update(['max_branches' => 20]);

        $this->assertNotSame($before, $this->stampFor($this->owner), 'the plan\'s terms changed and the shops on it were told nothing');
    }

    public function test_changing_another_plan_does_not(): void
    {
        $other = Plan::query()->create(['name' => 'Basic', 'code' => 'basic-test', 'price' => 2499, 'billing_period_months' => 1]);
        $before = $this->stampFor($this->owner);
        $this->later();

        $other->update(['max_branches' => 2]);

        $this->assertSame($before, $this->stampFor($this->owner));
    }

    public function test_a_branch_opened_renamed_or_closed_moves_it(): void
    {
        $stamps = [$this->stampFor($this->owner)];

        $this->later();
        $branch = Branch::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Gulberg Outlet']);
        $stamps[] = $this->stampFor($this->owner);

        $this->later();
        $branch->update(['name' => 'Gulberg Flagship']);
        $stamps[] = $this->stampFor($this->owner);

        $this->later();
        $branch->delete();
        $stamps[] = $this->stampFor($this->owner);

        $this->assertCount(4, array_unique($stamps), 'opening, renaming and closing a branch should each have moved the stamp: '.implode(', ', $stamps));
    }

    public function test_changing_one_persons_permissions_moves_thei_r_stamp_and_nobody_elses(): void
    {
        $cashierBefore = $this->stampFor($this->cashier, '/api/v1/products');
        $ownerBefore = $this->stampFor($this->owner);
        $this->later();

        $this->as($this->owner)->putJson("/api/v1/staff/{$this->cashier->id}", [
            'name' => $this->cashier->name,
            'permissions' => [Permissions::SALES_MANAGE, Permissions::PRODUCTS_MANAGE],
        ])->assertOk();

        $this->assertNotSame($cashierBefore, $this->stampFor($this->cashier, '/api/v1/products'), 'a cashier was given a new permission and their device was told nothing');
        $this->assertSame($ownerBefore, $this->stampFor($this->owner), 'one person\'s permissions changed and everybody was told to ask again');
    }

    // ── and it holds still for the shop's ordinary day ──────────────────

    public function test_a_product_a_customer_and_an_expense_do_not_move_it(): void
    {
        $before = $this->stampFor($this->owner);
        $this->later();

        $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Cotton Kurta', 'price' => 2950, 'is_active' => true,
            'description' => 'A plain kurta.', 'tax_rate' => 0, 'track_inventory' => false,
        ])->assertSuccessful();
        $this->as($this->owner)->postJson('/api/v1/customers', ['name' => 'Ayesha Khan', 'phone' => '03001234567'])->assertSuccessful();

        $this->assertSame($before, $this->stampFor($this->owner), 'the shop\'s ordinary work moved the stamp — every device would ask again after every save');
    }

    public function test_two_shops_do_not_share_a_stamp_nor_move_each_others(): void
    {
        $otherShop = Tenant::factory()->provisioned()->create();
        $otherOwner = User::factory()->shopOwner($otherShop)->create();
        $mine = $this->stampFor($this->owner);
        $theirs = $this->stampFor($otherOwner);
        $this->assertNotSame($mine, $theirs);
        $this->later();

        $this->as($otherOwner)->putJson('/api/v1/shop/settings', ['receipt_footer' => 'Theirs'])->assertOk();

        $this->assertSame($mine, $this->stampFor($this->owner));
        $this->assertNotSame($theirs, $this->stampFor($otherOwner));
    }

    // ── what it costs ───────────────────────────────────────────────────

    public function test_it_asks_the_database_nothing(): void
    {
        $owner = $this->owner->fresh();
        $shop = $this->shop->fresh();

        DB::enableQueryLog();
        DB::flushQueryLog();
        $stamp = StampTheShell::of($owner, $shop);
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertNotNull($stamp);
        $this->assertSame([], $queries, 'the stamp is on every request — it may not cost a query');
    }

    public function test_a_person_in_a_shop_gets_no_stamp_rather_than_half_of_one(): void
    {
        // The request did not load the shop. Half a stamp would differ from
        // the whole one on the next request, and read as a change.
        $this->assertNull(StampTheShell::of($this->owner->fresh(), null));
    }

    public function test_somebody_in_no_shop_is_stamped_by_their_own_row(): void
    {
        $first = $this->as($this->admin)->getJson('/api/v1/admin/tenants')->assertOk()->headers->get(StampTheShell::HEADER);
        $this->assertNotNull($first);
        $this->later();

        $this->admin->update(['name' => 'Renamed Admin']);

        $this->assertNotSame($first, $this->as($this->admin)->getJson('/api/v1/admin/tenants')->assertOk()->headers->get(StampTheShell::HEADER));
    }
}
