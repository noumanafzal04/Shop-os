<?php

namespace Tests\Feature;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\CashSession;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\FulfillingBranch;
use App\Support\Permissions;
use App\Support\PlanLimits;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A WAREHOUSE IS A PLACE THAT HOLDS STOCK AND DOES NOT SELL.
 *
 * A godown used to be a branch like any other. It cost a branch on the plan —
 * so a single shop could not have one — it could open a till it would never
 * use, and an online order could be sent to it for being nearest.
 *
 * What is held here:
 *
 *   a warehouse is counted on its own allowance, and Main is never one
 *   nothing is sold across a counter there: no shift, no sale, no lane, no table
 *   an online order is filled from one only when its owner said so
 *   a delivery goes into the place it is told to, by somebody allowed there
 */
class AWarehouseIsAPlaceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $godown;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->godown = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE,
            'is_default' => false, 'is_active' => true, 'fills_orders' => false,
        ]);
    }

    private function as(User $user, ?Branch $at = null): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $at?->id ?? '']);
    }

    private function product(float $atMain = 0, float $atGodown = 0): Product
    {
        $p = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Basmati 5kg', 'price' => 1500, 'cost' => 1200,
            'track_inventory' => true, 'stock_quantity' => $atMain + $atGodown,
        ]);
        foreach ([[$this->main, $atMain], [$this->godown, $atGodown]] as [$place, $qty]) {
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'branch_id' => $place->id,
                'product_id' => $p->id, 'variant_id' => null, 'quantity' => $qty,
            ]);
        }

        return $p;
    }

    private function onHand(Product $p, Branch $at): float
    {
        return (float) BranchStock::withoutTenancy()->where('branch_id', $at->id)->where('product_id', $p->id)->sum('quantity');
    }

    // ── counted on its own allowance ────────────────────────────────────

    public function test_a_shop_with_one_branch_may_still_have_a_warehouse_and_it_does_not_cost_a_branch(): void
    {
        // The smallest shop there is: one branch allowed, and it is Main.
        $this->tenant->forceFill(['limits' => ['branches' => 1, 'warehouses' => 1]])->save();
        $this->godown->forceDelete();

        $made = $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Back store', 'kind' => 'warehouse'])
            ->assertCreated()
            ->assertJsonPath('data.kind', 'warehouse')
            // A warehouse fills no online orders until its owner says so.
            ->assertJsonPath('data.fills_orders', false)
            ->assertJsonPath('message', 'Warehouse added');

        $this->assertSame(1, PlanLimits::usage($this->tenant, 'branches'), 'The warehouse was counted as a branch.');
        $this->assertSame(1, PlanLimits::usage($this->tenant, 'warehouses'));

        // The allowance is one, and it is the WAREHOUSE allowance that says no.
        $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Second store', 'kind' => 'warehouse'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED')
            ->assertJsonFragment(['message' => "You've reached your limit of 1 warehouses. Ask support to raise the warehouses allowed for your shop."]);

        // …and a second SHOP is still refused on the branch allowance, as before.
        $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'LIMIT_REACHED');

        $this->assertNotNull($made->json('data.id'));
    }

    public function test_a_place_named_with_no_kind_is_a_shop(): void
    {
        $this->tenant->forceFill(['limits' => ['branches' => 3]])->save();

        $this->as($this->owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])
            ->assertCreated()
            ->assertJsonPath('data.kind', 'shop')
            ->assertJsonPath('data.fills_orders', true);
    }

    public function test_main_is_always_a_shop(): void
    {
        $this->godown->forceDelete();

        $this->as($this->owner)->putJson("/api/v1/branches/{$this->main->id}", ['kind' => 'warehouse'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'MAIN_IS_A_SHOP');

        $this->assertSame('shop', $this->main->fresh()->kind);
    }

    public function test_a_shop_with_a_till_still_open_cannot_become_a_warehouse(): void
    {
        $this->godown->forceDelete();
        $this->tenant->forceFill(['limits' => ['branches' => 2]])->save();
        $gulberg = Branch::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_active' => true]);

        $this->as($this->owner, $gulberg)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])->assertCreated();

        $this->as($this->owner)->putJson("/api/v1/branches/{$gulberg->id}", ['kind' => 'warehouse'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'BRANCH_STILL_SELLING');

        $this->assertSame('shop', $gulberg->fresh()->kind);
    }

    public function test_a_business_that_keeps_no_stock_cannot_have_a_warehouse(): void
    {
        $office = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'finance',
            'features' => BusinessTypes::defaultFeatures('finance'), 'timezone' => 'UTC',
        ]);
        $boss = User::factory()->shopOwner($office)->create();

        $this->as($boss)->postJson('/api/v1/branches', ['name' => 'Store room', 'kind' => 'warehouse'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_NEEDS_STOCK');
    }

    public function test_a_place_that_still_holds_stock_cannot_be_deleted(): void
    {
        $rice = $this->product(atGodown: 40);

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'BRANCH_HOLDS_STOCK');
        $this->assertNotNull($this->godown->fresh(), 'A place holding forty cartons was deleted, and the cartons stayed on the books with nowhere to be.');

        // Emptied, it goes.
        $this->as($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 40]],
        ])->assertCreated();

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}")->assertOk();
        $this->assertNull(Branch::withoutTenancy()->find($this->godown->id));
    }

    /**
     * Deleting a place removes the PLACE. What happened there stays.
     *
     * And it goes only when nothing live is left at it: a keeper still
     * assigned would be moved to Main by the fallback, without anybody
     * deciding it — a cashier selling another branch's shelf, which is the
     * exact thing the assignment exists to stop.
     */
    public function test_a_branch_goes_only_when_nobody_is_left_at_it_and_what_happened_there_stays(): void
    {
        $this->tenant->forceFill(['limits' => ['branches' => 2]])->save();
        $gulberg = Branch::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_active' => true]);
        $soap = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Soap', 'price' => 100, 'track_inventory' => true, 'stock_quantity' => 1,
        ]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'product_id' => $soap->id, 'variant_id' => null, 'quantity' => 0]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $gulberg->id, 'product_id' => $soap->id, 'variant_id' => null, 'quantity' => 1]);
        $cashier = User::factory()->tenantStaff($this->tenant, [Permissions::SALES_MANAGE])->create(['branch_id' => $gulberg->id]);

        // The last bar of soap is sold at Gulberg: its shelf is empty, and it has a history.
        $sale = $this->as($this->owner, $gulberg)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'items' => [['product_id' => $soap->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 100,
        ])->assertCreated()->json('data.id');

        // Somebody still works there.
        $this->as($this->owner)->deleteJson("/api/v1/branches/{$gulberg->id}")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'BRANCH_HAS_STAFF')
            ->assertJsonFragment(['message' => 'One person works at Gulberg. Move them to another place first — otherwise they would be moved to Main without anybody deciding it.']);

        $cashier->forceFill(['branch_id' => $this->main->id])->save();

        // A drawer is still open there.
        $this->as($this->owner, $gulberg)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])->assertCreated();
        $this->as($this->owner)->deleteJson("/api/v1/branches/{$gulberg->id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_STILL_SELLING');
        CashSession::withoutTenancy()->where('branch_id', $gulberg->id)->update(['status' => 'closed', 'closed_at' => now()]);

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$gulberg->id}")->assertOk();
        $this->assertNull(Branch::withoutTenancy()->find($gulberg->id));

        // The sale is still a sale, still Gulberg's, and still in the business's books.
        $kept = Sale::withoutTenancy()->findOrFail($sale);
        $this->assertSame($gulberg->id, $kept->branch_id);
        $this->assertContains($sale, array_column($this->as($this->owner)->getJson('/api/v1/sales')->assertOk()->json('data'), 'id'), 'Deleting the branch took its sales out of the books.');
    }

    public function test_closing_a_place_is_held_to_what_deleting_it_is(): void
    {
        $rice = $this->product(atGodown: 40);

        // Closed, it drops out of every list of places — so its stock would be on the books and on no screen.
        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['is_active' => false])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_HOLDS_STOCK');
        $this->assertTrue($this->godown->fresh()->is_active);

        $this->as($this->owner)->putJson("/api/v1/branches/{$this->main->id}", ['is_active' => false])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_IS_DEFAULT');

        $this->as($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 40]],
        ])->assertCreated();

        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['is_active' => false])->assertOk();
        $this->assertFalse($this->godown->fresh()->is_active);

        // …and re-opening it is asked nothing.
        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['is_active' => true])->assertOk();
    }

    // ── nothing is sold across a counter there ──────────────────────────

    public function test_no_shift_opens_at_a_warehouse(): void
    {
        $this->as($this->owner, $this->godown)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_DOES_NOT_SELL')
            ->assertJsonFragment(['message' => 'Godown is a warehouse — it holds stock and has no till. Choose a shop to sell from.']);
    }

    public function test_no_counter_sale_is_rung_at_a_warehouse_and_its_stock_is_untouched(): void
    {
        $rice = $this->product(atMain: 10, atGodown: 40);
        $sale = [
            'channel' => 'walk_in',
            'items' => [['product_id' => $rice->id, 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 3000,
        ];

        $this->as($this->owner, $this->godown)->postJson('/api/v1/sales', $sale)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_DOES_NOT_SELL');
        $this->assertEqualsWithDelta(40, $this->onHand($rice, $this->godown), 0.001, 'A refused sale still took stock from the warehouse.');

        // The same sale at the shop is an ordinary sale.
        $this->as($this->owner, $this->main)->postJson('/api/v1/sales', $sale)->assertCreated();
        $this->assertEqualsWithDelta(8, $this->onHand($rice, $this->main), 0.001);
    }

    public function test_a_warehouse_has_no_till_lane_and_no_tables(): void
    {
        $this->as($this->owner)->postJson('/api/v1/registers', ['name' => 'Lane 9', 'branch_id' => $this->godown->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors('branch_id');

        // Not named, only stood in: the lane would land there all the same,
        // and it is refused all the same.
        $this->as($this->owner, $this->godown)->postJson('/api/v1/registers', ['name' => 'Lane 9'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['branch_id' => 'Godown is a warehouse — it holds stock and cannot have a till. Choose a shop.']);

        $this->as($this->owner, $this->godown)->postJson('/api/v1/restaurant/tables', ['name' => 'T1', 'seats' => 4])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_DOES_NOT_SELL');
    }

    public function test_nobody_is_served_and_no_pump_is_run_from_a_warehouse(): void
    {
        // A takeaway has no table to stand at, so it stands where it was taken — and that cannot be a store room.
        $this->as($this->owner, $this->godown)->postJson('/api/v1/restaurant/tickets', ['order_type' => 'takeaway', 'customer_name' => 'Ali'])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_DOES_NOT_SELL');
        // The same order at the shop opens.
        $this->as($this->owner, $this->main)->postJson('/api/v1/restaurant/tickets', ['order_type' => 'takeaway', 'customer_name' => 'Ali'])
            ->assertCreated();

        // Pumps stand at a station.
        $this->as($this->owner, $this->godown)->postJson('/api/v1/fuel/shifts', [])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'WAREHOUSE_DOES_NOT_SELL');
    }

    /**
     * The guard is the model's, not only the screen's: a seeder, a job or a
     * tinker session that marks a warehouse as the default is refused the same
     * way the form is.
     */
    public function test_no_caller_can_make_the_default_place_a_warehouse(): void
    {
        $this->expectException(DomainException::class);

        $this->godown->forceFill(['is_default' => true])->save();
    }

    public function test_the_dashboard_compares_shops_and_leaves_the_warehouse_out(): void
    {
        $this->tenant->forceFill(['limits' => ['branches' => 2]])->save();
        Branch::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_active' => true]);

        $compared = array_column($this->as($this->owner)->getJson('/api/v1/dashboard')->assertOk()->json('data.branches') ?? [], 'branch');

        $this->assertEqualsCanonicalizing(['Main', 'Gulberg'], $compared, 'A place that sells nothing is in the comparison of what each place sold.');
    }

    public function test_a_warehouse_cannot_be_given_a_price_of_its_own(): void
    {
        $rice = $this->product(atMain: 10);

        $this->as($this->owner)->putJson("/api/v1/products/{$rice->id}/branch-prices", [
            'prices' => [['branch_id' => $this->godown->id, 'price' => 1400]],
        ])->assertStatus(422)->assertJsonValidationErrors('prices.0.branch_id');

        $offered = collect($this->as($this->owner)->getJson("/api/v1/products/{$rice->id}/branch-prices")->assertOk()->json('data.branches'))
            ->pluck('branch_id');
        $this->assertNotContains($this->godown->id, $offered, 'The price editor offered a place that sells nothing.');
    }

    // ── online orders ───────────────────────────────────────────────────

    public function test_an_online_order_is_filled_from_a_warehouse_only_when_its_owner_said_so(): void
    {
        $this->assertSame(
            [$this->main->id],
            FulfillingBranch::ranked($this->tenant->id, null, null)->pluck('id')->all(),
            'A godown that never said it ships orders was offered one.',
        );

        // A clothing brand ships its online orders from the warehouse.
        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['fills_orders' => true])
            ->assertOk()->assertJsonPath('data.fills_orders', true);

        $this->assertEqualsCanonicalizing(
            [$this->main->id, $this->godown->id],
            FulfillingBranch::ranked($this->tenant->id, null, null)->pluck('id')->all(),
        );
    }

    // ── a delivery goes into the place it is told to ────────────────────

    /** @return array{id: string, items: array<int, array{id: string}>} */
    private function orderFor(Product $p, float $qty, float $cost = 1200): array
    {
        $supplier = $this->as($this->owner)->postJson('/api/v1/suppliers', ['name' => 'Rice Traders', 'phone' => '+923001112233'])
            ->assertCreated()->json('data.id');

        return $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $p->id, 'quantity' => $qty, 'unit_cost' => $cost]],
        ])->assertCreated()->json('data');
    }

    public function test_the_owner_receives_a_delivery_into_the_warehouse_while_standing_in_the_shop(): void
    {
        $rice = $this->product(atMain: 5);
        $po = $this->orderFor($rice, 100);

        $this->as($this->owner, $this->main)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [
            'branch_id' => $this->godown->id,
            'items' => [['id' => $po['items'][0]['id'], 'quantity' => 100, 'batch_number' => 'R-77', 'expiry_date' => now()->addYear()->toDateString()]],
        ])->assertOk()->assertJsonPath('message', 'Goods received into Godown');

        $this->assertEqualsWithDelta(100, $this->onHand($rice, $this->godown), 0.001);
        $this->assertEqualsWithDelta(5, $this->onHand($rice, $this->main), 0.001, 'The delivery was told to go to the godown and landed on the shop shelf.');
        // The lot is where the stock is.
        $this->assertSame($this->godown->id, ProductBatch::withoutTenancy()->where('batch_number', 'R-77')->value('branch_id'));
    }

    public function test_a_stock_keeper_takes_deliveries_into_their_own_place_only_unless_given_reach(): void
    {
        $rice = $this->product();
        $keeper = User::factory()->tenantStaff($this->tenant, [Permissions::PURCHASES_MANAGE, Permissions::INVENTORY_MANAGE])->create();
        $po = $this->orderFor($rice, 60);

        // Pinned to Main (assigned nowhere else), and asking for the godown.
        $this->as($keeper)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", ['branch_id' => $this->godown->id])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->godown), 0.001);

        // The owner ticks "Move stock at any place".
        $keeper->forceFill(['permissions' => [Permissions::PURCHASES_MANAGE, Permissions::INVENTORY_MANAGE, Permissions::INVENTORY_ANY_PLACE]])->save();

        $this->as($keeper)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", ['branch_id' => $this->godown->id])->assertOk();
        $this->assertEqualsWithDelta(60, $this->onHand($rice, $this->godown), 0.001);
    }

    public function test_a_keeper_is_offered_receive_only_on_an_order_they_may_take_in(): void
    {
        $rice = $this->product();
        $keeper = User::factory()->tenantStaff($this->tenant, [Permissions::PURCHASES_MANAGE, Permissions::INVENTORY_MANAGE])->create();
        $forShop = $this->orderFor($rice, 10);
        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['takes_deliveries' => true])->assertOk();
        $forGodown = $this->orderFor($rice, 60);
        $this->assertSame($this->godown->id, $forGodown['deliver_to_branch_id']);
        $mayReceive = fn (User $who, array $po): bool => $this->as($who)->getJson("/api/v1/purchase-orders/{$po['id']}")
            ->assertOk()->json('data.can.receive');

        // B35: pinned to Main, they were offered "Receive all" on the godown's order and refused.
        $this->assertTrue($mayReceive($keeper, $forShop));
        $this->assertFalse($mayReceive($keeper, $forGodown));
        $this->assertTrue($mayReceive($this->owner, $forGodown));

        $keeper->forceFill(['permissions' => [Permissions::PURCHASES_MANAGE, Permissions::INVENTORY_MANAGE, Permissions::INVENTORY_ANY_PLACE]])->save();
        $this->assertTrue($mayReceive($keeper, $forGodown));

        // Taken in: nothing left to receive, for anybody.
        $this->as($this->owner)->postJson("/api/v1/purchase-orders/{$forShop['id']}/receive", [])->assertOk();
        $this->assertFalse($mayReceive($this->owner, $forShop));
    }

    /**
     * Opening stock goes where its maker is standing.
     *
     * It went on Main, always: an owner who chose the godown and carded a new
     * line with sixty in stock had the sixty land on the shop's shelf, under a
     * header that said Godown. And Main must not then be read as holding it
     * too — a product with no row at Main is taken for stock that pre-dates
     * per-place rows.
     */
    public function test_a_product_added_while_standing_in_the_godown_has_its_opening_stock_in_the_godown(): void
    {
        $made = $this->as($this->owner, $this->godown)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Sella Rice 25kg', 'price' => 6500,
            'track_inventory' => true, 'stock_quantity' => 60, 'description' => 'Sack', 'tax_rate' => 0,
        ])->assertCreated()->json('data');
        $rice = Product::withoutTenancy()->findOrFail($made['id']);

        $this->assertEqualsWithDelta(60, $this->onHand($rice, $this->godown), 0.001, 'Carded in the godown, and the stock is not there.');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001, 'Carded in the godown, and the stock is on the shop shelf.');

        // Touch Main: it gains what was put there, and nothing it never had.
        $this->as($this->owner, $this->main)->postJson('/api/v1/inventory/adjust', [
            'product_id' => $rice->id, 'type' => 'in', 'quantity' => 5, 'reason' => 'Shelf fill',
        ])->assertCreated();
        $this->assertEqualsWithDelta(5, $this->onHand($rice, $this->main), 0.001, 'Main was read as already holding the godown\'s sixty.');
        $this->assertEqualsWithDelta(65, (float) $rice->fresh()->stock_quantity, 0.001);

        // A product sold in sizes: each size is in the godown too.
        $shirt = $this->as($this->owner, $this->godown)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Kurta', 'price' => 3000, 'track_inventory' => true,
            'description' => 'Cotton', 'tax_rate' => 0,
            'variants' => [['name' => 'Medium', 'price' => 3000, 'stock_quantity' => 9], ['name' => 'Large', 'price' => 3000, 'stock_quantity' => 4]],
        ])->assertCreated()->json('data');
        $kurta = Product::withoutTenancy()->findOrFail($shirt['id']);
        $this->assertEqualsWithDelta(13, $this->onHand($kurta, $this->godown), 0.001);
        $this->assertEqualsWithDelta(0, $this->onHand($kurta, $this->main), 0.001);

        // And from head office — no place chosen — it is Main, as it always was.
        $soap = $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Soap', 'price' => 120,
            'track_inventory' => true, 'stock_quantity' => 30, 'description' => 'Bar', 'tax_rate' => 0,
        ])->assertCreated()->json('data');
        $this->assertEqualsWithDelta(30, $this->onHand(Product::withoutTenancy()->findOrFail($soap['id']), $this->main), 0.001);
    }

    // ── an order says where it is going ─────────────────────────────────

    /**
     * Three shapes of business, one rule. With no place marked, an order is
     * addressed to whoever raises it — the supplier's van comes to the branch.
     * With the warehouse marked, every order is addressed to the warehouse,
     * and received into it without anybody having to remember to say so.
     */
    public function test_an_order_is_addressed_to_the_branch_that_raised_it_until_the_business_says_its_deliveries_come_to_the_warehouse(): void
    {
        $rice = $this->product();

        // Direct delivery: raised at the shop, addressed to the shop.
        $direct = $this->orderFor($rice, 10);
        $this->assertSame($this->main->id, $direct['deliver_to_branch_id']);
        $this->assertSame('Main', $direct['deliver_to']['name'] ?? $this->main->name);

        // "Our deliveries come to the godown."
        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['takes_deliveries' => true])
            ->assertOk()->assertJsonPath('data.takes_deliveries', true);

        $central = $this->orderFor($rice, 20);
        $this->assertSame($this->godown->id, $central['deliver_to_branch_id'], 'The business receives at its godown and the order was addressed to the shop.');

        // Received from the shop's screen, with nobody naming a place: it goes where it was addressed.
        $this->as($this->owner, $this->main)->postJson("/api/v1/purchase-orders/{$central['id']}/receive")
            ->assertOk()->assertJsonPath('message', 'Goods received into Godown');
        $this->assertEqualsWithDelta(20, $this->onHand($rice, $this->godown), 0.001);
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001);

        // …unless the receipt says otherwise: this van came to the shop after all.
        $this->as($this->owner, $this->main)->postJson("/api/v1/purchase-orders/{$direct['id']}/receive", ['branch_id' => $this->main->id])->assertOk();
        $this->assertEqualsWithDelta(10, $this->onHand($rice, $this->main), 0.001);

        // An order can be addressed by hand, whatever the rule.
        $supplier = $central['supplier_id'];
        $byHand = $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'deliver_to_branch_id' => $this->main->id,
            'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $rice->id, 'quantity' => 5, 'unit_cost' => 1200]],
        ])->assertCreated()->json('data');
        $this->assertSame($this->main->id, $byHand['deliver_to_branch_id']);
    }

    public function test_a_business_has_one_place_its_deliveries_come_to_and_it_is_not_a_closed_one(): void
    {
        $this->tenant->forceFill(['limits' => ['branches' => 2, 'warehouses' => 1]])->save();
        $gulberg = Branch::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_active' => true]);

        $this->as($this->owner)->putJson("/api/v1/branches/{$this->godown->id}", ['takes_deliveries' => true])->assertOk();
        // Marking another moves the mark; it does not add a second.
        $this->as($this->owner)->putJson("/api/v1/branches/{$gulberg->id}", ['takes_deliveries' => true])->assertOk();

        $this->assertFalse($this->godown->fresh()->takes_deliveries, 'Two places are marked as where deliveries come.');
        $this->assertSame($gulberg->id, Branch::deliveriesComeTo($this->tenant->id));

        // Closed, a place takes no deliveries — and new orders stop being addressed to it.
        $this->as($this->owner)->putJson("/api/v1/branches/{$gulberg->id}", ['is_active' => false])->assertOk();
        $this->assertFalse($gulberg->fresh()->takes_deliveries);
        $this->assertNull(Branch::deliveriesComeTo($this->tenant->id));

        // And should a closed place ever be left marked — a seeder, an import,
        // a row edited by hand — it is still not where an order is addressed.
        Branch::withoutTenancy()->whereKey($gulberg->id)->update(['takes_deliveries' => true]);
        $this->assertNull(Branch::deliveriesComeTo($this->tenant->id), 'New orders would be addressed to a place that is shut.');
    }

    // ── a place being removed says what becomes of what is in it ────────

    public function test_deleting_a_place_can_carry_its_stock_and_its_people_to_another(): void
    {
        $rice = $this->product(atGodown: 40);
        ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->godown->id, 'product_id' => $rice->id,
            'batch_number' => 'G-1', 'expiry_date' => now()->addYear()->toDateString(), 'quantity' => 40, 'cost' => 1100,
        ]);
        $keeper = User::factory()->tenantStaff($this->tenant, [Permissions::INVENTORY_MANAGE])->create(['branch_id' => $this->godown->id]);

        // What the dialog is told before it asks anything.
        $this->as($this->owner)->getJson("/api/v1/branches/{$this->godown->id}/leaving")
            ->assertOk()
            ->assertJsonPath('data.products', 1)
            ->assertJsonPath('data.people', 1)
            ->assertJsonPath('data.blocked', null);
        $this->assertEqualsWithDelta(40, (float) $this->as($this->owner)->getJson("/api/v1/branches/{$this->godown->id}/leaving")->json('data.units'), 0.001);

        // Moving needs somewhere to move to.
        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}", ['stock' => 'move'])
            ->assertStatus(422)->assertJsonValidationErrors('stock_to');
        // The stock was answered for and the people were not: still refused, and nothing was moved.
        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}", ['stock' => 'move', 'stock_to' => $this->main->id])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_HAS_STAFF');
        $this->assertEqualsWithDelta(40, $this->onHand($rice, $this->godown), 0.001, 'A refused delete moved the stock anyway.');

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}", [
            'stock' => 'move', 'stock_to' => $this->main->id, 'people_to' => $this->main->id,
        ])->assertOk();

        $this->assertNull(Branch::withoutTenancy()->find($this->godown->id));
        $this->assertEqualsWithDelta(40, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(40, (float) $rice->fresh()->stock_quantity, 0.001, 'Moving it changed how much the business owns.');
        // It arrived as the lot it was.
        $this->assertSame($this->main->id, ProductBatch::withoutTenancy()->where('batch_number', 'G-1')->where('quantity', '>', 0)->value('branch_id'));
        $this->assertSame($this->main->id, $keeper->fresh()->branch_id);
        // …and how it got there is on record, as a transfer.
        $this->assertSame(1, StockTransfer::withoutTenancy()->where('from_branch_id', $this->godown->id)->where('status', 'completed')->count());
    }

    public function test_deleting_a_place_can_write_its_stock_off_with_it_and_the_books_say_so(): void
    {
        $rice = $this->product(atMain: 5, atGodown: 40);

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}", ['stock' => 'discard'])->assertOk();

        $this->assertNull(Branch::withoutTenancy()->find($this->godown->id));
        $this->assertEqualsWithDelta(5, (float) $rice->fresh()->stock_quantity, 0.001, 'The stock went with the place and is still on the books.');
        $this->assertEqualsWithDelta(5, $this->onHand($rice, $this->main), 0.001, 'Writing off the godown touched the shop.');
        // It left in the open: a movement, with the reason.
        $this->assertSame(1, StockMovement::withoutTenancy()
            ->where('product_id', $rice->id)->where('branch_id', $this->godown->id)
            ->where('reason', 'Written off — Godown was removed with its stock')->count());
    }

    public function test_what_somebody_has_to_finish_is_not_decided_away_by_the_dialog(): void
    {
        $rice = $this->product(atGodown: 40);
        // Ten of them are on a van to the shop.
        $this->as($this->owner)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'send', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 10]],
        ])->assertCreated();

        $this->assertStringContainsString('not finished yet', (string) $this->as($this->owner)->getJson("/api/v1/branches/{$this->godown->id}/leaving")->json('data.blocked'));

        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}", ['stock' => 'discard'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_HAS_OPEN_TRANSFERS');
        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->godown), 0.001, 'A delete refused over the van wrote the shelf off first.');
    }

    // ── the reorder list knows the back room ────────────────────────────

    public function test_the_reorder_list_says_the_godown_has_it_and_stock_by_place_shows_every_place(): void
    {
        $rice = $this->product(atMain: 2, atGodown: 40);
        $rice->forceFill(['low_stock_threshold' => 5])->save();
        $sized = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Polo shirt', 'price' => 2500, 'track_inventory' => true, 'stock_quantity' => 0,
        ]);
        $medium = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $sized->id, 'name' => 'Medium', 'price' => 2500, 'stock_quantity' => 12,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->godown->id,
            'product_id' => $sized->id, 'variant_id' => $medium->id, 'quantity' => 12,
        ]);

        // Asked about the shop's shelf: low there, and held in the back.
        $row = collect($this->as($this->owner, $this->main)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))
            ->firstWhere('id', $rice->id);
        $this->assertNotNull($row, 'The shelf is at 2 against a level of 5 and is not on the reorder list.');
        $this->assertEquals(
            [['branch_id' => $this->godown->id, 'name' => 'Godown', 'kind' => 'warehouse', 'quantity' => 40]],
            $row['held_elsewhere'],
        );

        $page = $this->as($this->owner, $this->main)->getJson('/api/v1/inventory/by-place')->assertOk();
        $this->assertSame(['shop', 'warehouse'], array_column($page->json('meta.places'), 'kind'), 'Shops are listed before warehouses.');

        $rows = collect($page->json('data'))->keyBy('id');
        $this->assertEqualsWithDelta(2, $rows[$rice->id]['places'][$this->main->id], 0.001);
        $this->assertEqualsWithDelta(40, $rows[$rice->id]['places'][$this->godown->id], 0.001);
        $this->assertEqualsWithDelta(42, $rows[$rice->id]['total'], 0.001);
        // A product sold in sizes is its sizes added up, and each size is shown.
        $this->assertEqualsWithDelta(12, $rows[$sized->id]['places'][$this->godown->id], 0.001);
        $this->assertEqualsWithDelta(12, $rows[$sized->id]['sizes'][0]['places'][$this->godown->id], 0.001);

        // "Running low here and held elsewhere" is the rice, and only the rice.
        $refill = $this->as($this->owner, $this->main)->getJson('/api/v1/inventory/by-place?only=refill')->assertOk();
        $this->assertSame([$rice->id], array_column($refill->json('data'), 'id'));
    }

    public function test_stock_by_place_asks_the_same_number_of_questions_however_many_products_there_are(): void
    {
        $count = function (int $products): int {
            for ($i = 0; $i < $products; $i++) {
                $this->product(atMain: 3, atGodown: 9);
            }
            $this->as($this->owner, $this->main);
            \DB::flushQueryLog();
            \DB::enableQueryLog();
            $this->getJson('/api/v1/inventory/by-place')->assertOk();
            $asked = count(\DB::getQueryLog());
            \DB::disableQueryLog();

            return $asked;
        };

        $few = $count(2);
        $many = $count(18);

        $this->assertSame($few, $many, "Two products took {$few} queries and twenty took {$many}: the screen asks once per row.");
    }

    /**
     * A WAREHOUSE IS NOT COMPULSORY — and a shop without one is not shown one.
     *
     * Asked in so many words: "warehouse compulsory hai? … bht sari shops,
     * shops main e apna sb manage krti". Every plan ALLOWS a godown, and the
     * panel drew its screens from the allowance: a one-counter grocer was
     * shown Stock by place and Stock transfers. The panel is told how many
     * places are actually open, with the settings it already holds, and draws
     * the screens about places when there is a second one.
     */
    public function test_the_panel_is_told_how_many_places_are_open_not_how_many_are_allowed(): void
    {
        // A shop of its own: one counter, on a plan that would allow a godown.
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($shop)->create();
        $shop->assignLimits(['branches' => 3, 'warehouses' => 2]);

        $told = fn (): array => $this->as($owner)->getJson('/api/v1/shop/settings')->assertOk()->json('data');

        $this->assertSame(2, $told()['max_warehouses'], 'The allowance is not what this is about — it is still sent.');
        $this->assertSame(['shops' => 1, 'warehouses' => 0], $told()['places'], 'One shop, allowed a godown it does not have, was counted as more than one place.');

        // The day it takes a godown, the panel knows.
        $godown = $this->as($owner)->postJson('/api/v1/branches', ['name' => 'Back Store', 'kind' => 'warehouse'])
            ->assertCreated()->json('data.id');
        $this->assertSame(['shops' => 1, 'warehouses' => 1], $told()['places']);

        // A second branch is a second place that SELLS.
        $second = $this->as($owner)->postJson('/api/v1/branches', ['name' => 'Gulberg'])->assertCreated()->json('data.id');
        $this->assertSame(['shops' => 2, 'warehouses' => 1], $told()['places']);

        // Closed is not open: stock cannot be sent to it, so it is not counted.
        $this->as($owner)->putJson("/api/v1/branches/{$godown}", ['is_active' => false])->assertOk();
        $this->assertSame(['shops' => 2, 'warehouses' => 0], $told()['places']);

        // And a place taken away is gone from the count.
        $this->as($owner)->deleteJson("/api/v1/branches/{$second}")->assertSuccessful();
        $this->assertSame(['shops' => 1, 'warehouses' => 0], $told()['places']);

        // Somebody else's places are nobody else's count.
        $this->assertSame(['shops' => 1, 'warehouses' => 1], $this->as($this->owner)->getJson('/api/v1/shop/settings')->json('data.places'));
    }
}
