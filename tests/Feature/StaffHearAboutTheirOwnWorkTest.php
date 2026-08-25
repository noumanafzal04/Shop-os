<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHO HEARS ABOUT IT.
 *
 * Every operational notification this system sends went to shop OWNERS and to
 * nobody else. The stock keeper was never told a shelf had run down; the person
 * packing orders was never told one had arrived. The bell renders for every
 * signed-in role and `/notifications` sits behind no role gate — so there was a
 * bell in front of them the whole time with nothing that could be put in it.
 *
 * The rule now: **whoever holds the permission that lets them act on it.**
 *
 * Not a role. There are no job roles here — cashier and stock keeper are
 * permission SETS a shop assembles — and it settles the question that was left
 * open when this gap was first raised, *should a cashier hear about low stock?*
 * **The permission is the setting.** A shop that does not want its counter
 * chasing stock does not hand out `inventory.manage`.
 */
class StaffHearAboutTheirOwnWorkTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Milkpak 1L', 'price' => 250, 'cost' => 190,
            'track_inventory' => true, 'stock_quantity' => 20,
            'low_stock_threshold' => 5, 'is_active' => true,
        ]);
    }

    private function main(): Branch
    {
        return Branch::withoutTenancy()->where('tenant_id', $this->shop->id)
            ->where('is_default', true)->firstOrFail();
    }

    /** Take the shelf down through its alert level. */
    private function sellDownTo(float $qty, ?string $branchId = null): void
    {
        BranchStock::withoutTenancy()->updateOrCreate(
            ['tenant_id' => $this->shop->id, 'branch_id' => $branchId ?? $this->main()->id,
                'product_id' => $this->product->id, 'variant_id' => null],
            ['quantity' => 20],
        );
        $this->product->forceFill(['stock_quantity' => 20])->save();

        app(InventoryService::class)->adjust([
            'product_id' => $this->product->id,
            'branch_id' => $branchId ?? $this->main()->id,
            'type' => 'set',
            'new_quantity' => $qty,
            'reason' => 'sold',
        ]);
    }

    private function told(User $user): bool
    {
        return AppNotification::query()
            ->where('user_id', $user->id)->where('type', 'stock.low')->exists();
    }

    // ── The gap ─────────────────────────────────────────────────────

    public function test_the_person_who_reorders_is_told_the_shelf_ran_down(): void
    {
        $keeper = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();

        $this->sellDownTo(2);

        $this->assertTrue($this->told($keeper), 'the stock keeper was never told a shelf ran down');
    }

    public function test_the_owner_still_hears_it(): void
    {
        // Owners hold every permission implicitly. Nothing is taken away from
        // anybody by widening the audience.
        $this->sellDownTo(2);

        $this->assertTrue($this->told($this->owner), 'the owner stopped hearing what they used to hear');
    }

    public function test_somebody_who_cannot_act_on_it_is_not_told(): void
    {
        // The counter staff of a shop that keeps stock work separate. This is
        // the half that makes the permission a real answer rather than a
        // formality: without it, "notify whoever can act" would be "notify
        // everybody" wearing a better name.
        $waiter = User::factory()->tenantStaff($this->shop, [Permissions::SALES_MANAGE])->create();

        $this->sellDownTo(2);

        $this->assertFalse($this->told($waiter), 'somebody with no stock permission was told about stock');
    }

    // ── One branch's shelf is not another's business ─────────────────

    public function test_only_the_branch_whose_shelf_ran_down_is_told(): void
    {
        $other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Second', 'is_default' => false, 'is_active' => true,
        ]);
        $here = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();
        $here->forceFill(['branch_id' => $this->main()->id])->save();
        $elsewhere = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();
        $elsewhere->forceFill(['branch_id' => $other->id])->save();

        $this->sellDownTo(2, $this->main()->id);

        $this->assertTrue($this->told($here));
        $this->assertFalse(
            $this->told($elsewhere),
            'a keeper at another branch was told about a shelf they cannot reach',
        );
    }

    public function test_staff_with_no_branch_recorded_are_still_told(): void
    {
        // The safe direction, and it is a choice. An over-notification makes
        // somebody ask a question; an under-notification makes nobody ask
        // anything — and rows written before staff carried a branch would
        // otherwise go quiet without a word.
        $floating = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();
        $floating->forceFill(['branch_id' => null])->save();

        $this->sellDownTo(2);

        $this->assertTrue($this->told($floating), 'a staff member with no branch recorded went silent');
    }

    public function test_each_recipient_is_deduped_on_their_own(): void
    {
        // One shared dedupe key would let whoever happened to be told first
        // silence everybody else.
        $a = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();
        $b = User::factory()->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();

        $this->sellDownTo(2);

        $this->assertTrue($this->told($a));
        $this->assertTrue($this->told($b));
        $this->assertSame(3, AppNotification::query()->where('type', 'stock.low')->count(),
            'owner + both keepers should each hold their own row');
    }
}
