<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch Phase 1: every tenant is born with a default "Main" branch, and
 * adding more branches is gated by the branches assigned to the shop (Main counts). The
 * Main branch can never be deleted.
 */
class BranchesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function plan(): Plan
    {
        return Plan::query()->create([
            'name' => 'Test Plan', 'code' => uniqid('plan_'), 'price' => 0,
            'billing_period_months' => 1, 'grace_period_days' => 7,
        ]);
    }

    /**
     * A shop allowed this many branches.
     *
     * Branches are assigned to the SHOP, not sold on a plan. Before that split,
     * a business opening its second site needed a whole plan minted for it —
     * which is how a three-tier price list turns into forty.
     *
     * @return array{0: Tenant, 1: User}
     */
    private function shopWithBranches(int $branches): array
    {
        $tenant = Tenant::factory()->provisioned()->create([
            'plan_id' => $this->plan()->id,
            'limits' => ['branches' => $branches],
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function branchesOf(Tenant $tenant)
    {
        return Branch::withoutTenancy()->where('tenant_id', $tenant->id);
    }

    public function test_every_tenant_is_created_with_a_default_main_branch(): void
    {
        $tenant = Tenant::factory()->create();

        $branches = $this->branchesOf($tenant)->get();
        $this->assertCount(1, $branches);
        $this->assertSame('Main', $branches[0]->name);
        $this->assertTrue($branches[0]->is_default);
    }

    public function test_owner_can_add_a_branch_within_the_plan_limit(): void
    {
        [$tenant, $owner] = $this->shopWithBranches(3);

        $this->login($owner)->postJson('/api/v1/branches', [
            'name' => 'Gulberg', 'code' => 'GLB', 'address' => '5 Main Blvd',
        ])->assertStatus(201);

        $this->assertSame(2, $this->branchesOf($tenant)->count());
    }

    public function test_adding_a_branch_is_blocked_at_the_plan_limit(): void
    {
        // One branch assigned → the Main branch is the only one allowed.
        [, $owner] = $this->shopWithBranches(1);

        $this->login($owner)->postJson('/api/v1/branches', ['name' => 'Second'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');
    }

    public function test_the_main_branch_cannot_be_deleted(): void
    {
        [$tenant, $owner] = $this->shopWithBranches(3);
        $main = $this->branchesOf($tenant)->where('is_default', true)->first();

        $this->login($owner)->deleteJson("/api/v1/branches/{$main->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'BRANCH_IS_DEFAULT');
    }

    public function test_a_secondary_branch_can_be_deleted(): void
    {
        [$tenant, $owner] = $this->shopWithBranches(3);
        $id = $this->login($owner)->postJson('/api/v1/branches', ['name' => 'Extra'])->json('data.id');

        $this->login($owner)->deleteJson("/api/v1/branches/{$id}")->assertOk();
        $this->assertSame(1, $this->branchesOf($tenant)->count());
    }

    public function test_branches_are_scoped_to_the_tenant(): void
    {
        [, $ownerA] = $this->shopWithBranches(3);
        [$tenantB] = $this->shopWithBranches(3);
        $this->branchesOf($tenantB)->first()->update(['name' => 'Other-Main']);

        $names = collect($this->login($ownerA)->getJson('/api/v1/branches')->json('data'))->pluck('name');
        $this->assertcontains('Main', $names->all());
        $this->assertNotContains('Other-Main', $names->all());
    }
}
