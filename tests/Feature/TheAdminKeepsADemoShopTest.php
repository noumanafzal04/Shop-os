<?php

namespace Tests\Feature;

use App\Actions\Demo\KeepDemoShopAction;
use App\Enums\UserRole;
use App\Exceptions\DomainException;
use App\Models\AuditLog;
use App\Models\Product;
use App\Models\ShopRequest;
use App\Models\SubscriptionPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Database\Seeders\CitySeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * THE ADMIN KEEPS A DEMO FOR ITS OWNER, there and then.
 *
 * A demo could become a business in one way: its visitor pressed "Keep this
 * shop", filled a form in, and waited. Somebody from the platform sitting
 * beside a shopkeeper who had just said yes had nothing to press — a demo
 * nobody had "requested" was a number on the dashboard and nothing else.
 *
 * What has to hold, and each fails quietly:
 *
 *   the demos are on a list, with enough on each row to tell which is which
 *   keeping one gives its owner a sign-in — a demo is entered by a token and
 *     nothing else, and a real shop its owner cannot get back into is worse
 *     than no shop
 *   it is the SAME shop: their shelf and their sales, not a fresh empty one
 *   it is the same KIND of shop as one kept the other way — the same four
 *     things change, and the list finds it under the same word
 *   the prune leaves it, and a request that was waiting is answered
 *   and only somebody who may open a shop can do any of it
 */
class TheAdminKeepsADemoShopTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->create([
            'role' => UserRole::AdminStaff,
            'permissions' => [Permissions::TENANTS_CREATE],
        ]);
    }

    // ── The list ────────────────────────────────────────────────────

    public function test_the_shops_being_tried_are_on_a_list_newest_first(): void
    {
        $this->travelTo(now()->subHours(3));
        [$earlier] = $this->aDemo('pharmacy');
        $this->travelBack();
        [$later] = $this->aDemo('mart');
        Tenant::factory()->create(['business_name' => 'A Real Shop']);

        $rows = $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->assertOk()->json('data');

        // Only the demos, and the one opened a moment ago first.
        $this->assertSame([$later->id, $earlier->id], array_column($rows, 'id'));
        $this->assertSame('mart', $rows[0]['business_type']);
        $this->assertSame($later->business_name, $rows[0]['business_name']);
        $this->assertNotNull($rows[0]['business_type_label']);
        $this->assertFalse($rows[0]['ended']);
        $this->assertNotNull($rows[0]['demo_expires_at']);
        $this->assertNull($rows[0]['request']);
        $this->assertSame(2, $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->json('meta.pagination.total'));
    }

    public function test_a_row_says_what_has_been_done_in_the_shop(): void
    {
        // What tells a demo somebody is deciding on from one somebody glanced at.
        [$demo, $owner] = $this->aDemo('mart');
        [$idle] = $this->aDemo('mart');
        $shelf = Product::withoutTenancy()->where('tenant_id', $demo->id)->count();
        $item = Product::withoutTenancy()->where('tenant_id', $demo->id)->orderBy('name')->firstOrFail();

        foreach ([2, 1] as $qty) {
            $this->as($owner)->postJson('/api/v1/sales', [
                'channel' => 'walk_in',
                'items' => [['product_id' => $item->id, 'quantity' => $qty]],
                'payment_method' => 'cash',
                'amount_paid' => 100000,
            ])->assertCreated();
        }

        $rows = collect($this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->assertOk()->json('data'))->keyBy('id');

        $this->assertGreaterThan(0, $shelf);
        $this->assertSame($shelf, $rows[$demo->id]['products_count']);
        $this->assertSame(2, $rows[$demo->id]['sales_count']);
        $this->assertEquals(3 * (float) $item->price, $rows[$demo->id]['sales_total']);
        $this->assertNotNull($rows[$demo->id]['last_sale_at']);
        // The other shop's sales are the other shop's.
        $this->assertSame(0, $rows[$idle->id]['sales_count']);
        $this->assertEquals(0, $rows[$idle->id]['sales_total']);
        $this->assertNull($rows[$idle->id]['last_sale_at']);
    }

    public function test_a_demo_whose_owner_already_asked_says_who_is_waiting(): void
    {
        [$demo, $owner] = $this->aDemo();
        $this->as($owner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Bilal Ahmed', 'contact_email' => 'bilal@example.com',
            'contact_phone' => '03001234567', 'password' => 'my-own-password-9',
        ])->assertCreated();

        $row = $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->assertOk()->json('data.0');

        $this->assertSame($demo->id, $row['id']);
        $this->assertSame('Bilal Ahmed', $row['request']['contact_name']);
        $this->assertSame('bilal@example.com', $row['request']['contact_email']);
        $this->assertSame('03001234567', $row['request']['contact_phone']);
    }

    public function test_a_demo_that_was_told_no_is_a_demo_nobody_is_waiting_on(): void
    {
        // Declined, the shop goes back to being a demo on its own clock. It is
        // on this list again — and NOT as somebody waiting: that would offer
        // "Approve" on a request that has already been answered.
        [$demo, $owner] = $this->aDemo();
        $this->as($owner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Bilal Ahmed', 'contact_email' => 'bilal@example.com', 'password' => 'my-own-password-9',
        ])->assertCreated();
        $asked = ShopRequest::query()->where('tenant_id', $demo->id)->firstOrFail();
        $this->as($this->admin)->postJson("/api/v1/admin/shop-requests/{$asked->id}/decline", ['reason' => 'Duplicate'])->assertOk();

        $row = $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->assertOk()->json('data.0');

        $this->assertSame($demo->id, $row['id']);
        $this->assertNull($row['request']);
    }

    public function test_a_demo_past_its_day_is_still_listed_and_says_so(): void
    {
        // The clearing-away is a job on a timer, not a wall. Until it runs the
        // shop is there, and it can still be kept.
        [$demo] = $this->aDemo();
        $demo->forceFill(['demo_expires_at' => now()->subHour()])->save();

        $row = $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->assertOk()->json('data.0');
        $this->assertTrue($row['ended']);

        $this->keep($demo)->assertOk();
        $this->assertFalse($demo->refresh()->is_demo);
    }

    public function test_a_demos_own_page_says_whether_its_owner_already_asked(): void
    {
        // The page offers "Make it a real shop" — which writes a new password.
        // If the owner has already asked, they have already chosen one, and
        // the page has to know that before it offers to overwrite it.
        $reader = User::factory()->create(['role' => UserRole::AdminStaff, 'permissions' => [Permissions::TENANTS_VIEW]]);
        [$quiet] = $this->aDemo();
        [$asking, $owner] = $this->aDemo();
        $this->as($owner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Bilal Ahmed', 'contact_email' => 'bilal@example.com', 'password' => 'my-own-password-9',
        ])->assertCreated();

        $page = fn (Tenant $t): array => $this->as($reader)->getJson("/api/v1/admin/tenants/{$t->id}")->assertOk()->json('data');

        // Asked: present and null, which is an answer — "nobody has".
        $this->assertArrayHasKey('keep_request', $page($quiet));
        $this->assertNull($page($quiet)['keep_request']);

        $asked = $page($asking)['keep_request'];
        $this->assertSame('Bilal Ahmed', $asked['contact_name']);
        $this->assertSame('bilal@example.com', $asked['contact_email']);
        $this->assertNotNull($asked['requested_at']);

        // Answered, it is no longer somebody waiting.
        $this->as($this->admin)->postJson('/api/v1/admin/shop-requests/'.$asked['id'].'/decline', ['reason' => 'Duplicate'])->assertOk();
        $this->assertNull($page($asking)['keep_request']);

        // A real shop is not asked the question at all, and neither is a list.
        $this->assertArrayNotHasKey('keep_request', $page(Tenant::factory()->create()));
        foreach ($this->as($reader)->getJson('/api/v1/admin/tenants?origin=demo')->assertOk()->json('data') as $row) {
            $this->assertArrayNotHasKey('keep_request', $row);
        }
    }

    // ── Keeping one ─────────────────────────────────────────────────

    public function test_keeping_a_demo_makes_it_a_real_shop_the_same_way_a_request_does(): void
    {
        [$demo] = $this->aDemo();

        $this->keep($demo)->assertOk()
            ->assertJsonPath('data.id', $demo->id)
            ->assertJsonPath('data.is_demo', false)
            ->assertJsonPath('data.origin', 'converted');

        $demo->refresh();
        $this->assertFalse($demo->is_demo);
        $this->assertNull($demo->demo_expires_at);
        $this->assertNotNull($demo->converted_at);
        // Back through setup: the owner picks their city and drops their pin.
        $this->assertFalse($demo->setup_completed);
        // …and it is found where every kept shop is found.
        $reader = User::factory()->create(['role' => UserRole::AdminStaff, 'permissions' => [Permissions::TENANTS_VIEW]]);
        $this->assertSame(
            [$demo->id],
            array_column($this->as($reader)->getJson('/api/v1/admin/tenants?origin=converted')->assertOk()->json('data'), 'id'),
        );
        $this->assertSame([], $this->as($this->admin)->getJson('/api/v1/admin/demo-shops')->json('data'));
    }

    public function test_the_owner_can_sign_in_with_what_the_admin_typed(): void
    {
        // A demo is entered by a token and nothing else. Made real without a
        // sign-in, it is a shop its owner cannot get back into tomorrow.
        [$demo, $owner] = $this->aDemo();
        $was = $owner->email;

        $this->keep($demo)->assertOk();

        $owner->refresh();
        $this->assertSame('Hamza Tariq', $owner->name);
        $this->assertSame('hamza@karimstore.pk', $owner->email);
        $this->assertSame('03214567890', $owner->phone);
        $this->assertTrue(Hash::check('counter-side-8', $owner->password));

        $this->app['auth']->forgetGuards();
        $this->defaultHeaders = [];
        $this->postJson('/api/v1/auth/login', ['identifier' => 'hamza@karimstore.pk', 'password' => 'counter-side-8'])
            ->assertOk()
            ->assertJsonPath('data.user.tenant.id', $demo->id);
        // The throwaway address the demo was opened with opens nothing.
        $this->postJson('/api/v1/auth/login', ['identifier' => $was, 'password' => 'counter-side-8'])
            ->assertStatus(401);
    }

    public function test_it_is_the_shop_they_built_not_a_new_one(): void
    {
        [$demo] = $this->aDemo();
        $shelf = Product::withoutTenancy()->where('tenant_id', $demo->id)->pluck('id')->sort()->values()->all();
        $tenants = Tenant::query()->count();

        $this->keep($demo)->assertOk();

        $this->assertSame($tenants, Tenant::query()->count(), 'a second shop was made');
        $this->assertSame(
            $shelf,
            Product::withoutTenancy()->where('tenant_id', $demo->id)->pluck('id')->sort()->values()->all(),
            'their shelf was not kept',
        );
    }

    public function test_the_admin_may_say_what_the_business_is_called_or_leave_it(): void
    {
        [$named] = $this->aDemo();
        [$left] = $this->aDemo();
        $generated = $left->business_name;

        $this->keep($named, ['business_name' => '  Karim General Store  '])->assertOk()
            ->assertJsonPath('data.business_name', 'Karim General Store');
        $this->keep($left, ['owner_email' => 'second@karimstore.pk', 'business_name' => ''])->assertOk();

        $this->assertSame('Karim General Store', $named->refresh()->business_name);
        // Left alone: the setup wizard asks them anyway.
        $this->assertSame($generated, $left->refresh()->business_name);
    }

    public function test_a_kept_shop_has_paid_for_nothing_yet_and_says_so(): void
    {
        // A demo is on no plan — it is a thing nobody has paid for. Kept, it
        // must not arrive on the list already "subscribed" for a month nobody
        // recorded: the admin who keeps it gives it its plan, and that is the
        // first payment on its ledger.
        [$demo] = $this->aDemo();
        $this->assertNull($demo->plan_id, 'a demo was put on a plan nobody paid for');
        $this->assertNull($demo->subscription_ends_at);

        $this->keep($demo)->assertOk()->assertJsonPath('data.plan', null);

        $demo->refresh();
        $this->assertNull($demo->plan_id);
        $this->assertNull($demo->subscription_ends_at);
        $this->assertSame(0, SubscriptionPayment::query()->where('tenant_id', $demo->id)->count());
    }

    public function test_the_prune_leaves_a_shop_that_was_kept(): void
    {
        [$kept] = $this->aDemo();
        [$abandoned] = $this->aDemo();
        $this->keep($kept)->assertOk();
        // Both a day past where their demo clocks stood.
        $this->travelTo(now()->addDays(2));

        $this->artisan('shopos:prune-demos')->assertExitCode(0);

        $this->assertNotNull(Tenant::query()->find($kept->id), 'a real shop was cleared away as a demo');
        $this->assertNull(Tenant::query()->find($abandoned->id));
    }

    public function test_a_request_that_was_waiting_is_answered_by_it(): void
    {
        // The owner had asked, nobody had replied, and the admin kept the shop
        // from here instead. The queue must not go on showing them waiting.
        [$demo, $owner] = $this->aDemo();
        $this->as($owner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Bilal Ahmed', 'contact_email' => 'bilal@example.com', 'password' => 'my-own-password-9',
        ])->assertCreated();
        [$other, $otherOwner] = $this->aDemo();
        $this->as($otherOwner)->postJson('/api/v1/shop/keep', [
            'contact_name' => 'Sana', 'contact_email' => 'sana@example.com', 'password' => 'my-own-password-9',
        ])->assertCreated();

        // Their own email again is not "already in use" — it is theirs.
        $this->keep($demo, ['owner_email' => 'bilal@example.com'])->assertOk();

        $answered = ShopRequest::query()->where('tenant_id', $demo->id)->firstOrFail();
        $this->assertSame(ShopRequest::APPROVED, $answered->status);
        $this->assertSame($this->admin->id, $answered->reviewed_by);
        $this->assertNotNull($answered->reviewed_at);
        // Somebody else's request is somebody else's.
        $this->assertSame(ShopRequest::PENDING, ShopRequest::query()->where('tenant_id', $other->id)->value('status'));
        $this->assertSame(1, $this->as($this->admin)->getJson('/api/v1/admin/inbox')->json('data.shop_requests'));
    }

    public function test_who_kept_it_is_on_the_shops_own_trail(): void
    {
        [$demo] = $this->aDemo();
        $generated = $demo->business_name;

        $this->keep($demo, ['business_name' => 'Karim General Store'])->assertOk();

        $entry = AuditLog::query()->where('event', 'demo_shop_kept_by_admin')->firstOrFail();
        $this->assertSame($this->admin->id, $entry->user_id);
        $this->assertSame($demo->id, $entry->tenant_id);
        $this->assertSame($generated, $entry->old_values['business_name']);
        $this->assertSame('Karim General Store', $entry->new_values['business_name']);
        $this->assertSame('hamza@karimstore.pk', $entry->new_values['owner_email']);
        // What was typed for them to sign in with is not written down anywhere.
        $this->assertStringNotContainsString('counter-side-8', json_encode($entry->toArray()));
    }

    // ── What it refuses ─────────────────────────────────────────────

    public function test_a_sign_in_is_not_optional(): void
    {
        [$demo] = $this->aDemo();

        $this->keep($demo, ['owner_name' => ''])->assertStatus(422)->assertJsonStructure(['errors' => ['owner_name']]);
        $this->keep($demo, ['owner_email' => 'not-an-email'])->assertStatus(422)->assertJsonStructure(['errors' => ['owner_email']]);
        $this->keep($demo, ['password' => 'short'])->assertStatus(422)->assertJsonStructure(['errors' => ['password']]);

        // Refused whole: nothing about the shop or its owner moved.
        $this->assertTrue($demo->refresh()->is_demo);
        $this->assertStringEndsWith('@demo.cartze.shop', $demo->users()->firstOrFail()->email);
    }

    public function test_an_email_somebody_already_signs_in_with_is_refused_in_words(): void
    {
        User::factory()->create(['email' => 'taken@example.com']);
        [$demo] = $this->aDemo();

        $this->keep($demo, ['owner_email' => 'taken@example.com'])->assertStatus(422)
            ->assertJsonPath('errors.owner_email.0', 'Somebody already signs in with that email. Use another, or find their shop in the tenant list.');
        $this->assertTrue($demo->refresh()->is_demo);
    }

    public function test_a_name_another_shop_has_is_refused_in_words(): void
    {
        Tenant::factory()->create(['business_name' => 'Karim General Store']);
        [$demo] = $this->aDemo();

        $this->keep($demo, ['business_name' => 'Karim General Store'])->assertStatus(422)
            ->assertJsonPath('errors.business_name.0', 'There is already a shop called that.');
        $this->assertTrue($demo->refresh()->is_demo);
    }

    public function test_a_real_shop_is_not_a_demo_to_be_kept(): void
    {
        $real = Tenant::factory()->create();
        User::factory()->shopOwner($real)->create();

        $this->keep($real)->assertStatus(404);

        // And a demo cannot be kept twice.
        [$demo] = $this->aDemo();
        $this->keep($demo)->assertOk();
        $this->keep($demo, ['owner_email' => 'again@example.com'])->assertStatus(404);
    }

    public function test_the_rule_is_the_actions_own_whoever_calls_it(): void
    {
        // The endpoint only ever hands the action a demo. A command, a job or
        // the next endpoint might not — and "keeping" a real shop would send
        // a trading business back through setup and hand its owner's sign-in
        // to whoever asked.
        $real = Tenant::factory()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($real)->create(['email' => 'owner@real.example']);

        try {
            app(KeepDemoShopAction::class)->execute($this->admin, $real, [
                'owner_name' => 'Somebody Else', 'owner_email' => 'taker@example.com', 'password' => 'counter-side-8',
            ]);
            $this->fail('a real shop was kept as if it were a demo');
        } catch (DomainException $e) {
            $this->assertSame('NOT_A_DEMO', $e->errorCode);
        }

        $this->assertTrue($real->refresh()->setup_completed);
        $this->assertNull($real->converted_at);
        $this->assertSame('owner@real.example', $owner->refresh()->email);
    }

    public function test_only_somebody_who_may_open_a_shop_can_see_or_keep_one(): void
    {
        [$demo, $owner] = $this->aDemo();
        $banners = User::factory()->create(['role' => UserRole::AdminStaff, 'permissions' => [Permissions::BANNERS_MANAGE]]);

        $this->as($banners)->getJson('/api/v1/admin/demo-shops')->assertStatus(403);
        $this->keep($demo, [], $banners)->assertStatus(403);
        // The demo's own visitor is not platform staff at all.
        $this->as($owner)->getJson('/api/v1/admin/demo-shops')->assertStatus(403);
        $this->keep($demo, [], $owner)->assertStatus(403);

        $this->assertTrue($demo->refresh()->is_demo);
    }

    // ── Plumbing ────────────────────────────────────────────────────

    /** @return array{0: Tenant, 1: User} A demo, opened through the landing page's own door. */
    private function aDemo(string $trade = 'mart'): array
    {
        $this->app['auth']->forgetGuards();
        $this->defaultHeaders = [];
        $this->postJson('/api/v1/demo', ['business_type' => $trade])->assertCreated();
        // LATEST: `first()` would hand a second call the first shop back.
        $tenant = Tenant::query()->where('is_demo', true)->latest('created_at')->latest('id')->firstOrFail();

        return [$tenant, $tenant->users()->firstOrFail()];
    }

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @param  array<string, mixed>  $over */
    private function keep(Tenant $demo, array $over = [], ?User $by = null): TestResponse
    {
        return $this->as($by ?? $this->admin)->postJson("/api/v1/admin/demo-shops/{$demo->id}/keep", array_merge([
            'owner_name' => 'Hamza Tariq',
            'owner_email' => 'hamza@karimstore.pk',
            'owner_phone' => '03214567890',
            'password' => 'counter-side-8',
        ], $over));
    }
}
