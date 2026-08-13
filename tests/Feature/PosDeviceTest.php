<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\PosDevice;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\PlanLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * The tills a shop runs on, and the clock the offline policy reads.
 *
 * A Register is a PLACE and a PosDevice is a THING, which is why neither can
 * stand in for the other: two tablets can serve one lane, a tablet can be
 * carried between lanes, and the queue of unsent offline sales lives on the
 * tablet. "How long has this been out of contact" is therefore a device
 * question, and `last_seen_at` is the answer the whole offline policy is built
 * on.
 *
 * Nothing here sells anything yet. This is the foundation Phase 0 lays: a shop
 * can see its tills, an owner can sign a lost one out, and an admin can set how
 * many days a till may sell out of contact — assigned per shop the same way
 * branches and staff are, and never sold on a plan.
 */
class PosDeviceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function register(User $user, string $id, array $extra = []): TestResponse
    {
        return $this->actingAsUser($user)
            ->postJson('/api/v1/pos/devices', ['device_id' => $id] + $extra);
    }

    // ── Registration ────────────────────────────────────────────────

    public function test_a_till_registers_itself_and_is_seen(): void
    {
        $id = (string) Str::uuid();

        $data = $this->register($this->cashier, $id, ['name' => 'Counter tablet'])
            ->assertOk()->json('data');

        $this->assertSame($id, $data['id']);
        $this->assertSame('Counter tablet', $data['name']);
        $this->assertSame(0, $data['days_offline']);
        $this->assertFalse($data['revoked']);
        $this->assertNotNull($data['last_seen_at']);
    }

    public function test_registering_twice_touches_one_device_rather_than_making_two(): void
    {
        // The id is minted by the browser and sent unchanged forever, so a boot
        // is idempotent without a round trip to ask whether this device is
        // already known. Two rows on one tablet would double every count and
        // split its offline history in half.
        $id = (string) Str::uuid();

        $this->register($this->cashier, $id, ['name' => 'Counter tablet'])->assertOk();
        $this->register($this->cashier, $id)->assertOk();

        $this->assertSame(1, PosDevice::withoutTenancy()->where('tenant_id', $this->tenant->id)->count());
    }

    public function test_a_boot_without_a_name_does_not_blank_the_one_the_shop_typed(): void
    {
        $id = (string) Str::uuid();

        $this->register($this->cashier, $id, ['name' => 'Counter tablet'])->assertOk();
        $again = $this->register($this->cashier, $id)->assertOk()->json('data');

        $this->assertSame('Counter tablet', $again['name']);
    }

    public function test_the_touch_moves_the_clock_the_policy_reads(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        // Wind it back as though the till had been out of contact for a week.
        PosDevice::withoutTenancy()->whereKey($id)->update(['last_seen_at' => now()->subDays(7)]);
        $this->assertSame(7, PosDevice::withoutTenancy()->find($id)->daysOffline());

        // A boot is the till reporting in — the clock resets.
        $this->register($this->cashier, $id)->assertOk();
        $this->assertSame(0, PosDevice::withoutTenancy()->find($id)->daysOffline());
    }

    public function test_a_device_id_belonging_to_another_shop_is_refused(): void
    {
        $other = Tenant::factory()->create(['setup_completed' => true]);
        $id = (string) Str::uuid();
        $device = new PosDevice;
        $device->id = $id;
        $device->tenant_id = $other->id;
        $device->last_seen_at = now();
        $device->save();

        $this->register($this->cashier, $id)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'DEVICE_TAKEN');
    }

    // ── Revoking ────────────────────────────────────────────────────

    public function test_the_owner_signs_out_a_lost_till_and_it_cannot_come_back(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/pos-devices/{$id}")
            ->assertOk()
            ->assertJsonPath('data.revoked', true);

        // The tablet, wherever it is, tries to boot again.
        $this->register($this->cashier, $id)
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'DEVICE_REVOKED');
    }

    public function test_revoking_keeps_the_row_because_its_sales_still_point_at_it(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/pos-devices/{$id}")->assertOk();

        // Not a delete. An owner reading back what happened needs the row, and
        // any sale it already sent would otherwise be orphaned.
        $this->assertNotNull(PosDevice::withoutTenancy()->find($id));
    }

    public function test_a_till_that_turns_up_can_be_allowed_back(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/pos-devices/{$id}")->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/pos-devices/{$id}/restore")
            ->assertOk()
            ->assertJsonPath('data.revoked', false);

        $this->register($this->cashier, $id)->assertOk();
    }

    public function test_a_cashier_cannot_sign_a_till_out(): void
    {
        // Announcing yourself is the cashier's; deciding which tills the shop
        // allows is the owner's.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $this->actingAsUser($this->cashier)
            ->deleteJson("/api/v1/pos-devices/{$id}")
            ->assertForbidden();

        $this->actingAsUser($this->cashier)
            ->getJson('/api/v1/pos-devices')
            ->assertForbidden();
    }

    // ── The list ────────────────────────────────────────────────────

    public function test_the_list_shows_the_worst_out_of_contact_first_with_the_shops_ceiling(): void
    {
        $fresh = (string) Str::uuid();
        $stale = (string) Str::uuid();
        $this->register($this->cashier, $fresh, ['name' => 'Lane 1'])->assertOk();
        $this->register($this->cashier, $stale, ['name' => 'Back room'])->assertOk();
        PosDevice::withoutTenancy()->whereKey($stale)->update(['last_seen_at' => now()->subDays(5)]);

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/pos-devices')
            ->assertOk()->json('data');

        $this->assertSame('Back room', $data['devices'][0]['name']);
        $this->assertSame(5, $data['devices'][0]['days_offline']);
        // The ceiling travels with the list so the till knows what to degrade
        // against without a second call.
        $this->assertSame(3, $data['offline_days']);
    }

    public function test_a_till_records_the_lane_and_branch_it_was_standing_at(): void
    {
        $branch = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)
            ->where('is_default', true)->first();
        $lane = Register::query()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $branch->id,
            'name' => 'Lane 1', 'is_active' => true,
        ]);

        $id = (string) Str::uuid();
        $this->actingAsUser($this->cashier)
            ->withHeader('X-Register-Id', $lane->id)
            ->postJson('/api/v1/pos/devices', ['device_id' => $id])
            ->assertOk()
            ->assertJsonPath('data.register.name', 'Lane 1');
    }

    // ── The policy ──────────────────────────────────────────────────

    public function test_the_offline_window_defaults_to_three_days_and_the_admin_can_change_it(): void
    {
        $this->assertSame(3, PlanLimits::limit($this->tenant, 'offline_days'));

        $this->tenant->assignLimits(['offline_days' => 7]);

        $this->assertSame(7, PlanLimits::limit($this->tenant->fresh(), 'offline_days'));
    }

    public function test_the_shop_cannot_raise_its_own_offline_window(): void
    {
        // Settings are written through $request->validated(), which is an
        // allow-list — a key absent from ShopSettings::rules() cannot be
        // written by the shop. How long a till may sell out of contact is the
        // admin's call, not the shop's.
        $this->actingAsUser($this->owner)
            ->putJson('/api/v1/shop/settings', ['offline_days' => 365])
            ->assertOk();

        $this->assertSame(3, PlanLimits::limit($this->tenant->fresh(), 'offline_days'));
    }

    public function test_usage_reports_the_worst_till_currently_out_of_contact(): void
    {
        $this->assertSame(0, PlanLimits::usage($this->tenant, 'offline_days'));

        $a = (string) Str::uuid();
        $b = (string) Str::uuid();
        $this->register($this->cashier, $a)->assertOk();
        $this->register($this->cashier, $b)->assertOk();
        PosDevice::withoutTenancy()->whereKey($a)->update(['last_seen_at' => now()->subDays(2)]);
        PosDevice::withoutTenancy()->whereKey($b)->update(['last_seen_at' => now()->subDays(6)]);

        $this->assertSame(6, PlanLimits::usage($this->tenant, 'offline_days'));
    }

    public function test_a_till_signed_out_is_no_longer_an_outstanding_one(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();
        PosDevice::withoutTenancy()->whereKey($id)->update(['last_seen_at' => now()->subDays(9)]);
        $this->assertSame(9, PlanLimits::usage($this->tenant, 'offline_days'));

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/pos-devices/{$id}")->assertOk();

        // A tablet stopped on purpose is not a tablet still out there.
        $this->assertSame(0, PlanLimits::usage($this->tenant->fresh(), 'offline_days'));
    }

    public function test_the_window_can_be_tightened_while_a_till_is_already_past_it(): void
    {
        // Every OTHER limit refuses a ceiling below live usage, because cutting
        // a 800-product shop to 100 blocks every new product silently. A policy
        // is the opposite case: tightening the window while a tablet is six
        // days out is precisely what an owner does when one goes missing, and
        // refusing it would refuse the remedy.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();
        PosDevice::withoutTenancy()->whereKey($id)->update(['last_seen_at' => now()->subDays(6)]);

        $admin = User::factory()->superAdmin()->create();
        $this->actingAsUser($admin)
            ->putJson("/api/v1/admin/tenants/{$this->tenant->id}/limits", [
                'mode' => 'set',
                'limits' => ['offline_days' => 1],
            ])
            ->assertOk();

        $this->assertSame(1, PlanLimits::limit($this->tenant->fresh(), 'offline_days'));
    }

    public function test_a_countable_limit_still_refuses_to_land_below_what_the_shop_holds(): void
    {
        // The guard the test above steps around must still be in force for
        // everything it was written for.
        Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Second', 'is_default' => false,
        ]);

        $admin = User::factory()->superAdmin()->create();
        $this->actingAsUser($admin)
            ->putJson("/api/v1/admin/tenants/{$this->tenant->id}/limits", [
                'mode' => 'set',
                'limits' => ['branches' => 1],
            ])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_BELOW_USAGE');
    }
}
