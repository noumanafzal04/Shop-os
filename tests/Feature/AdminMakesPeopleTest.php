<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\RiderProfile;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * STAFF MAKING A PERSON, at a desk.
 *
 * ── The gap ─────────────────────────────────────────────────────────────
 *
 * A rider could become one in two ways — apply and wait, or claim an id their
 * shop minted — and a customer in exactly one: download the app and register.
 * Staff sitting with somebody at a signup drive, on a support call, or setting
 * up a tester before an APK exists had no door at all, and the answer was
 * always "ask them to install it first", which is not an answer.
 *
 * ── The part worth testing ──────────────────────────────────────────────
 *
 * An admin-made rider IS platform-approved — the admin's name is on the
 * verdict — and may join the pool. That is not a shortcut around the check: it
 * is the check, performed by the person it exists to be performed by. Getting
 * it wrong in the other direction would be worse than anything, so the row has
 * to carry `approved_by` and `isPlatformApproved()` must agree with it.
 *
 * And both doors refuse an account nobody can sign into. Login takes an
 * `identifier` that is "email or phone"; an account with neither is a row that
 * looks fine and can never be opened, and nothing would have said so until the
 * person tried.
 */
class AdminMakesPeopleTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Riders ──────────────────────────────────────────────────────

    public function test_an_admin_makes_a_rider_who_can_ride_immediately(): void
    {
        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true, 'latitude' => 31.52, 'longitude' => 74.35]);

        $data = $this->as($this->admin)->postJson('/api/v1/admin/riders', [
            'name' => 'Ahmed Raza',
            'phone' => '03009998877',
            'password' => 'password123',
            'vehicle_type' => 'bike',
            'city_id' => $city->id,
        ])->assertCreated()->json('data');

        $this->assertMatchesRegularExpression('/^RDR-\d{6}$/', $data['rider_code']);
        $this->assertSame('Ahmed Raza', $data['name']);
        $this->assertSame('approved', $data['status']);
    }

    /**
     * THE ONE THAT MATTERS. The admin's name is on the verdict, so it is the
     * platform's word and the pool is open — unlike a shop's, which is not.
     */
    public function test_the_verdict_carries_the_admin_s_name(): void
    {
        $this->as($this->admin)->postJson('/api/v1/admin/riders', [
            'name' => 'Ahmed', 'phone' => '03009998877', 'password' => 'password123',
        ])->assertCreated();

        $profile = RiderProfile::query()->firstOrFail();

        $this->assertSame($this->admin->id, $profile->approved_by);
        $this->assertTrue($profile->isPlatformApproved());
        // …which is the difference the admin queue was just taught to show.
        $this->assertNull($profile->vouched_by_tenant_id);
    }

    /** And the person can actually use it — the account is real and signed in. */
    public function test_the_rider_can_sign_in_and_go_into_the_pool(): void
    {
        $this->as($this->admin)->postJson('/api/v1/admin/riders', [
            'name' => 'Ahmed', 'phone' => '03009998877', 'password' => 'password123',
            'is_platform' => false,
        ])->assertCreated();

        // Signs in with the number staff typed — the account is real, not a
        // profile with nothing behind it.
        $this->postJson('/api/v1/auth/login', [
            'identifier' => '03009998877', 'password' => 'password123',
        ])->assertOk();

        $ahmed = User::query()->where('phone', '03009998877')->firstOrFail();
        // A shop-vouched rider is refused here. This one is not.
        $this->as($ahmed)->putJson('/api/v1/rider/pool', ['is_platform' => true])->assertOk();
    }

    // ── Customers ───────────────────────────────────────────────────

    public function test_an_admin_makes_a_customer_who_can_sign_in(): void
    {
        $this->as($this->admin)->postJson('/api/v1/admin/customers', [
            'name' => 'Farhan', 'phone' => '03001112222', 'password' => 'password123',
        ])->assertCreated()->assertJsonPath('data.name', 'Farhan');

        $this->postJson('/api/v1/auth/login', [
            'identifier' => '03001112222', 'password' => 'password123',
        ])->assertOk();
    }

    // ── What both doors refuse ──────────────────────────────────────

    /**
     * An account with neither a phone nor an email is a row that looks fine
     * and can never be opened. Login takes one or the other and nothing else.
     */
    public function test_neither_door_makes_an_account_nobody_can_sign_into(): void
    {
        $this->as($this->admin)->postJson('/api/v1/admin/customers', [
            'name' => 'Nobody', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone', 'email']);

        $this->as($this->admin)->postJson('/api/v1/admin/riders', [
            'name' => 'Nobody', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone', 'email']);
    }

    public function test_a_number_already_in_use_is_refused_rather_than_shadowing_somebody(): void
    {
        User::factory()->create(['phone' => '03001112222']);

        $this->as($this->admin)->postJson('/api/v1/admin/customers', [
            'name' => 'Farhan', 'phone' => '03001112222', 'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone']);
    }

    /** Neither door is open to somebody who is not staff. */
    public function test_a_shopkeeper_cannot_make_people(): void
    {
        $tenant = Tenant::factory()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->as($owner)->postJson('/api/v1/admin/customers', [
            'name' => 'X', 'phone' => '03004445555', 'password' => 'password123',
        ])->assertForbidden();

        $this->as($owner)->postJson('/api/v1/admin/riders', [
            'name' => 'X', 'phone' => '03004445556', 'password' => 'password123',
        ])->assertForbidden();
    }
}
