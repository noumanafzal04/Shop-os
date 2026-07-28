<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch Phase 3: branch-to-branch transfers move stock out of the source
 * and into the destination (rollup unchanged), a branch can't send more than it
 * holds, and cross-branch availability lists on-hand at every branch.
 */
class StockTransferTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
    }

    private function login(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(float $atMain): Product
    {
        $p = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Widget', 'price' => 100, 'track_inventory' => true, 'stock_quantity' => $atMain,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id,
            'product_id' => $p->id, 'variant_id' => null, 'quantity' => $atMain,
        ]);

        return $p;
    }

    private function onHand(Product $p, Branch $b): float
    {
        return (float) (BranchStock::withoutTenancy()
            ->where('branch_id', $b->id)->where('product_id', $p->id)->value('quantity') ?? 0);
    }

    public function test_transfer_moves_stock_between_branches_and_keeps_the_rollup(): void
    {
        $p = $this->product(100);

        $this->login($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->main->id,
            'to_branch_id' => $this->other->id,
            'items' => [['product_id' => $p->id, 'quantity' => 30]],
        ])->assertStatus(201);

        $this->assertSame(70.0, $this->onHand($p, $this->main));
        $this->assertSame(30.0, $this->onHand($p, $this->other));
        $this->assertSame('100.000', (string) $p->fresh()->stock_quantity); // total unchanged
    }

    public function test_a_branch_cannot_transfer_more_than_it_holds(): void
    {
        $p = $this->product(20); // 20 at Main, 0 at other

        $this->login($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->main->id,
            'to_branch_id' => $this->other->id,
            'items' => [['product_id' => $p->id, 'quantity' => 50]],
        ])->assertStatus(422);

        // Nothing moved — the whole transfer rolled back.
        $this->assertSame(20.0, $this->onHand($p, $this->main));
        $this->assertSame(0.0, $this->onHand($p, $this->other));
    }

    public function test_transfer_to_the_same_branch_is_rejected(): void
    {
        $p = $this->product(50);

        $this->login($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->main->id,
            'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $p->id, 'quantity' => 5]],
        ])->assertStatus(422);
    }

    public function test_cross_branch_availability_lists_every_branch(): void
    {
        $p = $this->product(100);
        $this->login($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->main->id, 'to_branch_id' => $this->other->id,
            'items' => [['product_id' => $p->id, 'quantity' => 40]],
        ])->assertStatus(201);

        $rows = collect($this->login($this->owner)->getJson("/api/v1/products/{$p->id}/branch-stock")->assertOk()->json('data'));

        $this->assertSame(60.0, (float) $rows->firstWhere('branch', 'Main')['quantity']);
        $this->assertSame(40.0, (float) $rows->firstWhere('branch', 'Gulberg')['quantity']);
    }

    public function test_transfer_requires_inventory_permission(): void
    {
        $p = $this->product(50);
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create();

        $this->login($staff)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->main->id, 'to_branch_id' => $this->other->id,
            'items' => [['product_id' => $p->id, 'quantity' => 5]],
        ])->assertForbidden();
    }
}
