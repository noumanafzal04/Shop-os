<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Enquiry;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ASKING FOR A PERSON — the landing page's other door.
 *
 * One tap already builds a working shop, and for a lot of visitors that is the
 * right answer. These tests are about the two it is the wrong answer for: the
 * shopkeeper who will not touch software until somebody has walked them
 * through it, and the one with a single question in the way of buying.
 *
 * The thing every test here is really protecting is that the row REACHES
 * somebody. A contact form whose submissions land nowhere is worse than no
 * form at all — it takes a lead and a promise and drops both.
 */
class AskingForAPersonTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function ask(array $over = []): TestResponse
    {
        return $this->postJson('/api/v1/enquiries', array_merge([
            'kind' => Enquiry::WALKTHROUGH,
            'name' => 'Bilal Ahmed',
            'email' => 'bilal@example.com',
            'phone' => '03001234567',
            'business_name' => 'Al-Saeed Mart',
            'business_type' => 'mart',
            'city' => 'Karachi (Gulshan)',
            'prefers_at' => now()->addDays(2)->toIso8601String(),
            'message' => 'Two branches, one of them opens at six.',
        ], $over));
    }

    private function anAdmin(): User
    {
        return User::factory()->create([
            'role' => UserRole::AdminStaff,
            'permissions' => [Permissions::TENANTS_CREATE],
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Asking ──────────────────────────────────────────────────────

    public function test_a_stranger_with_no_account_can_ask(): void
    {
        // The whole point: they have no shop, no login and nothing to sign in
        // with. If this needed a token it would be asking the people who
        // already bought it.
        $this->ask()->assertCreated();

        $this->assertDatabaseHas('enquiries', [
            'email' => 'bilal@example.com',
            'kind' => Enquiry::WALKTHROUGH,
            'status' => Enquiry::NEW,
        ]);
    }

    public function test_only_a_name_and_an_email_are_actually_required(): void
    {
        // Everything else is optional on purpose. A form that demands a
        // company name and a city from somebody who wants to ask one question
        // is a form they close.
        $this->postJson('/api/v1/enquiries', [
            'kind' => Enquiry::QUESTION,
            'name' => 'Sana',
            'email' => 'sana@example.com',
        ])->assertCreated();
    }

    public function test_a_walkthrough_is_answered_as_a_time_to_be_confirmed(): void
    {
        // Nothing here books anything. Saying "confirmed for Tuesday" when no
        // diary was touched would make the first promise this product gives a
        // stranger one it cannot keep.
        $this->ask()->assertCreated()
            ->assertJsonPath('message', 'Thank you — we will write back to confirm a time.');

        $this->ask(['kind' => Enquiry::QUESTION, 'prefers_at' => null])->assertCreated()
            ->assertJsonPath('message', 'Thank you — we will get back to you.');
    }

    public function test_a_time_that_has_already_gone_is_refused(): void
    {
        // A year mistyped as 2025 would otherwise send whoever answers this to
        // a slot months in the past.
        $this->ask(['prefers_at' => now()->subDay()->toIso8601String()])
            ->assertStatus(422)
            ->assertJsonValidationErrors('prefers_at');
    }

    public function test_a_trade_nobody_offers_is_refused_rather_than_stored(): void
    {
        $this->ask(['business_type' => 'goldsmith'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('business_type');
    }

    public function test_the_city_is_taken_as_typed(): void
    {
        // NOT a foreign key. Whoever fills this in has no account and will
        // write "Karachi (Gulshan)" — refusing them for it loses the lead over
        // a bracket. Setup asks the question properly once they are a shop.
        $this->ask()->assertCreated();

        $this->assertDatabaseHas('enquiries', ['city' => 'Karachi (Gulshan)']);
    }

    // ── Reaching somebody ───────────────────────────────────────────

    public function test_a_signed_out_visitor_cannot_read_the_enquiries(): void
    {
        $this->ask()->assertCreated();

        $this->getJson('/api/v1/admin/enquiries')->assertStatus(401);
    }

    public function test_a_shop_owner_cannot_read_the_enquiries(): void
    {
        $this->ask()->assertCreated();
        $owner = User::factory()->create(['role' => UserRole::ShopOwner]);

        $this->actingAsUser($owner)->getJson('/api/v1/admin/enquiries')->assertForbidden();
    }

    public function test_the_person_who_has_waited_longest_is_offered_first(): void
    {
        // INSERTED NEWEST FIRST, on purpose. Written the other way round this
        // test passed with the ordering deleted: the row that should come back
        // first was also the row that went in first, so a query with no ORDER
        // BY at all handed back the right answer by luck.
        $this->ask(['email' => 'newest@example.com'])->assertCreated();
        $this->ask(['email' => 'oldest@example.com'])->assertCreated();
        Enquiry::query()->where('email', 'oldest@example.com')
            ->update(['created_at' => now()->subDays(3)]);

        $rows = $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/enquiries')->assertOk()->json('data');

        $this->assertSame('oldest@example.com', $rows[0]['email'],
            'the enquiry that has waited longest was not offered first');
    }

    public function test_questions_and_walkthroughs_can_be_read_apart(): void
    {
        // A question wants answering today; a walkthrough wants half an hour
        // next week. One queue means the quick ones sit behind the slow ones.
        $this->ask(['email' => 'walk@example.com'])->assertCreated();
        $this->ask(['kind' => Enquiry::QUESTION, 'email' => 'ask@example.com', 'prefers_at' => null])->assertCreated();

        $rows = $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/enquiries?kind='.Enquiry::QUESTION)->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('ask@example.com', $rows[0]['email']);
    }

    public function test_answering_records_who_answered_and_when(): void
    {
        $this->ask()->assertCreated();
        $enquiry = Enquiry::query()->firstOrFail();
        $admin = $this->anAdmin();

        $this->actingAsUser($admin)
            ->patchJson("/api/v1/admin/enquiries/{$enquiry->id}", [
                'status' => Enquiry::CONTACTED,
                'handling_note' => 'Called — walkthrough Thursday 4pm.',
            ])->assertOk();

        $enquiry->refresh();
        $this->assertSame(Enquiry::CONTACTED, $enquiry->status);
        $this->assertSame($admin->id, $enquiry->handled_by,
            'the queue cannot say who picked this up');
        $this->assertNotNull($enquiry->handled_at);
    }

    public function test_a_closed_enquiry_leaves_the_open_queue(): void
    {
        $this->ask(['email' => 'done@example.com'])->assertCreated();
        $this->ask(['email' => 'waiting@example.com'])->assertCreated();
        $done = Enquiry::query()->where('email', 'done@example.com')->firstOrFail();

        $this->actingAsUser($this->anAdmin())
            ->patchJson("/api/v1/admin/enquiries/{$done->id}", ['status' => Enquiry::CLOSED])
            ->assertOk();

        $rows = $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/enquiries')->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('waiting@example.com', $rows[0]['email']);
    }

    public function test_the_whole_list_is_oldest_first_too(): void
    {
        // THIS is the test that actually pins the ordering, and it took two
        // goes. The open queue is filtered by status, and SQLite serves that
        // filter from the (status, created_at) index — so the rows came back
        // oldest-first with the ORDER BY deleted, and the test passed against
        // its own bug. The unfiltered list has no index to fall back on, so
        // the order it returns is the order the query asks for or nothing.
        $this->ask(['email' => 'newest@example.com'])->assertCreated();
        $this->ask(['email' => 'oldest@example.com'])->assertCreated();
        Enquiry::query()->where('email', 'oldest@example.com')
            ->update(['created_at' => now()->subDays(3)]);

        $rows = $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/enquiries?status=all')->assertOk()->json('data');

        $this->assertSame(
            ['oldest@example.com', 'newest@example.com'],
            array_column($rows, 'email'),
            'the list is not ordered by how long somebody has been waiting',
        );
    }

    public function test_a_filter_it_does_not_recognise_returns_nothing_rather_than_everything(): void
    {
        // It used to fall through to an unfiltered list, so a typo in the
        // query string quietly showed closed enquiries beside open ones.
        $this->ask()->assertCreated();

        $this->actingAsUser($this->anAdmin())
            ->getJson('/api/v1/admin/enquiries?status=pending')->assertStatus(422);
    }

    public function test_a_status_nobody_defined_is_refused(): void
    {
        $this->ask()->assertCreated();
        $enquiry = Enquiry::query()->firstOrFail();

        $this->actingAsUser($this->anAdmin())
            ->patchJson("/api/v1/admin/enquiries/{$enquiry->id}", ['status' => 'maybe'])
            ->assertStatus(422);
    }
}
