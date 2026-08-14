<?php

namespace Tests\Feature;

use App\Models\PosDevice;
use App\Models\PricingVariance;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Where a till reports that it priced a cart differently from the server.
 *
 * The number this exercise turns on is the COUNT. An empty table over a
 * fortnight of real trading is what earns offline selling its place, so the
 * count has to be honest in both directions: it must not miss a finding, and it
 * must not climb on its own when a device re-sends a queue it never got an
 * acknowledgement for.
 */
class PricingVarianceTest extends TestCase
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

    private function variance(array $over = []): array
    {
        return array_merge([
            'sale_id' => (string) Str::uuid(),
            'at' => now()->toIso8601String(),
            'server' => ['subtotal' => 100, 'discount' => 0, 'tax' => 17, 'total' => 117],
            'local' => ['subtotal' => 100, 'discount' => 0, 'tax' => 17.01, 'total' => 117.01],
            'differences' => [['field' => 'tax', 'server' => 17, 'local' => 17.01, 'by' => 0.01]],
            'cart' => ['settings' => ['tax_inclusive' => false], 'lines' => [['price' => 100]]],
        ], $over);
    }

    private function report(array $variances, ?string $deviceId = null): TestResponse
    {
        return $this->actingAsUser($this->cashier)->postJson('/api/v1/pos/pricing-variances', [
            'variances' => $variances,
        ] + ($deviceId === null ? [] : ['device_id' => $deviceId]));
    }

    // ── Receiving ───────────────────────────────────────────────────

    public function test_a_till_reports_a_disagreement(): void
    {
        $this->report([$this->variance()])->assertOk()->assertJsonPath('data.stored', 1);

        $row = PricingVariance::withoutTenancy()->first();
        $this->assertSame(17.01, $row->local_totals['tax']);
        $this->assertSame('tax', $row->differences[0]['field']);
        // A variance nobody can reproduce is a variance nobody can fix.
        $this->assertSame(100, $row->cart['lines'][0]['price']);
    }

    public function test_the_same_cart_reported_twice_is_counted_once(): void
    {
        // A device that loses the acknowledgement re-sends its queue. Without
        // this the count — the whole point — would climb on its own and offline
        // selling would look worse than it is.
        $variance = $this->variance();

        $this->report([$variance])->assertOk();
        $this->report([$variance])->assertOk();

        $this->assertSame(1, PricingVariance::withoutTenancy()->count());
    }

    public function test_a_re_report_carries_the_newer_detail(): void
    {
        $variance = $this->variance();
        $this->report([$variance])->assertOk();

        $variance['local']['total'] = 999;
        $this->report([$variance])->assertOk();

        $this->assertSame(999, PricingVariance::withoutTenancy()->first()->local_totals['total']);
    }

    public function test_a_batch_lands_as_a_batch(): void
    {
        $this->report([$this->variance(), $this->variance(), $this->variance()])
            ->assertOk()->assertJsonPath('data.stored', 3);

        $this->assertSame(3, PricingVariance::withoutTenancy()->count());
    }

    public function test_it_records_which_till_found_it(): void
    {
        // A disagreement on one device and not another is a stale catalog; on
        // every device it is the engine. Attribution is what tells them apart.
        $id = (string) Str::uuid();
        $this->actingAsUser($this->cashier)
            ->postJson('/api/v1/pos/devices', ['device_id' => $id, 'name' => 'Lane 1'])
            ->assertOk();

        $this->report([$this->variance()], $id)->assertOk();

        $this->assertSame($id, PricingVariance::withoutTenancy()->first()->device_id);
    }

    public function test_an_unknown_device_costs_the_attribution_and_not_the_finding(): void
    {
        // Losing a real finding over a bad device id would be the wrong trade.
        $this->report([$this->variance()], (string) Str::uuid())->assertOk();

        $row = PricingVariance::withoutTenancy()->first();
        $this->assertNotNull($row);
        $this->assertNull($row->device_id);
    }

    public function test_a_report_with_no_differences_is_refused(): void
    {
        // "We agreed" is not a variance. Accepting it would inflate the one
        // number this exercise reads.
        $this->report([$this->variance(['differences' => []])])->assertStatus(422);
    }

    public function test_an_absurd_batch_is_refused(): void
    {
        $this->report(array_map(fn () => $this->variance(), range(1, 101)))->assertStatus(422);
    }

    // ── Reading ─────────────────────────────────────────────────────

    public function test_the_owner_reads_the_count_and_the_newest_few(): void
    {
        $this->report([$this->variance(), $this->variance()])->assertOk();

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data');

        $this->assertSame(2, $data['total']);
        $this->assertCount(2, $data['variances']);
    }

    public function test_an_empty_list_is_the_answer_we_are_hoping_for(): void
    {
        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data');

        $this->assertSame(0, $data['total']);
        $this->assertSame([], $data['variances']);
    }

    public function test_newest_first(): void
    {
        $this->report([$this->variance(['at' => now()->subDays(2)->toIso8601String()])])->assertOk();
        $this->report([$this->variance(['at' => now()->toIso8601String()])])->assertOk();

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.variances');

        $this->assertTrue($data[0]['found_at'] > $data[1]['found_at']);
    }

    public function test_a_cashier_may_report_but_not_read_the_pile(): void
    {
        // Announcing is the till's; reading what the shop's engine is doing is
        // the owner's.
        $this->report([$this->variance()])->assertOk();

        $this->actingAsUser($this->cashier)->getJson('/api/v1/pricing-variances')->assertForbidden();
    }

    // ── The denominator ─────────────────────────────────────────────
    //
    // An empty list is produced identically by "the engine agreed on 1,284 real
    // carts" and "no till ever checked anything", and the second is both the
    // dangerous one and the quieter one. These are the numbers that separate
    // them, so an empty list can be read as evidence rather than as silence.

    private function till(array $shadow, bool $revoked = false): PosDevice
    {
        return PosDevice::withoutTenancy()->create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'last_seen_at' => now(),
            'revoked_at' => $revoked ? now() : null,
        ] + $shadow);
    }

    public function test_it_reports_how_many_carts_were_actually_checked(): void
    {
        $this->till(['shadow_checked' => 900, 'shadow_matched' => 890, 'shadow_skipped' => 10]);
        $this->till(['shadow_checked' => 384, 'shadow_matched' => 384]);

        $checks = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks');

        $this->assertSame(1284, $checks['checked']);
        $this->assertSame(1274, $checks['matched']);
        $this->assertSame(10, $checks['skipped']);
    }

    public function test_a_shop_that_has_checked_nothing_says_zero_rather_than_looking_clean(): void
    {
        // The whole point. Without this, a shop where the engine never ran once
        // is indistinguishable from one where it ran perfectly.
        $this->till(['shadow_checked' => 0]);

        $checks = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks');

        $this->assertSame(0, $checks['checked']);
        $this->assertSame(1, $checks['tills']);
        $this->assertSame(0, $checks['reporting']);
    }

    public function test_it_says_how_many_tills_are_actually_reporting(): void
    {
        // Four tills and one of them exercised is not a fleet that has been
        // tested, however large the count on that one till gets.
        $this->till(['shadow_checked' => 1284]);
        $this->till(['shadow_checked' => 0]);
        $this->till(['shadow_checked' => 0]);

        $checks = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks');

        $this->assertSame(3, $checks['tills']);
        $this->assertSame(1, $checks['reporting']);
    }

    public function test_the_window_is_the_newest_start_and_not_the_luckiest(): void
    {
        // A till wiped yesterday contributes a day beside another's three
        // weeks. The only date every till in the sum has been counting since is
        // the latest reset; taking the oldest would print "three weeks of
        // evidence" over a fleet that has one day of it.
        $old = now()->subWeeks(3);
        $recent = now()->subDay();
        $this->till(['shadow_checked' => 900, 'shadow_since' => $old]);
        $this->till(['shadow_checked' => 12, 'shadow_since' => $recent]);

        $since = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks.since');

        $this->assertSame($recent->toIso8601String(), $since);
    }

    public function test_a_signed_out_till_does_not_vouch_for_a_fleet_it_left(): void
    {
        // Its checks did happen. The question being asked is whether the
        // WORKING fleet has been exercised, and a tablet in a drawer cannot
        // answer it.
        $this->till(['shadow_checked' => 5000, 'shadow_matched' => 5000], revoked: true);

        $checks = $this->actingAsUser($this->owner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks');

        $this->assertSame(0, $checks['checked']);
        $this->assertSame(0, $checks['tills']);
    }

    public function test_one_shops_checks_are_not_anothers(): void
    {
        $other = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $otherOwner = User::factory()->shopOwner($other)->create();
        $this->till(['shadow_checked' => 1284]);

        $checks = $this->actingAsUser($otherOwner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data.checks');

        $this->assertSame(0, $checks['checked']);
    }

    public function test_one_shops_findings_are_not_anothers(): void
    {
        $other = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $otherOwner = User::factory()->shopOwner($other)->create();
        $this->report([$this->variance()])->assertOk();

        $data = $this->actingAsUser($otherOwner)->getJson('/api/v1/pricing-variances')
            ->assertOk()->json('data');

        $this->assertSame(0, $data['total']);
    }
}
