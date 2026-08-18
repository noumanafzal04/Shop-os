<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch Phase 4a: a sale is rung on the OPERATING branch, not always
 * Main. An owner selects it with X-Branch-Id; staff are pinned to their
 * assigned branch and a header can't move them; a return restocks the branch
 * the sale drew from.
 */
class BranchOperatingContextTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $warehouse;

    private Product $widget;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->warehouse = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Warehouse', 'is_default' => false, 'is_active' => true,
        ]);

        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Widget',
            'sku' => 'W-1', 'price' => 100, 'cost' => 60, 'track_inventory' => true, 'stock_quantity' => 15,
        ]);
        // 10 at Main, 5 at Warehouse (rollup 15).
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'product_id' => $this->widget->id, 'variant_id' => null, 'quantity' => 10]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->warehouse->id, 'product_id' => $this->widget->id, 'variant_id' => null, 'quantity' => 5]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function onHand(Branch $b): float
    {
        return (float) (BranchStock::withoutTenancy()
            ->where('branch_id', $b->id)->where('product_id', $this->widget->id)->value('quantity') ?? 0);
    }

    private function payload(): array
    {
        return [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->widget->id, 'quantity' => 2]],
            'payment_method' => 'cash',
            'amount_paid' => 200,
        ];
    }

    /**
     * Correcting stock lands where the owner is standing.
     *
     * Every other stock write already resolved this: receiving a lot takes the
     * operating branch, a stocktake is drawn and posted against it, a transfer
     * names both ends. The plain hand-adjustment — the ONE the shop uses for a
     * breakage, a recount or a write-off — defaulted to Main regardless.
     *
     * The panel sends X-Branch-Id on every request, so an owner who switched to
     * the warehouse and corrected a figure had it applied to Main's shelf while
     * the screen in front of them showed the warehouse. Two shelves wrong from
     * one correct action, and no error anywhere.
     *
     * This class tested the SALE path per branch and never the adjustment,
     * which is exactly why it stayed green.
     */
    public function test_an_adjustment_lands_on_the_branch_being_operated(): void
    {
        $this->actingAsUser($this->owner)
            ->withHeaders(['X-Branch-Id' => $this->warehouse->id])
            ->postJson('/api/v1/inventory/adjust', [
                'product_id' => $this->widget->id,
                'type' => 'set',
                'new_quantity' => 40,
                'reason' => 'Recount at the warehouse',
            ])
            ->assertCreated();

        $this->assertEqualsWithDelta(40, $this->onHand($this->warehouse), 0.001,
            'The recount was entered while operating the warehouse and must land there.');
        $this->assertEqualsWithDelta(10, $this->onHand($this->main), 0.001,
            "Main's shelf was not touched and must not move.");
    }

    /** No header is still Main, as it always was for a single-site shop. */
    public function test_an_adjustment_with_no_branch_header_lands_on_main(): void
    {
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/adjust', [
                'product_id' => $this->widget->id,
                'type' => 'in',
                'quantity' => 3,
                'reason' => 'Delivery at the counter',
            ])
            ->assertCreated();

        $this->assertEqualsWithDelta(13, $this->onHand($this->main), 0.001);
        $this->assertEqualsWithDelta(5, $this->onHand($this->warehouse), 0.001);
    }

    /**
     * And a spoofed header cannot move STAFF, here as anywhere else — otherwise
     * branch assignment is decoration and one site can write off another's
     * stock.
     */
    public function test_staff_adjust_their_own_branch_whatever_header_they_send(): void
    {
        $keeper = User::factory()
            ->tenantStaff($this->tenant, ['inventory.manage'])
            ->create(['branch_id' => $this->warehouse->id]);

        $this->actingAsUser($keeper)
            ->withHeaders(['X-Branch-Id' => $this->main->id])
            ->postJson('/api/v1/inventory/adjust', [
                'product_id' => $this->widget->id,
                'type' => 'out',
                'quantity' => 2,
                'reason' => 'Breakage',
            ])
            ->assertCreated();

        $this->assertEqualsWithDelta(3, $this->onHand($this->warehouse), 0.001,
            "The stock keeper is assigned to the warehouse; the breakage is the warehouse's.");
        $this->assertEqualsWithDelta(10, $this->onHand($this->main), 0.001,
            'A header must never move staff to another branch.');
    }

    public function test_owner_sale_decrements_the_selected_branch(): void
    {
        $res = $this->actingAsUser($this->owner)
            ->withHeaders(['X-Branch-Id' => $this->warehouse->id])
            ->postJson('/api/v1/sales', $this->payload());

        $res->assertCreated()->assertJsonPath('data.branch_id', $this->warehouse->id);

        $this->assertSame(10.0, $this->onHand($this->main));      // untouched
        $this->assertSame(3.0, $this->onHand($this->warehouse));  // 5 → 3
        $this->assertSame('13.000', (string) $this->widget->fresh()->stock_quantity); // rollup
    }

    public function test_owner_sale_without_a_branch_header_hits_main(): void
    {
        $res = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $this->payload());

        $res->assertCreated()->assertJsonPath('data.branch_id', $this->main->id);
        $this->assertSame(8.0, $this->onHand($this->main));      // 10 → 8
        $this->assertSame(5.0, $this->onHand($this->warehouse)); // untouched
    }

    public function test_staff_are_pinned_to_their_branch_and_ignore_a_spoofed_header(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create([
            'branch_id' => $this->warehouse->id,
        ]);

        // Staff sends a header claiming Main — it must be ignored (pinned to Warehouse).
        $res = $this->actingAsUser($staff)
            ->withHeaders(['X-Branch-Id' => $this->main->id])
            ->postJson('/api/v1/sales', $this->payload());

        $res->assertCreated()->assertJsonPath('data.branch_id', $this->warehouse->id);
        $this->assertSame(10.0, $this->onHand($this->main));      // untouched — header ignored
        $this->assertSame(3.0, $this->onHand($this->warehouse));  // 5 → 3
    }

    public function test_returning_a_branch_sale_restocks_that_branch(): void
    {
        $sale = $this->actingAsUser($this->owner)
            ->withHeaders(['X-Branch-Id' => $this->warehouse->id])
            ->postJson('/api/v1/sales', $this->payload())->json('data');

        $this->assertSame(3.0, $this->onHand($this->warehouse));

        $itemId = $sale['items'][0]['id'];
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $itemId, 'quantity' => 2]],
            'refund_method' => 'cash',
        ])->assertCreated();

        // Stock went back to the Warehouse, not Main.
        $this->assertSame(5.0, $this->onHand($this->warehouse));
        $this->assertSame(10.0, $this->onHand($this->main));
    }
}
