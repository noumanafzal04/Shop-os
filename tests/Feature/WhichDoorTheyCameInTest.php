<?php

namespace Tests\Feature;

use App\Models\Enquiry;
use App\Models\Plan;
use App\Models\ShopRequest;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHICH DOOR EACH SHOP CAME IN THROUGH, and how many people are waiting.
 *
 * Three doors lead onto this platform — an admin opens a shop, a stranger tries
 * a demo, a stranger keeps the demo they tried — and until now the tenant list
 * could tell them apart in exactly one way: not at all. The most valuable row
 * in the table, an owner who has never spoken to anybody and is sitting in the
 * setup wizard, looked identical to a shop opened by hand a year ago.
 *
 * Two separate things are proved here and they fail differently:
 *
 *   · the ORIGIN of a shop — written when the decision is made, filterable,
 *     countable, sortable;
 *   · the COUNT of people waiting on a reply, which is what puts a badge on
 *     the rail so a queue that nags nobody stops depending on somebody
 *     remembering it exists.
 */
class WhichDoorTheyCameInTest extends TestCase
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

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array<int, string> business names the list returned */
    private function names(string $query = ''): array
    {
        return array_column(
            $this->asAdmin()->getJson('/api/v1/admin/tenants?'.$query)->assertOk()->json('data'),
            'business_name',
        );
    }

    private function threeDoors(): void
    {
        Tenant::factory()->create(['business_name' => 'Opened By Hand']);
        Tenant::factory()->create([
            'business_name' => 'Kept Their Shop',
            'converted_at' => now()->subDay(),
            'setup_completed' => false,
        ]);
        Tenant::factory()->create([
            'business_name' => 'Just Looking',
            'is_demo' => true,
            'demo_expires_at' => now()->addHours(20),
        ]);
    }

    // ── The fact itself ────────────────────────────────────────────────

    public function test_approving_a_kept_shop_stamps_the_shop_with_the_door_it_came_in_through(): void
    {
        $tenant = Tenant::factory()->create([
            'is_demo' => true,
            'demo_expires_at' => now()->addHours(6),
            'setup_completed' => true,
        ]);
        $request = ShopRequest::query()->create([
            'tenant_id' => $tenant->id,
            'contact_name' => 'Bilal',
            'contact_email' => 'bilal@example.test',
            'status' => ShopRequest::PENDING,
            'requested_at' => now()->subHour(),
        ]);

        $this->assertSame('demo', $tenant->origin());

        $this->asAdmin()->postJson("/api/v1/admin/shop-requests/{$request->id}/approve")->assertOk();

        $tenant->refresh();
        $this->assertNotNull($tenant->converted_at, 'the shop must remember it was kept');
        $this->assertSame('converted', $tenant->origin());
    }

    public function test_a_shop_that_is_still_a_demo_is_a_demo_whatever_else_is_stamped_on_it(): void
    {
        // The accessor answers is_demo FIRST, and the scope has to agree with
        // it — a filter that disagreed with the badge beside it would put a
        // shop in a bucket its own row denies.
        $tenant = Tenant::factory()->create([
            'business_name' => 'Handed Back',
            'is_demo' => true,
            'converted_at' => now()->subWeek(),
        ]);

        $this->assertSame('demo', $tenant->origin());
        $this->assertSame(['Handed Back'], $this->names('origin=demo'));
        $this->assertSame([], $this->names('origin=converted'));
    }

    // ── Filtering by it ────────────────────────────────────────────────

    public function test_each_origin_returns_only_the_shops_that_came_in_that_way(): void
    {
        $this->threeDoors();

        $this->assertSame(['Kept Their Shop'], $this->names('origin=converted'));
        $this->assertSame(['Just Looking'], $this->names('origin=demo'));
        $this->assertSame(['Opened By Hand'], $this->names('origin=direct'));
        // The denominator: without it, three assertions of one row each would
        // also pass against a list that has learned to return nothing.
        $this->assertCount(3, $this->names());
    }

    public function test_an_origin_nobody_offers_is_refused_rather_than_ignored(): void
    {
        $this->threeDoors();

        // Ignoring it would answer with the whole platform, which reads as
        // "there are no converted shops" to anyone who mistypes the filter.
        $this->asAdmin()->getJson('/api/v1/admin/tenants?origin=walked_in')
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'UNKNOWN_ORIGIN');
    }

    public function test_the_origin_counts_are_taken_without_the_origin_filter_applied(): void
    {
        $this->threeDoors();

        $counts = $this->asAdmin()
            ->getJson('/api/v1/admin/tenants?origin=converted')
            ->assertOk()
            ->json('meta.origin_counts');

        // One row is on screen. All three counts must still be right, or the
        // chip row is a set of numbers that only ever agrees with itself.
        $this->assertSame(
            ['demo' => 1, 'converted' => 1, 'direct' => 1, 'all' => 3],
            $counts,
        );
    }

    public function test_the_origin_counts_do_narrow_with_every_other_filter(): void
    {
        $this->threeDoors();
        Tenant::factory()->create(['business_name' => 'Kept In Lahore', 'converted_at' => now()]);

        $counts = $this->asAdmin()
            ->getJson('/api/v1/admin/tenants?search=Kept')
            ->assertOk()
            ->json('meta.origin_counts');

        // Two shops match "Kept" and both came in the same door. A count that
        // ignored the search would say 1/1/1 and send an admin looking for a
        // demo that is not in front of them.
        $this->assertSame(['demo' => 0, 'converted' => 2, 'direct' => 0, 'all' => 2], $counts);
    }

    public function test_the_payment_counts_narrow_with_the_origin_filter(): void
    {
        $this->threeDoors();

        $counts = $this->asAdmin()
            ->getJson('/api/v1/admin/tenants?origin=converted')
            ->assertOk()
            ->json('meta.payment_counts');

        // One converted shop, owing nothing (no end date) — so `paid`. If the
        // payment counts were computed platform-wide they would read 3 here.
        $this->assertSame(1, $counts['paid']);
        $this->assertSame(1, $counts['all']);
    }

    // ── The filters that existed and could never be reached ────────────

    public function test_a_shop_can_be_found_by_its_trade(): void
    {
        Tenant::factory()->create(['business_name' => 'Corner Chemist', 'business_type' => 'pharmacy']);
        Tenant::factory()->create(['business_name' => 'Corner Kitchen', 'business_type' => 'food']);

        $this->assertSame(['Corner Chemist'], $this->names('business_type=pharmacy'));
    }

    public function test_shops_still_sitting_in_the_setup_wizard_can_be_listed(): void
    {
        Tenant::factory()->create(['business_name' => 'Never Finished', 'setup_completed' => false]);
        Tenant::factory()->create(['business_name' => 'All Done', 'setup_completed' => true]);

        $this->assertSame(['Never Finished'], $this->names('setup=pending'));
        $this->assertSame(['All Done'], $this->names('setup=done'));
    }

    public function test_shops_with_no_plan_yet_are_askable_and_an_empty_filter_is_not_that_question(): void
    {
        $plan = Plan::query()->where('code', 'basic')->firstOrFail();
        Tenant::factory()->create(['business_name' => 'Unpriced', 'plan_id' => null]);
        Tenant::factory()->create(['business_name' => 'On Basic', 'plan_id' => $plan->id]);

        $this->assertSame(['Unpriced'], $this->names('plan_id=none'));
        // An empty parameter is how the panel says "no filter" — it must not
        // be read as "shops with no plan", or clearing a filter would silently
        // apply a different one.
        $this->assertCount(2, $this->names('plan_id='));
    }

    public function test_the_newest_owner_can_be_sorted_to_the_top_and_unconverted_shops_sink(): void
    {
        Tenant::factory()->create(['business_name' => 'Older Convert', 'converted_at' => now()->subWeek()]);
        Tenant::factory()->create(['business_name' => 'Newest Convert', 'converted_at' => now()]);
        Tenant::factory()->create(['business_name' => 'Never Converted']);

        $this->assertSame(
            ['Newest Convert', 'Older Convert', 'Never Converted'],
            $this->names('sort=converted'),
        );
    }

    public function test_an_unknown_sort_falls_back_to_newest_rather_than_to_whatever_the_database_felt_like(): void
    {
        Tenant::factory()->create(['business_name' => 'First In', 'created_at' => now()->subDays(2)]);
        Tenant::factory()->create(['business_name' => 'Last In', 'created_at' => now()]);

        $this->assertSame(['Last In', 'First In'], $this->names('sort=by_vibes'));
    }

    public function test_sorting_by_renewal_puts_the_soonest_first_and_shops_that_owe_nothing_last(): void
    {
        Tenant::factory()->create(['business_name' => 'Owes Nothing', 'subscription_ends_at' => null]);
        Tenant::factory()->create(['business_name' => 'Due Later', 'subscription_ends_at' => now()->addMonth()]);
        Tenant::factory()->create(['business_name' => 'Due Tomorrow', 'subscription_ends_at' => now()->addDay()]);

        $this->assertSame(
            ['Due Tomorrow', 'Due Later', 'Owes Nothing'],
            $this->names('sort=renewal'),
        );
    }

    public function test_the_resource_says_which_door_every_shop_came_in_through(): void
    {
        $this->threeDoors();

        $rows = $this->asAdmin()->getJson('/api/v1/admin/tenants?sort=name')->assertOk()->json('data');

        $this->assertSame(
            ['Just Looking' => 'demo', 'Kept Their Shop' => 'converted', 'Opened By Hand' => 'direct'],
            array_column($rows, 'origin', 'business_name'),
        );
        $this->assertNotNull($rows[1]['converted_at']);
    }

    // ── How many people are waiting ────────────────────────────────────

    public function test_the_rail_is_told_how_many_people_are_waiting_on_a_reply(): void
    {
        $tenant = Tenant::factory()->create(['is_demo' => true]);
        foreach (['pending', 'approved'] as $status) {
            ShopRequest::query()->create([
                'tenant_id' => Tenant::factory()->create(['is_demo' => true])->id,
                'contact_name' => 'Someone',
                'contact_email' => $status.'@example.test',
                'status' => $status,
                'requested_at' => now()->subHours(3),
            ]);
        }
        Enquiry::query()->create([
            'kind' => Enquiry::WALKTHROUGH, 'name' => 'Ayesha', 'email' => 'ayesha@example.test',
            'phone' => '0300', 'status' => Enquiry::NEW,
        ]);
        Enquiry::query()->create([
            'kind' => Enquiry::QUESTION, 'name' => 'Omar', 'email' => 'omar@example.test',
            'phone' => '0301', 'status' => Enquiry::CONTACTED,
        ]);

        $counts = $this->asAdmin()->getJson('/api/v1/admin/inbox')->assertOk()->json('data');

        // Only what is UNANSWERED. An approved request and a contacted enquiry
        // are somebody's finished and half-finished work; badging either leaves
        // a number on the rail that doing the job cannot clear.
        $this->assertSame(1, $counts['shop_requests']);
        $this->assertSame(1, $counts['enquiries']);
        $this->assertNotNull($tenant);
    }

    public function test_a_staffer_who_may_not_open_shops_is_told_nothing_rather_than_zero(): void
    {
        $ads = User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();
        $token = $ads->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        ShopRequest::query()->create([
            'tenant_id' => Tenant::factory()->create(['is_demo' => true])->id,
            'contact_name' => 'Waiting', 'contact_email' => 'w@example.test',
            'status' => ShopRequest::PENDING, 'requested_at' => now(),
        ]);

        $data = $this->withToken($token)->getJson('/api/v1/admin/inbox')->assertOk()->json('data');

        // A zero here would draw no badge — indistinguishable from the truth,
        // right up until somebody asks why the queue was never answered.
        $this->assertArrayNotHasKey('shop_requests', $data);
        $this->assertArrayNotHasKey('enquiries', $data);
    }
}
