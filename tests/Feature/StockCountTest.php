<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Counting the shelves.
 *
 * A shop's stock figure drifts — breakage, theft, a sale rung on the wrong
 * item, a delivery received short — and counting is the only way to find out by
 * how much. The whole design turns on one thing:
 *
 *   The sheet said 50 at 9pm. The counter found 48. By the time a manager signs
 *   it off the shop has sold three more and the system says 45. Applying "set
 *   48" would invent three units back and erase an hour of trade. Applying "−2"
 *   leaves 43, which is the truth.
 *
 * So a count is applied as the VARIANCE, never as the counted figure — and the
 * shop keeps trading throughout.
 */
class StockCountTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $stocker;

    private Product $rice;

    private Product $oil;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Faisalabad', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        // Floor staff: may count, may NOT sign the write-off off.
        $this->stocker = User::factory()->tenantStaff($this->shop, ['inventory.manage'])->create(['name' => 'Adnan']);

        $this->rice = $this->product('Basmati 5kg', stock: 50, cost: 900);
        $this->oil = $this->product('Cooking Oil 1L', stock: 20, cost: 480);
    }

    // ── Drawing the sheet ───────────────────────────────────────────

    public function test_a_sheet_lists_every_tracked_item_with_what_the_system_believes(): void
    {
        $count = $this->start();

        $this->assertSame('counting', $count['status']);
        $this->assertSame(2, $count['lines_total']);
        $this->assertSame(0, $count['lines_counted']);
        $this->assertStringStartsWith('SC-', $count['reference']);

        $expected = StockCountItem::withoutTenancy()
            ->where('stock_count_id', $count['id'])
            ->pluck('expected_quantity', 'product_name');

        $this->assertEquals(50, $expected['Basmati 5kg']);
        $this->assertEquals(20, $expected['Cooking Oil 1L']);
    }

    public function test_services_and_untracked_items_never_reach_a_count_sheet(): void
    {
        // A haircut has no shelf, and an item nobody asked us to track has no
        // expectation to measure a count against.
        Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Home delivery', 'sku' => 'SVC-1', 'price' => 200,
            'track_inventory' => false, 'is_active' => true,
        ]);
        $this->product('Loose sweets', stock: 0, cost: 100, track: false);

        $this->assertSame(2, $this->start()['lines_total']);
    }

    public function test_a_second_count_cannot_open_over_a_running_one(): void
    {
        $this->start();

        // Two sheets on the same shelves carry two expectations, and one of
        // them is guaranteed to be wrong by the time it is applied.
        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/counts', [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_OPEN');
    }

    public function test_a_count_can_be_narrowed_to_one_category(): void
    {
        $dairy = Category::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Dairy']);
        $this->product('Milk 1L', stock: 12, cost: 180, category: $dairy);

        $count = $this->start(['scope' => 'category', 'category_id' => $dairy->id]);

        $this->assertSame(1, $count['lines_total']);
    }

    public function test_a_scope_with_nothing_in_it_is_refused_rather_than_opened_empty(): void
    {
        $empty = Category::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Frozen']);

        $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/counts', ['scope' => 'category', 'category_id' => $empty->id])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_EMPTY');
    }

    // ── Blind counting ──────────────────────────────────────────────

    public function test_a_blind_sheet_withholds_the_figure_the_counter_is_measured_against(): void
    {
        $count = $this->start();

        $sheet = $this->actingAsUser($this->stocker)
            ->getJson("/api/v1/inventory/counts/{$count['id']}")
            ->assertOk()->json('data');

        // A counter who knows the answer stops counting when they reach it.
        $this->assertTrue($sheet['blind']);
        $this->assertArrayNotHasKey('expected_quantity', $sheet['items'][0]);
        $this->assertNull($sheet['summary']);
    }

    public function test_an_open_count_can_be_run_sighted_when_the_shop_prefers_it(): void
    {
        $count = $this->start(['blind' => false]);

        $sheet = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/inventory/counts/{$count['id']}")
            ->assertOk()->json('data');

        $this->assertFalse($sheet['blind']);
        $this->assertNotNull($sheet['items'][0]['expected_quantity']);
    }

    // ── Counting ────────────────────────────────────────────────────

    public function test_counting_happens_in_passes_and_leaves_the_rest_alone(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);

        $this->assertSame(1, StockCount::withoutTenancy()->find($count['id'])->lines_counted);

        $oil = StockCountItem::withoutTenancy()->find($lines['Cooking Oil 1L']);
        // Nobody reached that shelf. That is not the same as finding it empty.
        $this->assertNull($oil->counted_quantity);
    }

    public function test_a_recount_overwrites_the_first_look(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 49]]);

        $this->assertEquals(49, StockCountItem::withoutTenancy()->find($lines['Basmati 5kg'])->counted_quantity);
        $this->assertSame(1, StockCount::withoutTenancy()->find($count['id'])->lines_counted);
    }

    public function test_clearing_a_line_is_different_from_counting_zero(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        // An empty shelf is a real finding and must stay tellable.
        $this->record($count['id'], [['item_id' => $lines['Cooking Oil 1L'], 'counted_quantity' => 0]]);
        $this->assertEquals(0, StockCountItem::withoutTenancy()->find($lines['Cooking Oil 1L'])->counted_quantity);
        $this->assertSame(1, StockCount::withoutTenancy()->find($count['id'])->lines_counted);

        $this->record($count['id'], [['item_id' => $lines['Cooking Oil 1L'], 'counted_quantity' => null]]);
        $this->assertNull(StockCountItem::withoutTenancy()->find($lines['Cooking Oil 1L'])->counted_quantity);
        $this->assertSame(0, StockCount::withoutTenancy()->find($count['id'])->lines_counted);
    }

    public function test_a_shelf_cannot_hold_less_than_nothing(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->actingAsUser($this->stocker)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/lines", [
                'lines' => [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => -3]],
            ])
            ->assertStatus(422);
    }

    // ── Applying: the variance, never the count ─────────────────────

    public function test_applying_posts_the_variance_so_sales_during_the_count_survive(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        // Sheet says 50, counter finds 48 — two missing.
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);

        // …and the shop keeps trading while the manager reviews it.
        $this->sell($this->rice, 3);
        $this->assertEquals(47, $this->onHand($this->rice));

        $this->apply($count['id']);

        // 47 − 2 = 45. Writing "set 48" would have invented three units back
        // and erased the sales rung during the count.
        $this->assertEquals(45, $this->onHand($this->rice));
    }

    public function test_an_uncounted_line_is_left_alone_not_written_off(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 50]]);
        $this->apply($count['id']);

        // Nobody reached the oil. Reading "not counted" as zero is the fastest
        // way to make a shop stop trusting stocktakes.
        $this->assertEquals(20, $this->onHand($this->oil));
    }

    public function test_a_line_that_matched_writes_no_movement_at_all(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->record($count['id'], [
            ['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 50],   // matches
            ['item_id' => $lines['Cooking Oil 1L'], 'counted_quantity' => 18], // 2 short
        ]);
        $this->apply($count['id']);

        // Zero-delta movements would bury the real corrections in a stock
        // history nobody can then read.
        $movements = StockMovement::withoutTenancy()
            ->where('reference_type', 'stock_count')
            ->get();

        $this->assertCount(1, $movements);
        $this->assertSame($this->oil->id, $movements->first()->product_id);
        $this->assertEquals(-2, $movements->first()->quantity_change);
    }

    public function test_the_shrinkage_is_frozen_in_rupees_when_it_is_signed_off(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        $this->record($count['id'], [
            ['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48],    // −2 × 900 = −1800
            ['item_id' => $lines['Cooking Oil 1L'], 'counted_quantity' => 21], // +1 × 480 = +480
        ]);

        $applied = $this->apply($count['id']);

        $this->assertSame('applied', $applied['status']);
        $this->assertEquals(-1, $applied['variance_units']);
        $this->assertEquals(-1320, $applied['variance_value']);

        // Frozen: what a manager signed off on must still read the same after
        // the stock has moved on.
        $this->sell($this->rice, 5);
        $this->assertEquals(
            -1320,
            StockCount::withoutTenancy()->find($count['id'])->variance_value,
        );
    }

    public function test_the_same_sheet_cannot_be_applied_twice(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);

        $this->apply($count['id']);
        $this->assertEquals(48, $this->onHand($this->rice));

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/apply", [])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_CLOSED');

        $this->assertEquals(48, $this->onHand($this->rice));
    }

    public function test_a_count_that_finds_less_than_a_negative_figure_is_still_the_finding(): void
    {
        // Recipe depletion and trusted settles can drive stock below zero. A
        // count is the authority on what is physically there, so it must never
        // be refused for making an already-bad figure worse.
        $this->setOnHand($this->oil, -4);

        $count = $this->start();
        $lines = $this->lines($count['id']);
        $this->record($count['id'], [['item_id' => $lines['Cooking Oil 1L'], 'counted_quantity' => 0]]);
        $this->apply($count['id']);

        $this->assertEquals(0, $this->onHand($this->oil));
    }

    public function test_nothing_counted_is_not_a_count(): void
    {
        $count = $this->start();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/apply", [])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_EMPTY');
    }

    public function test_figures_cannot_be_entered_once_the_count_is_closed(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);
        $this->apply($count['id']);

        $this->actingAsUser($this->stocker)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/lines", [
                'lines' => [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 10]],
            ])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'STOCK_COUNT_CLOSED');
    }

    // ── Who may do what ─────────────────────────────────────────────

    public function test_counting_is_floor_work_but_signing_off_the_write_off_is_not(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);

        // The stocker counts — that is the job.
        $this->actingAsUser($this->stocker)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/lines", [
                'lines' => [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]],
            ])
            ->assertOk();

        // Applying writes stock off against the shop's own books. Not something
        // the person who counted signs for themselves.
        $this->actingAsUser($this->stocker)
            ->postJson("/api/v1/inventory/counts/{$count['id']}/apply", [])
            ->assertForbidden();

        $this->assertEquals(50, $this->onHand($this->rice));
    }

    public function test_an_applied_count_is_a_record_and_cannot_be_cancelled(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 48]]);
        $this->apply($count['id']);

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/inventory/counts/{$count['id']}")
            ->assertStatus(409);
    }

    public function test_a_cancelled_count_writes_nothing_to_stock(): void
    {
        $count = $this->start();
        $lines = $this->lines($count['id']);
        $this->record($count['id'], [['item_id' => $lines['Basmati 5kg'], 'counted_quantity' => 10]]);

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/inventory/counts/{$count['id']}")->assertOk();

        $this->assertEquals(50, $this->onHand($this->rice));
        // And the shelves are free for a fresh sheet.
        $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/counts', [])->assertCreated();
    }

    // ── Branches ────────────────────────────────────────────────────

    public function test_a_count_belongs_to_the_branch_that_holds_the_shelves(): void
    {
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $gulberg->id,
            'product_id' => $this->rice->id, 'variant_id' => null, 'quantity' => 8,
        ]);
        $manager = User::factory()->tenantStaff($this->shop, ['inventory.manage', 'settings.manage'])
            ->create(['branch_id' => $gulberg->id]);

        $count = $this->actingAsUser($manager)
            ->postJson('/api/v1/inventory/counts', [])->assertCreated()->json('data');

        $rice = StockCountItem::withoutTenancy()
            ->where('stock_count_id', $count['id'])->where('product_id', $this->rice->id)->firstOrFail();

        // Gulberg's shelf holds 8, not Main's 50.
        $this->assertEquals(8, $rice->expected_quantity);

        // A branch that has never stocked an item starts at nothing, matching
        // how InventoryService reads a missing row — otherwise the first count
        // at a new site invents a variance on every line.
        $oil = StockCountItem::withoutTenancy()
            ->where('stock_count_id', $count['id'])->where('product_id', $this->oil->id)->firstOrFail();
        $this->assertEquals(0, $oil->expected_quantity);
    }

    public function test_two_branches_can_count_at_the_same_time(): void
    {
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);
        $manager = User::factory()->tenantStaff($this->shop, ['inventory.manage', 'settings.manage'])
            ->create(['branch_id' => $gulberg->id]);

        $this->start();

        // Different shelves entirely — one shop's stocktake must not hold up
        // another site's.
        $this->actingAsUser($manager)->postJson('/api/v1/inventory/counts', [])->assertCreated();
    }

    // ── The module gate ─────────────────────────────────────────────

    public function test_a_shop_without_the_inventory_module_has_no_stocktake(): void
    {
        $this->shop->forceFill(['features' => ['pos' => true, 'products' => true, 'inventory' => false]])->save();

        $this->actingAsUser($this->owner)
            ->getJson('/api/v1/inventory/counts')
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function start(array $payload = []): array
    {
        return $this->actingAsUser($this->owner)
            ->postJson('/api/v1/inventory/counts', $payload)
            ->assertCreated()->json('data');
    }

    /** @return array<string, string> product name → line id */
    private function lines(string $countId): array
    {
        return StockCountItem::withoutTenancy()
            ->where('stock_count_id', $countId)
            ->pluck('id', 'product_name')
            ->all();
    }

    private function record(string $countId, array $lines): void
    {
        $this->actingAsUser($this->stocker)
            ->postJson("/api/v1/inventory/counts/{$countId}/lines", ['lines' => $lines])
            ->assertOk();
    }

    /** @return array<string, mixed> */
    private function apply(string $countId): array
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/inventory/counts/{$countId}/apply", [])
            ->assertOk()->json('data');
    }

    private function product(string $name, float $stock, float $cost, bool $track = true, ?Category $category = null): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'type' => 'product',
            'item_type' => 'physical',
            'name' => $name,
            'sku' => strtoupper(substr(md5($name), 0, 8)),
            'price' => $cost * 1.2,
            'cost' => $cost,
            'track_inventory' => $track,
            'stock_quantity' => $stock,
            'category_id' => $category?->id,
            'is_active' => true,
        ]);
    }

    private function sell(Product $product, float $qty): void
    {
        app(InventoryService::class)->adjust([
            'product_id' => $product->id,
            'type' => 'out',
            'quantity' => $qty,
            'reason' => 'Test sale',
        ]);
    }

    private function setOnHand(Product $product, float $qty): void
    {
        app(InventoryService::class)->adjust([
            'product_id' => $product->id,
            'type' => 'set',
            'new_quantity' => $qty,
            'reason' => 'Seed',
            'allow_negative' => true,
        ]);
    }

    private function onHand(Product $product): float
    {
        return (float) Product::withoutTenancy()->findOrFail($product->id)->stock_quantity;
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
