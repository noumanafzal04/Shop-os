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
use PHPUnit\Framework\Attributes\DataProvider;
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

    /**
     * ── WHICH TILL, ALLOCATED RATHER THAN GUESSED ───────────────────────
     *
     * The offline slip is `OFF-<lane>-<device>-<counter>`, and that device part
     * was the first four characters of the random id the browser minted for
     * itself — with nothing anywhere checking whether another till already had
     * them. Four characters is 65,536 values: a shop running fifty tills had
     * roughly a one-in-fifty chance that two shared a segment, and from their
     * first sale each they printed identical slip numbers for different
     * customers. The second was then refused by the shop's own unique index and
     * could never be sent.
     *
     * A hash where an allocation belongs. The server is the only thing that can
     * see every till at once.
     */
    public function test_a_till_is_given_a_code_no_other_till_in_the_shop_has(): void
    {
        $first = $this->register($this->cashier, (string) Str::uuid())->assertOk()->json('data.code');
        $second = $this->register($this->cashier, (string) Str::uuid())->assertOk()->json('data.code');

        $this->assertNotNull($first, 'the till was registered without a code to print');
        $this->assertSame(4, strlen($first), 'the slip has room for four characters');
        $this->assertNotSame($first, $second, 'two tills in one shop were given the same code');
    }

    public function test_a_tills_code_never_changes_under_it(): void
    {
        // It is printed on customers' slips. A till that took a new code on its
        // next boot would leave the shop with two runs of numbers for one
        // device and no way to tell which counter a slip came from.
        $id = Str::uuid()->toString();

        $first = $this->register($this->cashier, $id)->assertOk()->json('data.code');
        $again = $this->register($this->cashier, $id)->assertOk()->json('data.code');

        // Both null would satisfy `assertSame` and prove nothing — the first
        // version of this test passed with the allocation deleted.
        $this->assertNotNull($first, 'the till was never given a code to keep');
        $this->assertSame($first, $again);
    }

    public function test_a_code_avoids_the_characters_people_misread_off_a_receipt(): void
    {
        // Somebody rings up about a refund and reads the slip down the phone.
        // O against 0 and I against 1 is where that goes wrong.
        $code = $this->register($this->cashier, (string) Str::uuid())->assertOk()->json('data.code');

        $this->assertDoesNotMatchRegularExpression('/[O01IS5]/', $code);
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

    // ── The shadow tally ────────────────────────────────────────────
    //
    // What a till has DONE with the offline engine, as opposed to what it
    // found. Zero disagreements is the answer we want and also the answer a
    // shop gets when no till ever checked anything — this is the number that
    // tells those two apart, so it has to be honest in both directions.

    private function tally(array $over = []): array
    {
        return ['shadow' => array_merge([
            'checked' => 120,
            'matched' => 118,
            'skipped' => 2,
            'differed' => 0,
            'since' => now()->subWeek()->toIso8601String(),
        ], $over)];
    }

    public function test_a_till_reports_what_it_has_checked(): void
    {
        $id = (string) Str::uuid();

        $this->register($this->cashier, $id, $this->tally())->assertOk();

        $device = PosDevice::withoutTenancy()->find($id);
        $this->assertSame(120, $device->shadow_checked);
        $this->assertSame(118, $device->shadow_matched);
        $this->assertSame(2, $device->shadow_skipped);
        $this->assertNotNull($device->shadow_since);
    }

    public function test_a_re_sent_boot_does_not_inflate_the_tally(): void
    {
        // The reason totals are STORED rather than added to. A boot whose
        // acknowledgement was lost is simply sent again, and an increment would
        // climb on its own — inflating the exact number the offline decision
        // turns on.
        $id = (string) Str::uuid();
        $tally = $this->tally();

        $this->register($this->cashier, $id, $tally)->assertOk();
        $this->register($this->cashier, $id, $tally)->assertOk();

        $this->assertSame(120, PosDevice::withoutTenancy()->find($id)->shadow_checked);
    }

    public function test_a_wiped_till_is_allowed_to_count_down(): void
    {
        // Local storage cleared: the till genuinely has no evidence any more,
        // and a monotonic guard would freeze a stale high number in place and
        // authorise offline selling on evidence nothing can still produce.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id, $this->tally())->assertOk();

        $this->register($this->cashier, $id, $this->tally([
            'checked' => 3, 'matched' => 3, 'skipped' => 0,
            'since' => now()->toIso8601String(),
        ]))->assertOk();

        $this->assertSame(3, PosDevice::withoutTenancy()->find($id)->shadow_checked);
    }

    public function test_a_till_that_sends_no_tally_keeps_the_one_it_had(): void
    {
        // An older build has none to send, and a routine boot must not blank
        // what a working till already reported — the same rule the name follows.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id, $this->tally())->assertOk();

        $this->register($this->cashier, $id, ['name' => 'Counter tablet'])->assertOk();

        $this->assertSame(120, PosDevice::withoutTenancy()->find($id)->shadow_checked);
    }

    public function test_a_till_on_an_older_build_still_boots(): void
    {
        // The tally is diagnostics. A device must never fail to register — and
        // so never be able to sell — because it cannot describe itself fully.
        $this->register($this->cashier, (string) Str::uuid())->assertOk();
    }

    #[DataProvider('tallyFields')]
    public function test_half_a_tally_is_refused(string $missing): void
    {
        // A tally missing any one of its parts is not a partial number, it is a
        // meaningless one — matched with no `checked` has no denominator, and a
        // count with no `since` has no window.
        //
        // Each field is dropped ON ITS OWN. Dropping several at once passes
        // whichever rule happens to fire first and would leave the other four
        // unguarded while still reading green.
        $tally = $this->tally()['shadow'];
        unset($tally[$missing]);

        $this->register($this->cashier, (string) Str::uuid(), ['shadow' => $tally])
            ->assertStatus(422);
    }

    public static function tallyFields(): array
    {
        return [
            'checked' => ['checked'],
            'matched' => ['matched'],
            'skipped' => ['skipped'],
            'differed' => ['differed'],
            'since' => ['since'],
        ];
    }

    public function test_a_negative_tally_is_refused(): void
    {
        $this->register($this->cashier, (string) Str::uuid(), $this->tally(['checked' => -1]))
            ->assertStatus(422);
    }

    // ── Naming a till ───────────────────────────────────────────────
    //
    // Not a cosmetic feature. The offline report names the till against every
    // late sale, because a fault on ONE tablet is a different problem from a
    // fault in the shop — and three tills all reading "Unnamed till" make that
    // column say nothing at all.

    private function rename(User $user, string $id, mixed $name): TestResponse
    {
        return $this->actingAsUser($user)->patchJson("/api/v1/pos-devices/{$id}", ['name' => $name]);
    }

    public function test_an_owner_can_name_a_till(): void
    {
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $this->rename($this->owner, $id, 'Lane 2')->assertOk();

        $this->assertSame('Lane 2', PosDevice::withoutTenancy()->find($id)->name);
    }

    public function test_naming_a_till_does_no_t_say_it_just_reached_us(): void
    {
        // The whole reason this is not `register` with a name on it. An owner
        // labelling a tablet that has been switched off for a week would
        // otherwise write "reached us just now" onto exactly the device whose
        // silence the roster exists to show — corrupting the one column the
        // offline policy reads.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $silentSince = now()->subDays(7);
        PosDevice::withoutTenancy()->whereKey($id)->update(['last_seen_at' => $silentSince]);

        $this->rename($this->owner, $id, 'The one in the back')->assertOk();

        $this->assertSame(
            $silentSince->toDateTimeString(),
            PosDevice::withoutTenancy()->find($id)->last_seen_at->toDateTimeString(),
        );
    }

    public function test_an_empty_name_is_refused_rather_than_wiping_the_one_there(): void
    {
        // Registration's rule is `sometimes|nullable` so a routine boot cannot
        // blank a name somebody typed. Here a name is what was ASKED for, and
        // an empty one is a mistake — not a way back to "Unnamed till".
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id, ['name' => 'Counter tablet'])->assertOk();

        $this->rename($this->owner, $id, '')->assertStatus(422);

        $this->assertSame('Counter tablet', PosDevice::withoutTenancy()->find($id)->name);
    }

    public function test_a_cashier_cannot_rename_a_till(): void
    {
        // Same permission as the rest of this screen: naming the shop's
        // hardware is configuration, not counter work.
        $id = (string) Str::uuid();
        $this->register($this->cashier, $id)->assertOk();

        $this->rename($this->cashier, $id, 'Mine now')->assertForbidden();
    }

    public function test_a_till_belonging_to_another_shop_cannot_be_renamed(): void
    {
        $other = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $theirCashier = User::factory()->tenantStaff($other, ['sales.manage'])->create();
        $id = (string) Str::uuid();
        $this->register($theirCashier, $id, ['name' => 'Theirs'])->assertOk();

        $this->rename($this->owner, $id, 'Ours')->assertNotFound();

        $this->assertSame('Theirs', PosDevice::withoutTenancy()->find($id)->name);
    }
}
