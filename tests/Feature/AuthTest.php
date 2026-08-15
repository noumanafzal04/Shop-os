<?php

namespace Tests\Feature;

use App\Enums\OtpPurpose;
use App\Models\OtpCode;
use App\Models\Tenant;
use App\Models\User;
use App\Services\OtpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Rate limiting is covered by config, not by these behavioural tests.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    /**
     * Laravel caches resolved auth guards across requests within one test —
     * flush them so each request re-authenticates its bearer token.
     */
    public function withToken(string $token, string $type = 'Bearer'): static
    {
        $this->app['auth']->forgetGuards();

        return parent::withToken($token, $type);
    }

    // ── Password login ──────────────────────────────────────────────

    public function test_login_with_email_returns_tokens_and_user(): void
    {
        $user = User::factory()->create(['email' => 'owner@test.com']);

        $response = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com',
            'password' => 'password',
            'device_name' => 'iphone-15',
        ]);

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.user.email', 'owner@test.com')
            ->assertJsonStructure(['data' => ['access_token', 'refresh_token', 'expires_in']]);
    }

    public function test_login_with_phone_works(): void
    {
        User::factory()->create(['phone' => '+923001234567']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => '+923001234567',
            'password' => 'password',
        ])->assertOk();
    }

    public function test_wrong_password_is_generic_401(): void
    {
        User::factory()->create(['email' => 'owner@test.com']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com',
            'password' => 'wrong',
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'INVALID_CREDENTIALS');
    }

    public function test_unknown_user_gets_identical_generic_401(): void
    {
        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'ghost@test.com',
            'password' => 'password',
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'INVALID_CREDENTIALS');
    }

    public function test_soft_deleted_user_gets_generic_401_no_enumeration(): void
    {
        $user = User::factory()->create(['email' => 'gone@test.com']);
        $user->delete();

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'gone@test.com',
            'password' => 'password',
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'INVALID_CREDENTIALS');
    }

    // ── The failed-attempt lock ─────────────────────────────────────
    //
    // It stops GUESSING, and that is the whole of its job. It used to be
    // checked before the password was, which put it in reach of anyone who knew
    // a shopkeeper's email address: five wrong guesses and the shop was off its
    // own till for fifteen minutes — one-time codes included, because the guard
    // was shared — from anywhere, as often as somebody cared to. A locked
    // counter at Friday rush hour is the entire loss.

    private function wrongPasswordTimes(int $n, string $email = 'owner@test.com'): void
    {
        for ($i = 0; $i < $n; $i++) {
            $this->postJson('/api/v1/auth/login', ['identifier' => $email, 'password' => 'wrong']);
        }
    }

    public function test_repeated_wrong_passwords_lock_the_account(): void
    {
        User::factory()->create(['email' => 'owner@test.com']);

        $this->wrongPasswordTimes(5);

        $this->assertTrue(User::query()->where('email', 'owner@test.com')->first()->isLocked());
    }

    public function test_a_locked_account_still_refuses_the_next_wrong_password(): void
    {
        // The protection itself. Without this the lock is decoration.
        User::factory()->create(['email' => 'owner@test.com']);
        $this->wrongPasswordTimes(5);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com',
            'password' => 'still-wrong',
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'INVALID_CREDENTIALS');
    }

    public function test_a_stranger_cannot_lock_a_shop_out_of_its_own_till(): void
    {
        // The one that matters. Five wrong guesses from anybody, and then the
        // owner types their real password — and gets in. A lock cannot stop
        // somebody who already has the password, so refusing them only ever
        // cost the person the lock was meant to protect.
        User::factory()->create(['email' => 'owner@test.com']);

        $this->wrongPasswordTimes(5);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com',
            'password' => 'password',
        ])->assertOk()->assertJsonPath('data.user.email', 'owner@test.com');
    }

    public function test_a_one_time_code_also_still_works_after_somebody_else_burned_the_attempts(): void
    {
        // The lock used to live in the guard BOTH login paths share, so five
        // wrong passwords closed the passwordless door as well — and that door
        // is the one a shopkeeper who has forgotten their password walks
        // through. Proving the channel is proving the credential.
        $user = User::factory()->create(['email' => 'owner@test.com']);
        $this->wrongPasswordTimes(5);
        $this->assertTrue($user->fresh()->isLocked());

        $otp = app(OtpService::class)->request('owner@test.com', OtpPurpose::Login);

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'owner@test.com',
            'code' => $otp->getAttribute('debug_code'),
        ])->assertOk()->assertJsonPath('data.user.email', 'owner@test.com');
    }

    public function test_getting_in_clears_the_lock_rather_than_leaving_it_to_expire(): void
    {
        User::factory()->create(['email' => 'owner@test.com']);
        $this->wrongPasswordTimes(5);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com',
            'password' => 'password',
        ])->assertOk();

        $fresh = User::query()->where('email', 'owner@test.com')->first();
        $this->assertFalse($fresh->isLocked());
        $this->assertSame(0, (int) $fresh->failed_login_attempts);
    }

    public function test_a_locked_account_does_not_announce_that_it_exists(): void
    {
        // A distinct "locked" answer is a free oracle: try five passwords
        // against an address and watch whether the reply changes. A real
        // account would say ACCOUNT_LOCKED and an imaginary one would not, so
        // anybody could sort a stolen mailing list into customers and strangers
        // without ever guessing a password.
        User::factory()->create(['email' => 'owner@test.com']);
        $this->wrongPasswordTimes(5);

        $real = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'owner@test.com', 'password' => 'wrong',
        ])->json();

        $imaginary = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'nobody@test.com', 'password' => 'wrong',
        ])->json();

        $this->assertSame($imaginary['message'], $real['message']);
        $this->assertSame($imaginary['meta']['error_code'], $real['meta']['error_code']);
    }

    public function test_knocking_again_while_locked_does_not_extend_the_lock(): void
    {
        // Otherwise the window is not a ceiling on guesses, it is a punishment
        // that compounds — and anybody could hold a shop out indefinitely by
        // knocking once a minute for as long as they liked.
        User::factory()->create(['email' => 'owner@test.com']);
        $this->wrongPasswordTimes(5);

        $lockedAt = User::query()->where('email', 'owner@test.com')->first()->locked_until;

        $this->travel(2)->minutes();
        $this->wrongPasswordTimes(3);

        $this->assertEquals(
            $lockedAt->timestamp,
            User::query()->where('email', 'owner@test.com')->first()->locked_until->timestamp,
        );
    }

    public function test_suspended_user_cannot_login(): void
    {
        User::factory()->suspended()->create(['email' => 'sus@test.com']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'sus@test.com',
            'password' => 'password',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'ACCOUNT_SUSPENDED');
    }

    public function test_owner_of_suspended_tenant_cannot_login(): void
    {
        $tenant = Tenant::factory()->suspended()->create();
        User::factory()->shopOwner($tenant)->create(['email' => 'shop@test.com']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'shop@test.com',
            'password' => 'password',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'TENANT_SUSPENDED');
    }

    public function test_owner_of_deleted_tenant_cannot_login(): void
    {
        $tenant = Tenant::factory()->create();
        User::factory()->shopOwner($tenant)->create(['email' => 'shop@test.com']);
        $tenant->delete();

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'shop@test.com',
            'password' => 'password',
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'TENANT_DELETED');
    }

    public function test_expired_subscription_still_allows_login(): void
    {
        $tenant = Tenant::factory()->create(['subscription_ends_at' => now()->subDay()]);
        User::factory()->shopOwner($tenant)->create(['email' => 'shop@test.com']);

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'shop@test.com',
            'password' => 'password',
        ])->assertOk()->assertJsonPath('data.user.tenant.subscription_expired', true);
    }

    // ── OTP ─────────────────────────────────────────────────────────

    public function test_full_otp_login_flow(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);

        $request = $this->postJson('/api/v1/auth/otp/request', [
            'identifier' => 'otp@test.com',
            'purpose' => 'login',
        ])->assertOk();

        $code = $request->json('data.debug_code');
        $this->assertNotNull($code);

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com',
            'code' => $code,
        ])->assertOk()->assertJsonStructure(['data' => ['access_token', 'refresh_token']]);
    }

    public function test_otp_request_for_unknown_user_responds_identically(): void
    {
        $this->postJson('/api/v1/auth/otp/request', [
            'identifier' => 'ghost@test.com',
            'purpose' => 'login',
        ])->assertOk()->assertJsonPath('message', 'If the account exists, a code has been sent.');

        $this->assertDatabaseCount('otp_codes', 0);
    }

    public function test_wrong_otp_code_rejected_and_attempts_counted(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);
        app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com',
            'code' => '000000',
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'OTP_INVALID');

        $this->assertEquals(1, OtpCode::first()->attempts);
    }

    public function test_otp_max_attempts_blocks_even_correct_code(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);
        $otp = app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);
        $code = $otp->getAttribute('debug_code');

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/otp/login', [
                'identifier' => 'otp@test.com', 'code' => '000000',
            ]);
        }

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com', 'code' => $code,
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'OTP_MAX_ATTEMPTS');
    }

    public function test_expired_otp_rejected(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);
        $otp = app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);
        $code = $otp->getAttribute('debug_code');

        $this->travel(6)->minutes();

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com', 'code' => $code,
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'OTP_EXPIRED');
    }

    public function test_otp_is_single_use(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);
        $otp = app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);
        $code = $otp->getAttribute('debug_code');

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com', 'code' => $code,
        ])->assertOk();

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com', 'code' => $code,
        ])->assertStatus(401)->assertJsonPath('meta.error_code', 'OTP_INVALID');
    }

    public function test_new_otp_request_invalidates_previous_code(): void
    {
        User::factory()->create(['email' => 'otp@test.com']);
        $first = app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);
        $firstCode = $first->getAttribute('debug_code');

        app(OtpService::class)->request('otp@test.com', OtpPurpose::Login);

        $this->postJson('/api/v1/auth/otp/login', [
            'identifier' => 'otp@test.com', 'code' => $firstCode,
        ])->assertStatus(401);
    }

    // ── Password reset ──────────────────────────────────────────────

    public function test_password_reset_flow_revokes_all_sessions(): void
    {
        $user = User::factory()->create(['email' => 'reset@test.com']);
        $user->createToken('old-device');

        $otp = app(OtpService::class)->request('reset@test.com', OtpPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', [
            'identifier' => 'reset@test.com',
            'code' => $otp->getAttribute('debug_code'),
            'password' => 'new-password-123',
            'password_confirmation' => 'new-password-123',
        ])->assertOk();

        $this->assertEquals(0, $user->tokens()->count());

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'reset@test.com',
            'password' => 'new-password-123',
        ])->assertOk();
    }

    // ── Tokens: refresh / abilities / logout ───────────────────────

    private function loginAndGetTokens(string $email = 'tok@test.com'): array
    {
        User::factory()->create(['email' => $email]);

        return $this->postJson('/api/v1/auth/login', [
            'identifier' => $email,
            'password' => 'password',
            'device_name' => 'test-device',
        ])->json('data');
    }

    public function test_refresh_rotates_tokens_and_old_refresh_dies(): void
    {
        $tokens = $this->loginAndGetTokens();

        $refreshed = $this->withToken($tokens['refresh_token'])
            ->postJson('/api/v1/auth/refresh')
            ->assertOk()
            ->json('data');

        $this->assertNotEquals($tokens['access_token'], $refreshed['access_token']);

        // Old refresh token is single-use.
        $this->withToken($tokens['refresh_token'])
            ->postJson('/api/v1/auth/refresh')
            ->assertStatus(401);
    }

    public function test_access_token_cannot_refresh_and_refresh_token_cannot_access(): void
    {
        $tokens = $this->loginAndGetTokens();

        $this->withToken($tokens['access_token'])
            ->postJson('/api/v1/auth/refresh')
            ->assertStatus(401);

        $this->withToken($tokens['refresh_token'])
            ->getJson('/api/v1/auth/me')
            ->assertStatus(403); // missing 'access' ability
    }

    public function test_me_returns_profile(): void
    {
        $tokens = $this->loginAndGetTokens();

        $this->withToken($tokens['access_token'])
            ->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'tok@test.com');
    }

    public function test_logout_kills_device_pair_only(): void
    {
        $user = User::factory()->create(['email' => 'multi@test.com']);

        $deviceA = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'multi@test.com', 'password' => 'password', 'device_name' => 'phone',
        ])->json('data');

        $deviceB = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'multi@test.com', 'password' => 'password', 'device_name' => 'laptop',
        ])->json('data');

        $this->withToken($deviceA['access_token'])->postJson('/api/v1/auth/logout')->assertOk();

        // Device A dead, device B alive.
        $this->withToken($deviceA['access_token'])->getJson('/api/v1/auth/me')->assertStatus(401);
        $this->withToken($deviceB['access_token'])->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_logout_all_kills_every_session(): void
    {
        $user = User::factory()->create(['email' => 'multi@test.com']);

        $a = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'multi@test.com', 'password' => 'password', 'device_name' => 'phone',
        ])->json('data');

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'multi@test.com', 'password' => 'password', 'device_name' => 'laptop',
        ]);

        $this->withToken($a['access_token'])->postJson('/api/v1/auth/logout-all')->assertOk();

        $this->assertEquals(0, $user->tokens()->count());
    }

    public function test_change_password_requires_current_and_revokes_other_sessions(): void
    {
        $user = User::factory()->create(['email' => 'chg@test.com']);

        $phone = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'chg@test.com', 'password' => 'password', 'device_name' => 'phone',
        ])->json('data');

        $laptop = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'chg@test.com', 'password' => 'password', 'device_name' => 'laptop',
        ])->json('data');

        // Wrong current password → 422.
        $this->withToken($phone['access_token'])->postJson('/api/v1/auth/password/change', [
            'current_password' => 'nope',
            'password' => 'brand-new-pass1',
            'password_confirmation' => 'brand-new-pass1',
        ])->assertStatus(422);

        // Correct current password → other device logged out, this one stays.
        $this->withToken($phone['access_token'])->postJson('/api/v1/auth/password/change', [
            'current_password' => 'password',
            'password' => 'brand-new-pass1',
            'password_confirmation' => 'brand-new-pass1',
        ])->assertOk();

        $this->withToken($phone['access_token'])->getJson('/api/v1/auth/me')->assertOk();
        $this->withToken($laptop['access_token'])->getJson('/api/v1/auth/me')->assertStatus(401);
    }

    public function test_sessions_list_and_revoke(): void
    {
        $user = User::factory()->create(['email' => 'ses@test.com']);

        $phone = $this->postJson('/api/v1/auth/login', [
            'identifier' => 'ses@test.com', 'password' => 'password', 'device_name' => 'phone',
        ])->json('data');

        $this->postJson('/api/v1/auth/login', [
            'identifier' => 'ses@test.com', 'password' => 'password', 'device_name' => 'laptop',
        ]);

        $list = $this->withToken($phone['access_token'])
            ->getJson('/api/v1/auth/sessions')
            ->assertOk()
            ->json('data');

        $this->assertCount(2, $list);

        $laptopSession = collect($list)->firstWhere('device_name', 'laptop');

        $this->withToken($phone['access_token'])
            ->deleteJson('/api/v1/auth/sessions/'.$laptopSession['id'])
            ->assertOk();

        $this->assertCount(1, $this->withToken($phone['access_token'])
            ->getJson('/api/v1/auth/sessions')->json('data'));
    }
}
