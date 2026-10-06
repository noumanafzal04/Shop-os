<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Coupon;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * THE PLATFORM'S TRAIL SAYS WHICH SHOP.
 *
 * Found by the QA journey, stage F. The admin suspended a business and then
 * opened the audit log to see it recorded. The row read:
 *
 *     Super Admin   updated   Tenant   status: active → suspended
 *
 * and nothing else. On a platform of shops that is a record that SOMETHING
 * was suspended. Above it, three rows of "System updated User —
 * last_login_at": people arriving at work.
 */
class TheTrailNamesTheShopTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    private Tenant $mart;

    private Tenant $pharmacy;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->admin = User::factory()->superAdmin()->create();
        $shop = fn (string $name) => Tenant::factory()->create([
            'business_name' => $name, 'setup_completed' => true, 'business_type' => 'mart',
            'features' => array_merge(BusinessTypes::defaultFeatures('mart'), ['promotions' => true]),
        ]);
        $this->mart = $shop('Gulberg Mart');
        $this->pharmacy = $shop('Model Town Pharmacy');
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return Collection<int, array<string, mixed>> */
    private function trail(string $query = ''): Collection
    {
        return collect($this->as($this->admin)->getJson("/api/v1/admin/audit-logs?per_page=100{$query}")
            ->assertOk()->json('data'));
    }

    public function test_a_suspension_names_the_shop_that_was_suspended(): void
    {
        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$this->mart->id}/suspend")->assertOk();

        $row = $this->trail()->first(fn (array $r) => ($r['new_values']['status'] ?? null) === 'suspended');

        $this->assertNotNull($row, 'the suspension is not on the trail at all');
        $this->assertSame('Tenant', $row['entity']);
        $this->assertSame('Gulberg Mart', $row['business']);
    }

    public function test_something_done_inside_a_shop_names_that_shop(): void
    {
        // The same act in two shops. A trail that named neither would show
        // two identical rows; one that named the wrong one would be worse.
        foreach ([[$this->mart, 'MART10'], [$this->pharmacy, 'PHARM10']] as [$shop, $code]) {
            $owner = User::factory()->shopOwner($shop)->create();
            $this->as($owner)->postJson('/api/v1/coupons', ['code' => $code, 'type' => 'percent', 'value' => 10])
                ->assertCreated();
        }
        $this->assertSame(2, Coupon::withoutTenancy()->count());

        $coupons = $this->trail('&type=Coupon')->keyBy(fn (array $r) => $r['new_values']['code']);

        $this->assertSame('Gulberg Mart', $coupons['MART10']['business']);
        $this->assertSame('Model Town Pharmacy', $coupons['PHARM10']['business']);
    }

    public function test_the_trail_is_searched_by_the_shops_name(): void
    {
        // The coupon first: a suspended shop, quite rightly, cannot make one.
        $owner = User::factory()->shopOwner($this->mart)->create();
        $this->as($owner)->postJson('/api/v1/coupons', ['code' => 'MART10', 'type' => 'percent', 'value' => 10])
            ->assertCreated();
        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$this->mart->id}/suspend")->assertOk();
        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$this->pharmacy->id}/suspend")->assertOk();

        $found = $this->trail('&search=Gulberg');

        // What was done TO the shop, and what was done IN it…
        $this->assertTrue($found->contains(fn (array $r) => ($r['new_values']['status'] ?? null) === 'suspended'));
        $this->assertTrue($found->contains(fn (array $r) => $r['entity'] === 'Coupon'));
        // …and nothing about the other one.
        $this->assertSame(['Gulberg Mart'], $found->pluck('business')->unique()->values()->all());

        // A person is still found by their name.
        $this->assertTrue($this->trail('&search='.urlencode($owner->name))->contains(fn (array $r) => $r['entity'] === 'Coupon'));
    }

    public function test_a_deleted_shop_still_has_its_name_on_the_trail(): void
    {
        $this->as($this->admin)->deleteJson("/api/v1/admin/tenants/{$this->mart->id}")->assertOk();

        $row = $this->trail()->first(fn (array $r) => $r['entity'] === 'Tenant' && $r['entity_id'] === $this->mart->id);

        $this->assertNotNull($row);
        $this->assertSame('Gulberg Mart', $row['business']);
    }

    public function test_signing_in_is_not_a_change_anybody_made(): void
    {
        $owner = User::factory()->shopOwner($this->mart)->create(['email' => 'owner@gulberg.test', 'password' => 'Correct-horse-1']);
        $before = AuditLog::query()->count();

        $this->postJson('/api/v1/auth/login', ['identifier' => 'owner@gulberg.test', 'password' => 'Correct-horse-1'])
            ->assertOk();

        // THE DENOMINATOR: the sign-in happened and did stamp the user.
        $this->assertNotNull($owner->fresh()->last_login_at);
        $this->assertSame($before, AuditLog::query()->count(), 'a sign-in wrote to the audit trail');
    }

    public function test_a_real_change_to_a_person_is_still_recorded(): void
    {
        $owner = User::factory()->shopOwner($this->mart)->create();
        $before = AuditLog::query()->count();

        // Quiet alone, loud in company: a login stamp beside a real change
        // does not hide the change.
        $owner->forceFill(['name' => 'Renamed Owner', 'last_login_at' => now()])->save();

        $this->assertSame($before + 1, AuditLog::query()->count());
        $this->assertSame('Renamed Owner', AuditLog::query()->latest('created_at')->orderByDesc('id')->first()->new_values['name']);
    }

    public function test_a_module_change_is_recorded_as_a_map_on_both_sides(): void
    {
        // It was a map before the arrow and a quoted JSON string after it,
        // so nothing could say WHICH module moved without parsing half a row.
        $features = array_merge($this->mart->features, ['promotions' => false]);
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$this->mart->id}/modules", ['modules' => $features])
            ->assertOk();

        // The UPDATE. The shop's creation carries a module map too, and has
        // nothing before it to compare with.
        $row = $this->trail('&type=Tenant&event=updated')->first(fn (array $r) => isset($r['new_values']['features']));

        $this->assertNotNull($row, 'the module change is not on the trail');
        $this->assertIsArray($row['old_values']['features']);
        $this->assertIsArray($row['new_values']['features']);
        $this->assertTrue($row['old_values']['features']['promotions']);
        $this->assertFalse($row['new_values']['features']['promotions']);
        $this->assertSame('Gulberg Mart', $row['business']);

        // And the row that created the shop holds a map as well, not a string.
        $created = $this->trail('&type=Tenant&event=created')->first(fn (array $r) => $r['entity_id'] === $this->mart->id);
        $this->assertIsArray($created['new_values']['features']);
    }
}
