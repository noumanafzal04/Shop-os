<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\StaffPresets;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Can each job actually be DONE?
 *
 * StaffPresetTest already asserts what a preset grants. That is a different
 * question, and the gap between the two cost a real shop an evening: a cashier
 * signed in and the till showed an empty product grid. Nothing was wrong with
 * the data. GET /products was gated on products.manage — the permission that
 * lets you EDIT the catalog — so the API answered 403 and the panel drew an
 * empty list, which reads as "this shop has no products".
 *
 * The bug class: a `*.manage` permission guarding a READ. Every job that has to
 * look at something it may not change walks into it.
 *
 * So this file asks the only question that matters about a preset — put a real
 * staff user behind it and see whether the screen their job lives on can load.
 * It is deliberately about capability, not about permission names: if the fix
 * ever changes which permission carries a read, these tests should still pass
 * untouched, and the pair of "still forbidden" tests at the bottom should still
 * fail loudly if a fix over-grants instead of splitting.
 */
class PresetCanDoItsJobTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(PlanSeeder::class);
        $this->withoutMiddleware(ThrottleRequests::class);

        // Every module on: this file is about the PERSON axis, so the module
        // and trade axes must never be what fails a case.
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => [
                'pos' => true, 'products' => true, 'services' => true,
                'inventory' => true, 'dine_in' => true, 'expenses' => true,
                'marketplace' => true, 'delivery' => true,
            ],
        ]);

        Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => 'Sooper Biscuit',
            'price' => 60,
            'cost' => 45,
            'stock_quantity' => 100,
            'track_inventory' => true,
        ]);
    }

    /** Sign in as a real staff member hired off the given preset. */
    private function asPreset(string $code): static
    {
        $permissions = StaffPresets::permissionsFor($code);
        $this->assertNotSame([], $permissions, "Preset {$code} does not exist");

        $staff = User::factory()->tenantStaff($this->tenant, $permissions)->create();
        $token = $staff->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function read(string $code, string $url): TestResponse
    {
        return $this->asPreset($code)->getJson("/api/v1{$url}");
    }

    // ── The till ────────────────────────────────────────────────────

    /**
     * The reported bug, pinned. A cashier who cannot read the catalog cannot
     * ring anything up — the grid is the till.
     */
    public function test_a_cashier_can_read_the_catalog_they_sell_from(): void
    {
        $this->read('cashier', '/products')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Sooper Biscuit');
    }

    /** The category strip is how a counter finds an unscannable item. */
    public function test_a_cashier_can_read_the_categories_that_filter_the_grid(): void
    {
        $this->read('cashier', '/categories')->assertOk();
    }

    public function test_a_supervisor_can_read_the_same_till(): void
    {
        $this->read('shift_supervisor', '/products')->assertOk();
    }

    /** A pharmacist rings sales too, and already holds products.manage. */
    public function test_a_pharmacist_can_read_the_catalog(): void
    {
        $this->read('pharmacist', '/products')->assertOk();
    }

    // ── The floor ───────────────────────────────────────────────────

    /** A waiter puts items on a tab. The menu IS the product list. */
    public function test_a_waiter_can_read_the_menu(): void
    {
        $this->read('waiter', '/products')->assertOk();
    }

    public function test_a_waiter_can_read_the_floor(): void
    {
        $this->read('waiter', '/restaurant/tables')->assertOk();
    }

    // ── The stockroom ───────────────────────────────────────────────

    /** Receiving goods means naming who they came from. */
    public function test_a_stock_keeper_can_see_the_suppliers_they_receive_from(): void
    {
        $this->read('stock_keeper', '/suppliers')->assertOk();
    }

    /** You cannot receive against a purchase order you may not open. */
    public function test_a_stock_keeper_can_see_the_purchase_orders_they_receive_against(): void
    {
        $this->read('stock_keeper', '/purchase-orders')->assertOk();
    }

    // ── Running the shop ────────────────────────────────────────────

    /**
     * A manager holds 16 of the 18 permissions and still could not open the
     * shift history, because that route asked for settings.manage — the
     * owner's own authority — to read a list of drawers.
     */
    public function test_a_manager_can_see_the_shift_history(): void
    {
        $this->read('manager', '/pos/sessions')->assertOk();
    }

    public function test_a_manager_can_see_the_lanes_they_run(): void
    {
        $this->read('manager', '/registers')->assertOk();
    }

    /** The category strip on a tab is how a waiter finds the biryani. */
    public function test_a_waiter_can_read_the_categories(): void
    {
        $this->read('waiter', '/categories')->assertOk();
    }

    /** A kitchen ticket has to name what was ordered. */
    public function test_the_kitchen_can_read_the_catalog(): void
    {
        $this->read('kitchen', '/products')->assertOk();
    }

    // ── Things a till does that are not "sell an item" ──────────────

    /**
     * A customer hands over a coupon. Checking it was gated on coupons.manage
     * — the permission to INVENT a coupon — so the only people who could
     * accept one were the people who could print one.
     */
    public function test_a_cashier_can_check_the_coupon_a_customer_hands_over(): void
    {
        $response = $this->asPreset('cashier')
            ->postJson('/api/v1/coupons/validate', ['code' => 'EID50', 'subtotal' => 500]);

        // The code does not exist in this shop, so 404/422 is the right answer.
        // 403 is not: that is the till being told it may not ask.
        $this->assertNotSame(403, $response->status(), 'The till was refused permission to check a coupon.');
    }

    /** Selling a phone means choosing which IMEI leaves the shop. */
    public function test_a_cashier_can_open_the_serial_picker(): void
    {
        $product = Product::withoutTenancy()->where('tenant_id', $this->tenant->id)->firstOrFail();

        $this->read('cashier', "/products/{$product->id}/serials")->assertOk();
    }

    /** "Do they have it at the other branch?" is asked at the counter. */
    public function test_a_cashier_can_check_another_branch(): void
    {
        $product = Product::withoutTenancy()->where('tenant_id', $this->tenant->id)->firstOrFail();

        $this->read('cashier', "/products/{$product->id}/branch-stock")->assertOk();
    }

    /**
     * The search box asked "may you EDIT products?" before deciding whether to
     * include a Products section — so for a cashier the box worked perfectly
     * and simply never found a product.
     */
    public function test_the_search_box_finds_products_for_a_cashier(): void
    {
        $groups = $this->read('cashier', '/search?q=Sooper')
            ->assertOk()
            ->json('data.groups');

        $this->assertContains('product', array_column($groups, 'type'));
    }

    /** The header branch switcher is on every screen, for everyone. */
    public function test_every_operational_job_can_read_the_branch_list(): void
    {
        foreach (['cashier', 'waiter', 'stock_keeper', 'manager', 'accountant'] as $code) {
            $this->read($code, '/branches')->assertOk("{$code} could not read the branch list");
        }
    }

    /** A dispenser's own paperwork is not the shop's P&L. */
    public function test_a_pharmacist_can_read_their_dispensing_register(): void
    {
        $this->read('pharmacist', '/pharmacy/dispensing')->assertOk();
    }

    // ── The boundary the fix must not cross ─────────────────────────

    /**
     * The whole point of splitting reads out rather than granting
     * products.manage: reading the catalog to sell from it must never become
     * the power to reprice it. If a fix takes the lazy path, this fails.
     */
    public function test_a_cashier_still_cannot_change_the_catalog(): void
    {
        $product = Product::withoutTenancy()->where('tenant_id', $this->tenant->id)->firstOrFail();

        $this->asPreset('cashier')
            ->postJson('/api/v1/products', ['name' => 'Smuggled', 'price' => 1])
            ->assertForbidden();

        $this->asPreset('cashier')
            ->putJson("/api/v1/products/{$product->id}", ['price' => 1])
            ->assertForbidden();

        $this->asPreset('cashier')
            ->deleteJson("/api/v1/products/{$product->id}")
            ->assertForbidden();
    }

    /** Same boundary on the floor: a waiter reads the menu, never edits it. */
    public function test_a_waiter_still_cannot_change_the_menu(): void
    {
        $this->asPreset('waiter')
            ->postJson('/api/v1/products', ['name' => 'Off-menu', 'price' => 1])
            ->assertForbidden();
    }

    /** And a manager reading the lane list must not gain the shop's settings. */
    public function test_a_manager_still_cannot_reconfigure_the_shop(): void
    {
        $this->asPreset('manager')
            ->postJson('/api/v1/registers', ['name' => 'Lane 9'])
            ->assertForbidden();
    }

    /** Checking a coupon must not become printing one. */
    public function test_a_cashier_still_cannot_create_a_coupon(): void
    {
        $this->asPreset('cashier')
            ->postJson('/api/v1/coupons', ['code' => 'FREE', 'type' => 'percent', 'value' => 100])
            ->assertForbidden();
    }

    /** Receiving a delivery must not become raising the order for it. */
    public function test_a_stock_keeper_still_cannot_raise_a_purchase_order(): void
    {
        $this->asPreset('stock_keeper')
            ->postJson('/api/v1/purchase-orders', ['supplier_id' => 'x', 'order_date' => '2026-01-01'])
            ->assertForbidden();
    }

    /** Naming a supplier must not become editing the vendor directory. */
    public function test_a_stock_keeper_still_cannot_edit_a_supplier(): void
    {
        $this->asPreset('stock_keeper')
            ->postJson('/api/v1/suppliers', ['name' => 'Ghost Traders'])
            ->assertForbidden();
    }

    /** Reading the branch list must not become deleting a branch. */
    public function test_a_stock_keeper_still_cannot_create_a_branch(): void
    {
        $this->asPreset('stock_keeper')
            ->postJson('/api/v1/branches', ['name' => 'Ghost Branch'])
            ->assertForbidden();
    }

    /** Nobody on the floor banks the takings or signs off the day. */
    public function test_a_cashier_can_neither_close_the_day_nor_bank_the_takings(): void
    {
        $this->asPreset('cashier')
            ->postJson('/api/v1/pos/deposits', ['amount' => 10000])
            ->assertForbidden();
    }
}
