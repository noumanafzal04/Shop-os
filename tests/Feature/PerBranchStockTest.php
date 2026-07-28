<?php

namespace Tests\Feature;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\InventoryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Multi-branch Phase 2: stock is tracked per branch (branch_stock), while
 * product.stock_quantity stays a sum-across-branches rollup so every existing
 * read keeps working. A branch can't oversell its own on-hand.
 */
class PerBranchStockTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private InventoryService $inventory;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::factory()->create(); // created hook → Main branch
        $this->inventory = app(InventoryService::class);
    }

    private function mainBranch(): Branch
    {
        return Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
    }

    private function extraBranch(string $name = 'Gulberg'): Branch
    {
        return Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => $name, 'is_default' => false, 'is_active' => true,
        ]);
    }

    private function product(float $openingAtMain = 0): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Widget', 'price' => 100, 'track_inventory' => true, 'stock_quantity' => $openingAtMain,
        ]);
    }

    private function onHand(Product $p, Branch $b): float
    {
        return (float) (BranchStock::withoutTenancy()
            ->where('branch_id', $b->id)->where('product_id', $p->id)->whereNull('variant_id')
            ->value('quantity') ?? 0);
    }

    public function test_stock_is_tracked_per_branch_and_rolls_up(): void
    {
        $main = $this->mainBranch();
        $b = $this->extraBranch();
        $p = $this->product(100); // 100 legacy units live at Main

        // Receive 50 into the second branch.
        $this->inventory->adjust(['product_id' => $p->id, 'branch_id' => $b->id, 'type' => 'in', 'quantity' => 50]);

        $this->assertSame(100.0, $this->onHand($p, $main));
        $this->assertSame(50.0, $this->onHand($p, $b));
        $this->assertSame('150.000', (string) $p->fresh()->stock_quantity); // rollup
    }

    public function test_selling_from_one_branch_does_not_touch_another(): void
    {
        $main = $this->mainBranch();
        $b = $this->extraBranch();
        $p = $this->product(100);
        $this->inventory->adjust(['product_id' => $p->id, 'branch_id' => $b->id, 'type' => 'in', 'quantity' => 50]);

        // Sell 30 at Main.
        $this->inventory->adjust(['product_id' => $p->id, 'branch_id' => $main->id, 'type' => 'out', 'quantity' => 30]);

        $this->assertSame(70.0, $this->onHand($p, $main));
        $this->assertSame(50.0, $this->onHand($p, $b));   // untouched
        $this->assertSame('120.000', (string) $p->fresh()->stock_quantity);
    }

    public function test_a_branch_cannot_oversell_its_own_stock(): void
    {
        $b = $this->extraBranch();
        $p = $this->product(100); // 100 at Main, 0 at B
        $this->inventory->adjust(['product_id' => $p->id, 'branch_id' => $b->id, 'type' => 'in', 'quantity' => 20]);

        // B has only 20, even though the shop total is 120.
        $this->expectException(DomainException::class);
        $this->inventory->adjust(['product_id' => $p->id, 'branch_id' => $b->id, 'type' => 'out', 'quantity' => 60]);
    }

    public function test_single_branch_shop_tracks_stock_exactly_as_before(): void
    {
        $main = $this->mainBranch();
        $p = $this->product(40);

        $this->inventory->adjust(['product_id' => $p->id, 'type' => 'out', 'quantity' => 15]); // no branch → Main

        $this->assertSame(25.0, $this->onHand($p, $main));
        $this->assertSame('25.000', (string) $p->fresh()->stock_quantity);
    }
}
