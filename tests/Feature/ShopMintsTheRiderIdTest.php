<?php

namespace Tests\Feature;

use App\Enums\RiderStatus;
use App\Models\Rider;
use App\Models\RiderProfile;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE SHOP HANDS OUT THE ID, instead of asking for one.
 *
 * ── The flow that was ───────────────────────────────────────────────────
 *
 * A shop wanting its own rider on the app had to wait for that rider to
 * install it, sign up, apply, be approved by platform staff, find RDR-000123
 * on their own screen and read it out — and only then could the shop type it
 * in. Five steps belonging to somebody who is not the shop, for an outcome
 * only the shop wanted.
 *
 * Now the id is minted when the shop adds the rider, and the rider CLAIMS it.
 * Same code, opposite direction.
 *
 * ── The thing this file is really guarding ──────────────────────────────
 *
 * A shop-minted rider is `approved`, because the shop knows them and is
 * vouching for them — that is what the platform check is for when nobody does.
 * But `setPlatform()` asked only `status->canRide()`, which was right while
 * every approved profile had been approved by a person and is wrong the moment
 * a shop can mint one. Without the fence below, any shop could add anybody and
 * that person could put themselves in the CartZe pool — carrying strangers'
 * goods and strangers' cash, with no CNIC, no licence, and nobody having
 * looked at them once.
 */
class ShopMintsTheRiderIdTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->create([
            'business_name' => 'Chacha Mart',
            'online_shop_enabled' => true, 'setup_completed' => true,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Add a rider the way a shop does, and read the id back off the reply. */
    private function addRider(string $name = 'Ahmed'): array
    {
        return $this->as($this->owner)->postJson('/api/v1/riders', [
            'name' => $name, 'phone' => '03001234567',
        ])->assertCreated()->json('data');
    }

    // ── Minting ─────────────────────────────────────────────────────

    public function test_adding_a_rider_hands_the_shop_an_id_to_give_them(): void
    {
        $rider = $this->addRider();

        // The id is in the reply to the button press — the shop never goes
        // looking for it, and never has to ask the rider for it.
        $this->assertMatchesRegularExpression('/^RDR-\d{6}$/', $rider['rider_code']);
        // …and nobody is holding it yet. `has_app` is about the PERSON, not
        // about whether a row exists: until somebody claims the id, this shop
        // has exactly the phone-call rider it had before, and everything that
        // reads `has_app` must keep saying so.
        $this->assertFalse($rider['has_app']);
    }

    public function test_the_minted_rider_may_carry_this_shops_orders_straight_away(): void
    {
        $rider = $this->addRider();
        $profile = RiderProfile::query()->where('rider_code', $rider['rider_code'])->firstOrFail();

        // Approved, because the shop is vouching — no waiting for staff.
        $this->assertTrue($profile->status->canRide());
        $this->assertSame($this->shop->id, $profile->vouched_by_tenant_id);
        $this->assertNull($profile->user_id);

        // But it is the SHOP's word, not the platform's, and the row says so.
        $this->assertNull($profile->approved_by);
        $this->assertFalse($profile->isPlatformApproved());
        $this->assertFalse($profile->is_platform);
    }

    public function test_two_riders_never_share_an_id(): void
    {
        $a = $this->addRider('Ahmed');
        $b = $this->addRider('Bilal');

        $this->assertNotSame($a['rider_code'], $b['rider_code']);
        $this->assertSame(2, RiderProfile::query()->whereNull('user_id')->count());
    }

    /**
     * THE MIGRATION'S PROMISE, KEPT.
     *
     * "A shop with no app-using riders behaves tomorrow exactly as it does
     * now." Minting an id must not quietly move such a shop into the app world
     * — no live pin on the customer's tracking, no handover code, the panel
     * still driving the status. All three hold because each is gated on
     * something only the app can set, and this says so out loud rather than
     * leaving it to be rediscovered.
     */
    public function test_an_unclaimed_id_leaves_a_phone_call_shop_exactly_as_it_was(): void
    {
        $rider = $this->addRider('Cousin Asif');
        $profile = RiderProfile::query()->where('rider_code', $rider['rider_code'])->firstOrFail();

        $this->assertFalse($rider['has_app']);
        // Nothing the app sets has been set, which is what every downstream
        // gate actually reads.
        $this->assertNull($profile->user_id);
        $this->assertNull($profile->latitude);
        $this->assertNull($profile->last_seen_at);
        $this->assertFalse($profile->is_online);
    }

    // ── Claiming ────────────────────────────────────────────────────

    public function test_a_rider_claims_the_id_the_shop_wrote_down_for_them(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create(['name' => 'Ahmed']);

        // Before: this account is nobody.
        $this->as($ahmed)->getJson('/api/v1/rider/me')->assertOk()->assertJsonPath('data.profile', null);

        $claimed = $this->as($ahmed)->postJson('/api/v1/rider/claim', [
            // Typed in lower case, as it will be on a phone keyboard.
            'rider_code' => strtolower($rider['rider_code']),
        ])->assertOk()->json('data');

        $this->assertSame($rider['rider_code'], $claimed['rider_code']);
        $this->assertTrue($claimed['can_ride']);
        // The app tells them whose rider they are, so the pool refusal later
        // arrives as a fact they already knew rather than as a surprise.
        $this->assertSame('Chacha Mart', $claimed['vouched_by']);

        $this->assertSame($ahmed->id, RiderProfile::query()
            ->where('rider_code', $rider['rider_code'])->value('user_id'));

        // And the shop's list now says somebody picked it up.
        $row = $this->as($this->owner)->getJson('/api/v1/riders')->assertOk()->json('data.0');
        $this->assertTrue($row['has_app']);
        $this->assertSame($rider['rider_code'], $row['rider_code']);
    }

    public function test_an_id_can_only_be_claimed_once(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create();
        $stranger = User::factory()->create();

        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])->assertOk();

        $this->as($stranger)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_CODE_TAKEN');
    }

    public function test_an_unknown_id_is_refused_by_name(): void
    {
        $this->as(User::factory()->create())
            ->postJson('/api/v1/rider/claim', ['rider_code' => 'RDR-000999'])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'RIDER_CODE_UNKNOWN');
    }

    public function test_somebody_who_is_already_a_rider_cannot_claim_a_second_id(): void
    {
        $first = $this->addRider('Ahmed');
        $second = $this->addRider('Bilal');
        $ahmed = User::factory()->create();

        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $first['rider_code']])->assertOk();
        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $second['rider_code']])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'RIDER_ALREADY_CLAIMED');
    }

    // ── The fence ───────────────────────────────────────────────────

    /**
     * THE ONE THAT MATTERS. A shop's word is good for that shop and no further.
     */
    public function test_a_shop_vouched_rider_cannot_put_themselves_in_the_platform_pool(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create();
        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])->assertOk();

        $this->as($ahmed)->putJson('/api/v1/rider/pool', ['is_platform' => true])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'RIDER_NOT_PLATFORM_APPROVED');

        $this->assertFalse(RiderProfile::query()->where('user_id', $ahmed->id)->value('is_platform'));
    }

    /**
     * And the app is never drawn a switch that answers 403 — a control that
     * always fails is worse than no control.
     */
    public function test_the_app_is_told_not_to_offer_the_pool_switch(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create();
        $me = $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])
            ->assertOk()->json('data');

        $this->assertFalse($me['can_join_pool']);
    }

    /**
     * LEAVING the pool is never fenced. A rider who wants to stop being offered
     * strangers' work is not somebody to argue with, whatever state they are in.
     */
    public function test_leaving_the_pool_always_works(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create();
        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])->assertOk();

        $this->as($ahmed)->putJson('/api/v1/rider/pool', ['is_platform' => false])->assertOk();
    }

    /**
     * The fence has to be a door, not a wall: applying is the road to the pool,
     * and `apply()` refused every approved profile.
     */
    public function test_a_shop_vouched_rider_can_still_apply_for_the_platform(): void
    {
        $rider = $this->addRider();
        $ahmed = User::factory()->create();
        $this->as($ahmed)->postJson('/api/v1/rider/claim', ['rider_code' => $rider['rider_code']])->assertOk();

        $this->as($ahmed)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1', 'is_platform' => true,
        ])->assertCreated();

        // Back to draft — the papers are what is being asked for now.
        $this->assertSame(RiderStatus::Draft, RiderProfile::query()->where('user_id', $ahmed->id)->value('status'));
    }

    /**
     * A rider the PLATFORM approved is untouched by any of this. Without this
     * the fence could have been strangling the flow it was written beside and
     * nothing would have said so.
     */
    public function test_a_platform_approved_rider_still_joins_the_pool(): void
    {
        $ahmed = User::factory()->create();
        $this->as($ahmed)->postJson('/api/v1/rider/apply', [
            'vehicle_type' => 'bike', 'cnic' => '35202-1234567-1', 'is_platform' => false,
        ])->assertCreated();

        $profile = RiderProfile::query()->where('user_id', $ahmed->id)->firstOrFail();
        $admin = User::factory()->superAdmin()->create();
        $profile->forceFill([
            'status' => 'approved', 'approved_at' => now(), 'approved_by' => $admin->id,
        ])->save();

        $this->as($ahmed)->putJson('/api/v1/rider/pool', ['is_platform' => true])->assertOk();
        $this->assertTrue(RiderProfile::query()->where('user_id', $ahmed->id)->value('is_platform'));
    }

    /** The shop's own list keeps working — the bridge row is still a Rider. */
    public function test_the_shop_can_still_assign_its_minted_rider_to_an_order(): void
    {
        $rider = $this->addRider();

        $this->assertSame(1, Rider::withoutTenancy()->where('tenant_id', $this->shop->id)->count());
        $this->assertNotNull(Rider::withoutTenancy()->where('id', $rider['id'])->value('rider_profile_id'));
    }
}
