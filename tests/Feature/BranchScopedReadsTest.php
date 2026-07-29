<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch Phase 4b: reads respect the branch scope. Staff see only their
 * branch's sales; an owner sees ALL branches by default and can focus one with
 * X-Branch-Id; the dashboard scopes its figures and carries a per-branch
 * (HQ) breakdown.
 */
class BranchScopedReadsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $other;

    private Product $widget;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Widget',
            'sku' => 'W-1', 'price' => 100, 'cost' => 60, 'track_inventory' => true, 'stock_quantity' => 100,
        ]);
        foreach ([$this->main, $this->other] as $b) {
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'branch_id' => $b->id,
                'product_id' => $this->widget->id, 'variant_id' => null, 'quantity' => 50,
            ]);
        }
    }

    private function login(User $user): static
    {
        // Reset any sticky default headers (e.g. an X-Branch-Id from a prior
        // request) so each call starts clean — withHeaders() otherwise persists
        // across requests in the same test.
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Ring a sale on a given branch (owner path with an explicit header). */
    private function sellOn(Branch $b): void
    {
        $this->login($this->owner)->withHeaders(['X-Branch-Id' => $b->id])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->widget->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated();
    }

    public function test_owner_sees_all_branches_by_default_and_one_when_focused(): void
    {
        $this->sellOn($this->main);
        $this->sellOn($this->other);
        $this->sellOn($this->other);

        // No header → All branches → all 3 sales.
        $all = $this->login($this->owner)->getJson('/api/v1/sales')->assertOk();
        $this->assertSame(3, $all->json('meta.pagination.total'));

        // Focused on Gulberg → only its 2 sales.
        $focused = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/sales')->assertOk();
        $this->assertSame(2, $focused->json('meta.pagination.total'));
    }

    public function test_staff_only_see_their_assigned_branch_sales(): void
    {
        $this->sellOn($this->main);
        $this->sellOn($this->other);

        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create([
            'branch_id' => $this->other->id,
        ]);

        // Even sending a header for Main, staff are pinned to Gulberg on reads.
        $res = $this->login($staff)->withHeaders(['X-Branch-Id' => $this->main->id])
            ->getJson('/api/v1/sales')->assertOk();

        $this->assertSame(1, $res->json('meta.pagination.total'));
        $this->assertSame('Gulberg', $res->json('data.0.branch.name'));
    }

    public function test_dashboard_scopes_figures_and_carries_a_branch_breakdown(): void
    {
        $this->sellOn($this->main);   // revenue 100 at Main
        $this->sellOn($this->other);  // revenue 100 at Gulberg
        $this->sellOn($this->other);  // revenue 100 at Gulberg

        // Owner, all branches: revenue 300, breakdown lists both branches.
        $all = $this->login($this->owner)->getJson('/api/v1/dashboard')->assertOk();
        $this->assertNull($all->json('data.branch_scope'));
        $this->assertSame(300.0, (float) $all->json('data.today.revenue'));
        $breakdown = collect($all->json('data.branches'));
        $this->assertSame(2, $breakdown->count());
        $this->assertSame(200.0, (float) $breakdown->firstWhere('branch', 'Gulberg')['revenue']);

        // Owner focused on Gulberg: revenue 200, scope stamped.
        $focused = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/dashboard')->assertOk();
        $this->assertSame($this->other->id, $focused->json('data.branch_scope'));
        $this->assertSame(200.0, (float) $focused->json('data.today.revenue'));
    }
}
