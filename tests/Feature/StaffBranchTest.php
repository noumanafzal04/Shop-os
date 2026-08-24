<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHICH BRANCH DOES THIS PERSON WORK AT?
 *
 * `ResolveBranch` pins staff to `users.branch_id`: a header can never move them,
 * their reads are that one branch, and their sales draw down that branch's
 * stock. The whole model is driven by that column — and the panel never once
 * set it, so every staff member in every multi-branch shop fell back to Main and
 * branch two's cashier rang on branch one's shelf.
 *
 * The server half was already built. These pin the parts a panel depends on and
 * nothing was asserting: that the column round-trips through BOTH doors, that a
 * staff row carries it back, and that it cannot be pointed at another shop's
 * branch — which is the one way this field could do real damage.
 */
class StaffBranchTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $second;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Saddar', 'is_active' => true,
        ]);
    }

    private function login(?User $user = null): static
    {
        $token = ($user ?? $this->owner)->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_a_staff_member_can_be_hired_into_a_branch(): void
    {
        $res = $this->login()->postJson('/api/v1/staff', [
            'name' => 'Saddar Cashier',
            'email' => 'saddar@shop.test',
            'password' => 'password123',
            'branch_id' => $this->second->id,
            'permissions' => ['sales.manage'],
        ])->assertCreated();

        $this->assertSame($this->second->id, $res->json('data.branch_id'),
            'the row does not carry the branch back, so no screen could show it');
        $this->assertSame($this->second->id, User::query()->find($res->json('data.id'))->branch_id);
    }

    public function test_a_staff_member_can_be_moved_to_another_branch(): void
    {
        // The half with no writer of its own: UpdateStaffAction fills the model,
        // so this passes only while `branch_id` stays fillable. It has been
        // silently droppable for the whole life of the field.
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();

        $this->login()->putJson("/api/v1/staff/{$staff->id}", [
            'name' => $staff->name,
            'branch_id' => $this->second->id,
            'permissions' => ['sales.manage'],
        ])->assertOk();

        $this->assertSame($this->second->id, $staff->fresh()->branch_id);
    }

    public function test_a_pin_can_be_cleared_back_to_main(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])
            ->create(['branch_id' => $this->second->id]);

        $this->login()->putJson("/api/v1/staff/{$staff->id}", [
            'name' => $staff->name,
            'branch_id' => null,
            'permissions' => ['sales.manage'],
        ])->assertOk();

        $this->assertNull($staff->fresh()->branch_id,
            'null is how a shop says "no pin" — the server reads it as Main');
    }

    public function test_a_staff_member_cannot_be_pinned_to_another_shop_s_branch(): void
    {
        // The one way this field could do real harm: a person reading and
        // writing a branch that is not their employer's.
        $elsewhere = Tenant::factory()->provisioned()->create();
        $theirs = Branch::withoutTenancy()->create([
            'tenant_id' => $elsewhere->id, 'name' => 'Not Ours', 'is_active' => true,
        ]);

        $this->login()->postJson('/api/v1/staff', [
            'name' => 'Trespasser',
            'email' => 'nope@shop.test',
            'password' => 'password123',
            'branch_id' => $theirs->id,
            'permissions' => ['sales.manage'],
        ])->assertStatus(422);
    }

    public function test_a_staff_member_can_read_their_own_branch(): void
    {
        // What the header label depends on. It is on /auth/me or the panel has
        // no way to tell somebody where they are standing.
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])
            ->create(['branch_id' => $this->second->id]);

        $res = $this->login($staff)->getJson('/api/v1/auth/me')->assertOk();

        $this->assertSame($this->second->id, $res->json('data.branch_id'));
    }

    public function test_an_owner_is_pinned_to_nothing(): void
    {
        // An owner switches; a null here is what makes the HQ view possible.
        $res = $this->login()->getJson('/api/v1/auth/me')->assertOk();

        $this->assertNull($res->json('data.branch_id'));
    }
}
