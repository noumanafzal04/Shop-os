<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Register;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Till identity — who the shared terminal thinks is standing at it.
 *
 * The problem this closes: whoever signs in at 9am owns every sale, void and
 * discount for the rest of the day, which quietly voids the per-cashier
 * controls built in Units 6 and 7. A PIN is the only credential a counter will
 * actually use between customers, so the tests here are mostly about the cage
 * built around that weakness:
 *   - a PIN works ONLY from a till already signed in to the same shop;
 *   - a PIN is not a login and never will be;
 *   - wrong PINs freeze the PIN, not the person's password;
 *   - a handover ends the outgoing session, so the next sale is stamped right.
 */
class TillIdentityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $ayesha;

    private User $bilal;

    private Register $lane1;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create(['name' => 'Owner']);
        $this->ayesha = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create(['name' => 'Ayesha']);
        $this->bilal = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create(['name' => 'Bilal']);

        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->lane1 = Register::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cooking oil 1L', 'sku' => 'OIL-1L', 'price' => 500, 'cost' => 400,
            'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function withRawToken(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Setting a PIN ───────────────────────────────────────────────

    public function test_a_cashier_sets_their_own_pin_with_their_password(): void
    {
        $this->actingAsUser($this->ayesha)
            ->putJson('/api/v1/auth/till-pin', ['current_password' => 'password', 'pin' => '4820'])
            ->assertOk();

        $this->assertTrue($this->ayesha->fresh()->hasPin());
    }

    public function test_the_wrong_password_does_not_set_a_pin(): void
    {
        $this->actingAsUser($this->ayesha)
            ->putJson('/api/v1/auth/till-pin', ['current_password' => 'not-it', 'pin' => '4820'])
            ->assertUnauthorized();

        $this->assertFalse($this->ayesha->fresh()->hasPin());
    }

    /**
     * A four-digit secret can only resist casual guessing, so the PINs that
     * get guessed first try are refused outright.
     */
    public function test_guessable_pins_are_refused(): void
    {
        foreach (['0000', '1111', '1234', '4321', '123456'] as $pin) {
            $this->actingAsUser($this->ayesha)
                ->putJson('/api/v1/auth/till-pin', ['current_password' => 'password', 'pin' => $pin])
                ->assertStatus(422);
        }

        $this->actingAsUser($this->ayesha)
            ->putJson('/api/v1/auth/till-pin', ['current_password' => 'password', 'pin' => '123'])
            ->assertStatus(422);
    }

    public function test_an_owner_can_hand_a_new_cashier_a_pin(): void
    {
        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/staff/{$this->bilal->id}/pin", ['pin' => '9174'])
            ->assertOk();

        $this->assertTrue($this->bilal->fresh()->hasPin());
    }

    public function test_a_cashier_cannot_set_someone_elses_pin(): void
    {
        $this->actingAsUser($this->ayesha)
            ->putJson("/api/v1/staff/{$this->bilal->id}/pin", ['pin' => '9174'])
            ->assertForbidden();
    }

    /** A PIN is never readable back — not in the roster, not on the profile. */
    public function test_the_pin_hash_is_never_serialised(): void
    {
        $this->ayesha->setPin('4820');

        $me = $this->actingAsUser($this->ayesha)->getJson('/api/v1/auth/me')->assertOk();
        $me->assertJsonPath('data.has_till_pin', true);
        $me->assertJsonMissingPath('data.pin_hash');

        $this->actingAsUser($this->ayesha)->getJson('/api/v1/pos/till-users')
            ->assertOk()->assertJsonMissing(['pin_hash' => $this->ayesha->fresh()->pin_hash]);
    }

    // ── The roster ──────────────────────────────────────────────────

    public function test_the_roster_lists_who_can_take_the_till_and_who_has_a_pin(): void
    {
        $this->ayesha->setPin('4820');
        // Stock clerk: works here, cannot operate a till.
        User::factory()->tenantStaff($this->tenant, ['inventory.manage'])->create(['name' => 'Kamran']);

        $rows = $this->actingAsUser($this->ayesha)->getJson('/api/v1/pos/till-users')
            ->assertOk()->json('data');

        $names = array_column($rows, 'name');
        $this->assertContains('Ayesha', $names);
        $this->assertContains('Bilal', $names);
        $this->assertContains('Owner', $names);
        $this->assertNotContains('Kamran', $names);

        $ayesha = collect($rows)->firstWhere('name', 'Ayesha');
        $bilal = collect($rows)->firstWhere('name', 'Bilal');
        $this->assertTrue($ayesha['has_pin']);
        $this->assertFalse($bilal['has_pin']);
    }

    public function test_the_roster_never_leaks_across_shops(): void
    {
        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        User::factory()->tenantStaff($other, ['sales.manage'])->create(['name' => 'Somebody Else']);

        $rows = $this->actingAsUser($this->ayesha)->getJson('/api/v1/pos/till-users')->assertOk()->json('data');

        $this->assertNotContains('Somebody Else', array_column($rows, 'name'));
    }

    // ── Unlocking and handover ──────────────────────────────────────

    public function test_unlocking_as_yourself_checks_the_pin_and_changes_nothing(): void
    {
        $this->ayesha->setPin('4820');

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4820'])
            ->assertOk()
            ->assertJsonPath('data.switched', false)
            ->assertJsonPath('data.user.name', 'Ayesha')
            // No new session: the device keeps the one it has.
            ->assertJsonMissingPath('data.access_token');
    }

    public function test_a_wrong_pin_is_refused_without_saying_why(): void
    {
        $this->ayesha->setPin('4820');

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '9999'])
            ->assertUnauthorized();
    }

    /** An id that doesn't exist must answer exactly like a wrong PIN. */
    public function test_an_unknown_user_id_is_indistinguishable_from_a_wrong_pin(): void
    {
        $this->ayesha->setPin('4820');

        $unknown = $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => \Illuminate\Support\Str::uuid()->toString(), 'pin' => '4820'])
            ->assertUnauthorized();

        $wrong = $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '0001'])
            ->assertUnauthorized();

        $this->assertSame($wrong->json('message'), $unknown->json('message'));
    }

    public function test_handing_the_till_over_issues_a_session_for_the_new_cashier(): void
    {
        $this->bilal->setPin('9174');

        $response = $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->bilal->id, 'pin' => '9174'])
            ->assertOk()
            ->assertJsonPath('data.switched', true)
            ->assertJsonPath('data.user.name', 'Bilal');

        $token = $response->json('data.access_token');
        $this->assertNotNull($token);

        $this->withRawToken($token)->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('data.name', 'Bilal');
    }

    /**
     * The point of the whole unit: after a handover the NEXT sale belongs to
     * the person who rang it.
     */
    public function test_a_sale_after_a_handover_is_stamped_with_the_new_cashier(): void
    {
        $this->bilal->setPin('9174');

        $token = $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->bilal->id, 'pin' => '9174'])
            ->assertOk()->json('data.access_token');

        $sale = $this->withRawToken($token)
            ->withHeader('X-Register-Id', $this->lane1->id)
            ->postJson('/api/v1/sales', [
                'channel' => 'pos', 'payment_method' => 'cash',
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'amount_paid' => 500,
            ])->assertCreated()->json('data');

        $this->assertSame(
            $this->bilal->id,
            Sale::withoutTenancy()->findOrFail($sale['id'])->created_by,
        );
    }

    /** A handover that left the old session alive would defeat the point. */
    public function test_the_outgoing_cashiers_session_on_this_device_is_destroyed(): void
    {
        $this->bilal->setPin('9174');
        $ayeshaToken = $this->ayesha->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($ayeshaToken)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->bilal->id, 'pin' => '9174'])
            ->assertOk();

        $this->withRawToken($ayeshaToken)->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_a_user_who_cannot_operate_a_till_cannot_take_one(): void
    {
        $clerk = User::factory()->tenantStaff($this->tenant, ['inventory.manage'])->create(['name' => 'Kamran']);
        $clerk->setPin('7351');

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $clerk->id, 'pin' => '7351'])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_A_TILL_USER');
    }

    public function test_a_suspended_cashier_cannot_take_the_till(): void
    {
        $this->bilal->setPin('9174');
        $this->bilal->forceFill(['status' => 'suspended'])->save();

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->bilal->id, 'pin' => '9174'])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'ACCOUNT_SUSPENDED');
    }

    // ── The cage around a four-digit secret ─────────────────────────

    /** Reachable only from a till that is already signed in to this shop. */
    public function test_a_pin_is_useless_without_a_session(): void
    {
        $this->ayesha->setPin('4820');
        $this->app['auth']->forgetGuards();

        $this->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4820'])
            ->assertUnauthorized();
    }

    /** And useless from another shop's till, even with a correct PIN. */
    public function test_a_pin_cannot_be_used_from_another_shops_till(): void
    {
        $this->ayesha->setPin('4820');

        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $intruder = User::factory()->tenantStaff($other, ['sales.manage'])->create();

        $this->actingAsUser($intruder)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4820'])
            ->assertUnauthorized();
    }

    public function test_a_pin_is_not_a_password_and_never_logs_anyone_in(): void
    {
        $this->ayesha->setPin('4820');
        $this->app['auth']->forgetGuards();

        $this->postJson('/api/v1/auth/login', [
            'identifier' => $this->ayesha->email,
            'password' => '4820',
        ])->assertUnauthorized();
    }

    public function test_five_wrong_pins_freeze_the_pin(): void
    {
        $this->ayesha->setPin('4820');

        for ($i = 0; $i < 5; $i++) {
            $this->actingAsUser($this->ayesha)
                ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '0009'])
                ->assertUnauthorized();
        }

        // Even the RIGHT PIN is refused now.
        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4820'])
            ->assertStatus(429)
            ->assertJsonPath('meta.error_code', 'PIN_LOCKED');
    }

    /**
     * Someone hammering a cashier's PIN at the counter must not be able to
     * lock that cashier out of the web app — the two counters are separate.
     */
    public function test_freezing_a_pin_does_not_lock_the_password_login(): void
    {
        $this->ayesha->setPin('4820');

        for ($i = 0; $i < 5; $i++) {
            $this->actingAsUser($this->ayesha)
                ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '0009']);
        }

        $fresh = $this->ayesha->fresh();
        $this->assertTrue($fresh->isPinLocked());
        $this->assertFalse($fresh->isLocked());
        $this->assertSame(0, $fresh->failed_login_attempts);

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', [
            'identifier' => $this->ayesha->email, 'password' => 'password',
        ])->assertOk();
    }

    public function test_a_correct_pin_clears_the_failure_count(): void
    {
        $this->ayesha->setPin('4820');

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '0009']);
        $this->assertSame(1, $this->ayesha->fresh()->pin_failed_attempts);

        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->ayesha->id, 'pin' => '4820'])
            ->assertOk();
        $this->assertSame(0, $this->ayesha->fresh()->pin_failed_attempts);
    }

    public function test_a_cashier_with_no_pin_cannot_be_unlocked_into(): void
    {
        $this->actingAsUser($this->ayesha)
            ->postJson('/api/v1/pos/unlock', ['user_id' => $this->bilal->id, 'pin' => '0000'])
            ->assertUnauthorized();
    }

    public function test_a_pin_can_be_removed(): void
    {
        $this->ayesha->setPin('4820');

        $this->actingAsUser($this->ayesha)->deleteJson('/api/v1/auth/till-pin')->assertOk();

        $this->assertFalse($this->ayesha->fresh()->hasPin());
    }
}
