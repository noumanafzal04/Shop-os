<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Putting a locked-out shop owner back into their own business.
 *
 * Before this there was no path at all — the OTP reset needs a phone or email
 * the owner may no longer hold, so the only remaining option was a MySQL
 * console against production. This is the most dangerous endpoint on the
 * platform (it can hand anyone the keys to any business), so the tests are
 * mostly about who may NOT call it.
 */
class AdminAccountRecoveryTest extends TestCase
{
    use RefreshDatabase;

    private User $superAdmin;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        $this->superAdmin = User::factory()->superAdmin()->create();
        $this->tenant = Tenant::factory()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create([
            'email' => 'owner@shop.test',
            'password' => 'the-forgotten-one',
        ]);
    }

    private function asUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function resetUrl(?Tenant $tenant = null): string
    {
        return '/api/v1/admin/tenants/'.($tenant ?? $this->tenant)->id.'/owner-password';
    }

    // ── The happy path ──────────────────────────────────────────────

    public function test_a_super_admin_can_put_a_locked_out_owner_back_in(): void
    {
        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'a-brand-new-password',
                'password_confirmation' => 'a-brand-new-password',
            ])
            ->assertOk();

        $this->owner->refresh();

        $this->assertTrue(Hash::check('a-brand-new-password', $this->owner->password));
        $this->assertFalse(Hash::check('the-forgotten-one', $this->owner->password));
    }

    public function test_the_owner_can_actually_log_in_with_what_the_admin_set(): void
    {
        $this->asUser($this->superAdmin)->postJson($this->resetUrl(), [
            'password' => 'shop-is-open-again',
            'password_confirmation' => 'shop-is-open-again',
        ])->assertOk();

        $this->app['auth']->forgetGuards();

        // The point of the whole feature: not "the hash changed" but "the
        // shopkeeper is back in". A reset that writes a hash the login flow
        // then refuses is exactly the failure this endpoint exists to end.
        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@shop.test',
            'password' => 'shop-is-open-again',
        ])->assertOk();
    }

    public function test_every_session_the_owner_had_is_destroyed(): void
    {
        $this->owner->createToken('phone', ['access']);
        $this->owner->createToken('till', ['access']);
        $this->assertSame(2, $this->owner->tokens()->count());

        $this->asUser($this->superAdmin)->postJson($this->resetUrl(), [
            'password' => 'locked-them-out',
            'password_confirmation' => 'locked-them-out',
        ])->assertOk();

        // The likeliest reason an owner asks for this is that someone else is
        // in their account. Leaving that session alive would defeat the reset.
        $this->assertSame(0, $this->owner->tokens()->count());
    }

    public function test_the_new_password_is_never_echoed_back(): void
    {
        $response = $this->asUser($this->superAdmin)->postJson($this->resetUrl(), [
            'password' => 'never-put-me-in-a-log',
            'password_confirmation' => 'never-put-me-in-a-log',
        ])->assertOk();

        $this->assertStringNotContainsString('never-put-me-in-a-log', $response->getContent());
    }

    public function test_the_reset_is_recorded_against_the_admin_who_did_it(): void
    {
        $this->asUser($this->superAdmin)->postJson($this->resetUrl(), [
            'password' => 'audited-please',
            'password_confirmation' => 'audited-please',
        ])->assertOk();

        $log = AuditLog::query()->where('event', 'owner_password_reset')->first();

        $this->assertNotNull($log, 'A takeover-capable action left no trail.');
        $this->assertSame($this->superAdmin->id, $log->user_id);
        $this->assertSame($this->tenant->id, $log->tenant_id);
        $this->assertSame($this->owner->id, $log->auditable_id);
        // The password itself must never reach the trail.
        $this->assertStringNotContainsString('audited-please', json_encode($log->new_values));
    }

    // ── Who may not ─────────────────────────────────────────────────

    public function test_editing_a_tenant_does_not_imply_taking_it_over(): void
    {
        // The whole reason this is its own permission. Support staff who fix
        // typos in shop addresses hold tenants.update; if that also let them
        // set an owner's password, every one of them could sign in as any
        // business on the platform.
        $support = User::factory()->adminStaff([
            Permissions::TENANTS_VIEW,
            Permissions::TENANTS_UPDATE,
            Permissions::TENANTS_SUSPEND,
        ])->create();

        $this->asUser($support)
            ->postJson($this->resetUrl(), [
                'password' => 'not-for-you',
                'password_confirmation' => 'not-for-you',
            ])
            ->assertForbidden();

        $this->assertTrue(Hash::check('the-forgotten-one', $this->owner->fresh()->password));
    }

    public function test_platform_staff_granted_the_permission_may_reset(): void
    {
        $recovery = User::factory()->adminStaff([
            Permissions::TENANTS_VIEW,
            Permissions::TENANTS_RESET_PASSWORD,
        ])->create();

        $this->asUser($recovery)
            ->postJson($this->resetUrl(), [
                'password' => 'granted-explicitly',
                'password_confirmation' => 'granted-explicitly',
            ])
            ->assertOk();
    }

    public function test_a_shop_owner_cannot_reset_another_shops_owner(): void
    {
        $otherTenant = Tenant::factory()->create();
        $intruder = User::factory()->shopOwner($otherTenant)->create();

        // Shop owners hold every TENANT permission by role. The admin routes
        // are fenced by role before permission, and this proves the fence:
        // hasPermission() returns true for a shop owner on any string.
        $this->asUser($intruder)->postJson($this->resetUrl(), [
            'password' => 'give-me-that-shop',
            'password_confirmation' => 'give-me-that-shop',
        ])->assertForbidden();

        $this->assertTrue(Hash::check('the-forgotten-one', $this->owner->fresh()->password));
    }

    public function test_an_unauthenticated_caller_gets_nowhere(): void
    {
        $this->postJson($this->resetUrl(), [
            'password' => 'anonymous-takeover',
            'password_confirmation' => 'anonymous-takeover',
        ])->assertUnauthorized();
    }

    // ── Refusing to guess ───────────────────────────────────────────

    public function test_a_business_with_two_owners_must_say_which_one(): void
    {
        User::factory()->shopOwner($this->tenant)->create();

        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'which-partner',
                'password_confirmation' => 'which-partner',
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'MULTIPLE_OWNERS');

        // Nothing was changed while the question was open.
        $this->assertTrue(Hash::check('the-forgotten-one', $this->owner->fresh()->password));
    }

    public function test_naming_the_owner_resolves_the_ambiguity(): void
    {
        $partner = User::factory()->shopOwner($this->tenant)->create();

        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'the-second-partner',
                'password_confirmation' => 'the-second-partner',
                'user_id' => $partner->id,
            ])
            ->assertOk();

        $this->assertTrue(Hash::check('the-second-partner', $partner->fresh()->password));
        // And the one who was not named is untouched.
        $this->assertTrue(Hash::check('the-forgotten-one', $this->owner->fresh()->password));
    }

    public function test_an_owner_of_a_different_shop_cannot_be_reset_through_this_tenant(): void
    {
        $elsewhere = User::factory()->shopOwner(Tenant::factory()->create())->create();

        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'wrong-shop',
                'password_confirmation' => 'wrong-shop',
                'user_id' => $elsewhere->id,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NOT_AN_OWNER_OF_THIS_TENANT');
    }

    public function test_a_cashier_is_not_an_owner(): void
    {
        // Staff passwords are the shop owner's business, not the platform's.
        // Reaching them through the tenant endpoint would route around that.
        $cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'not-through-here',
                'password_confirmation' => 'not-through-here',
                'user_id' => $cashier->id,
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'NOT_AN_OWNER_OF_THIS_TENANT');
    }

    public function test_a_business_with_no_owner_says_so(): void
    {
        $this->owner->forceDelete();

        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'nobody-home',
                'password_confirmation' => 'nobody-home',
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'TENANT_HAS_NO_OWNER');
    }

    // ── The password itself ─────────────────────────────────────────

    public function test_a_mistyped_confirmation_is_refused(): void
    {
        // Not pedantry: the admin is about to read this down a phone line, and
        // a typo does not bounce back as "wrong password" the way their own
        // would — it locks the owner out a second time.
        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), [
                'password' => 'correct-horse',
                'password_confirmation' => 'correct-hose',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');

        $this->assertTrue(Hash::check('the-forgotten-one', $this->owner->fresh()->password));
    }

    public function test_a_short_password_is_refused(): void
    {
        $this->asUser($this->superAdmin)
            ->postJson($this->resetUrl(), ['password' => 'abc123', 'password_confirmation' => 'abc123'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('password');
    }

    // ── The other half of the request: changing your own ────────────

    public function test_a_super_admin_can_change_their_own_password(): void
    {
        $admin = User::factory()->superAdmin()->create(['password' => 'the-seeded-one']);

        $this->asUser($admin)
            ->postJson('/api/v1/auth/password/change', [
                'current_password' => 'the-seeded-one',
                'password' => 'something-nobody-published',
                'password_confirmation' => 'something-nobody-published',
            ])
            ->assertOk();

        $this->assertTrue(Hash::check('something-nobody-published', $admin->fresh()->password));
    }

    public function test_changing_your_own_password_needs_the_current_one(): void
    {
        $admin = User::factory()->superAdmin()->create(['password' => 'the-seeded-one']);

        $this->asUser($admin)
            ->postJson('/api/v1/auth/password/change', [
                'current_password' => 'a-guess',
                'password' => 'stolen-session-takeover',
                'password_confirmation' => 'stolen-session-takeover',
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CURRENT_PASSWORD_MISMATCH');
    }
}
