<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WarrantyClaim;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Somebody brought it back.
 *
 * The desk could already answer "is this still covered?" — and then had nowhere
 * to put the answer. A customer walks in with a battery, the counter confirms
 * four months left, and the shop's whole record of it is what one person
 * remembers. The second visit starts from nothing, a repeat failure looks like
 * a first one, and there is no way to tell a supplier how many units came back.
 *
 * A claim is deliberately NOT a return: no money moves, no stock moves, and the
 * unit is usually gone to a service centre for days. Modelling it as a sale
 * return would have put a refund on the till that never happened.
 */
class WarrantyClaimTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'automotive',
            'features' => BusinessTypes::defaultFeatures('automotive'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        // A battery: the most-claimed warranty item on a Pakistani forecourt.
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Osaka 12V Battery', 'price' => 18000, 'stock_quantity' => 10,
            'track_inventory' => true, 'tracks_serial' => true, 'warranty_months' => 12,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sellOne(string $serial): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 18000,
            'customer_name' => 'Bilal', 'customer_phone' => '03001234567',
            'items' => [[
                'product_id' => $this->product->id, 'quantity' => 1, 'serials' => [$serial],
            ]],
        ])->assertCreated();
    }

    public function test_a_unit_can_be_booked_in_and_carries_the_sale_it_came_from(): void
    {
        $this->sellOne('OSK-99001');

        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99001',
            'fault' => 'Not holding charge overnight',
        ])->assertCreated()->json('data');

        $this->assertSame('Osaka 12V Battery', $claim['product_name']);
        $this->assertTrue($claim['was_under_warranty']);
        // Pulled off the sale rather than retyped at the counter.
        $this->assertSame('Bilal', $claim['customer_name']);
        $this->assertSame('03001234567', $claim['customer_phone']);
        $this->assertNull($claim['resolution'], 'a fresh claim is open');
    }

    /**
     * Whether it was covered is decided on the DAY IT CAME IN and frozen. The
     * window will have closed by the time a supplier replies, and a decision
     * made in good faith must not read as a mistake three weeks later.
     */
    public function test_the_warranty_verdict_is_snapshotted_not_recomputed(): void
    {
        $this->sellOne('OSK-99002');

        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99002', 'fault' => 'Swollen casing',
        ])->assertCreated()->json('data');

        $this->assertTrue($claim['was_under_warranty']);

        // Two years pass. The claim still says what was true when it was taken.
        $this->travel(2)->years();

        $stored = WarrantyClaim::withoutTenancy()->findOrFail($claim['id']);
        $this->assertTrue($stored->was_under_warranty);
    }

    /** An out-of-warranty unit is still recorded — the shop is holding it. */
    public function test_a_unit_past_its_window_can_still_be_booked_in(): void
    {
        $this->sellOne('OSK-99003');
        $this->travel(2)->years();

        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99003', 'fault' => 'Dead',
        ])->assertCreated()->json('data');

        $this->assertFalse($claim['was_under_warranty']);
    }

    /**
     * A serial the shop never sold — a receipt from the other branch, or a unit
     * that predates the system. Refusing would just mean the shop keeps the
     * customer's property with no record at all.
     */
    public function test_an_unknown_serial_can_still_be_taken_in(): void
    {
        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'FROM-OTHER-BRANCH', 'fault' => 'Leaking',
            'customer_name' => 'Walk-in', 'customer_phone' => '03119876543',
        ])->assertCreated()->json('data');

        $this->assertSame('Unknown item', $claim['product_name']);
        $this->assertFalse($claim['was_under_warranty']);
        $this->assertSame('Walk-in', $claim['customer_name']);
    }

    public function test_the_same_unit_cannot_be_booked_in_twice_while_still_open(): void
    {
        $this->sellOne('OSK-99004');

        $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99004', 'fault' => 'Weak crank',
        ])->assertCreated();

        $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99004', 'fault' => 'Weak crank',
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'CLAIM_ALREADY_OPEN');
    }

    public function test_a_claim_is_closed_once_and_records_who_closed_it(): void
    {
        $this->sellOne('OSK-99005');
        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99005', 'fault' => 'Not charging',
        ])->assertCreated()->json('data');

        $closed = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/warranty/claims/{$claim['id']}/resolve", [
                'resolution' => 'replaced', 'note' => 'Swapped under Osaka warranty',
            ])->assertOk()->json('data');

        $this->assertSame('replaced', $closed['resolution']);
        $this->assertNotNull($closed['resolved_at']);
        $this->assertSame($this->owner->id, $closed['resolved_by']);

        // A claim whose history can be rewritten after the customer was told
        // is not a record of anything.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/warranty/claims/{$claim['id']}/resolve", ['resolution' => 'rejected'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'CLAIM_ALREADY_RESOLVED');
    }

    /** Rejection is a real outcome — the shop's defence the second time. */
    public function test_a_claim_can_be_rejected(): void
    {
        $this->sellOne('OSK-99006');
        $claim = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99006', 'fault' => 'Cracked case',
        ])->assertCreated()->json('data');

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/warranty/claims/{$claim['id']}/resolve", [
                'resolution' => 'rejected', 'note' => 'Impact damage, not a fault',
            ])->assertOk()->assertJsonPath('data.resolution', 'rejected');
    }

    /** "Didn't we replace this already?" is not a filing system. */
    public function test_the_lookup_shows_what_this_unit_has_been_back_for_before(): void
    {
        $this->sellOne('OSK-99007');

        $first = $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
            'serial' => 'OSK-99007', 'fault' => 'Weak crank',
        ])->assertCreated()->json('data');
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/warranty/claims/{$first['id']}/resolve", ['resolution' => 'repaired']);

        $lookup = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/warranty/lookup?serial=OSK-99007')->assertOk()->json('data');

        $this->assertCount(1, $lookup['claims']);
        $this->assertSame('repaired', $lookup['claims'][0]['resolution']);
    }

    /** The counter's real question: what are we still holding? */
    public function test_the_list_shows_open_claims_first_and_oldest_first(): void
    {
        foreach (['OSK-1', 'OSK-2', 'OSK-3'] as $s) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/warranty/claims', [
                'serial' => $s, 'fault' => 'Fault',
            ])->assertCreated();
        }

        $second = WarrantyClaim::withoutTenancy()->where('serial', 'OSK-2')->firstOrFail();
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/warranty/claims/{$second->id}/resolve", ['resolution' => 'refunded']);

        $open = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/warranty/claims')->assertOk()->json('data');

        $this->assertSame(['OSK-1', 'OSK-3'], array_column($open, 'serial'));

        $all = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/warranty/claims?status=all')->assertOk()->json('data');
        $this->assertCount(3, $all);
        $this->assertNull($all[0]['resolution'], 'still-open units sort above closed ones');
    }

    public function test_the_desk_rides_the_inventory_module(): void
    {
        $this->tenant->forceFill([
            'features' => array_merge(BusinessTypes::defaultFeatures('automotive'), ['inventory' => false]),
        ])->save();

        $this->actingAsUser($this->owner)->getJson('/api/v1/warranty/claims')
            ->assertForbidden()->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }
}
