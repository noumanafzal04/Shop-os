<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\SaleItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\UnitCost;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * A SIZE WITH NO COST OF ITS OWN COSTS WHAT ITS DESIGN COSTS.
 *
 * A clothing shop cards a kurta once — Rs 1,600 it cost, Rs 2,950 it sells
 * for — and then a grid of sizes, each with a tag and a count. Nobody is
 * asked what each size cost: it is one design, bought at one price.
 *
 * Every sale of a size was recorded as having cost NOTHING. The line took
 * "the size, or else the design" as the thing bought and read that row's
 * cost, and a size's own is empty until a purchase order fills it. So the
 * reports added up Rs 2,950 of profit on a Rs 2,950 kurta — on every sized
 * item, in every shop that has them, on the till, on an order and on a tab.
 *
 * The stock report and a write-off already used the design's cost for a size
 * without one. This holds the selling paths to the same rule.
 */
class ASizeCostsWhatItsDesignCostsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** One design at Rs 1,600, in two sizes. Carded through the API, the way the item form does. */
    private function kurta(): array
    {
        return $this->asOwner()->postJson('/api/v1/products', [
            'name' => 'Cotton Kurta', 'item_type' => 'physical_product', 'price' => 2950, 'cost' => 1600,
            'track_inventory' => true,
            'variants' => [
                ['name' => 'M', 'price' => 2950, 'stock_quantity' => 10],
                ['name' => 'XL', 'price' => 3150, 'stock_quantity' => 10],
            ],
        ])->assertCreated()->json('data');
    }

    private function sizeOf(array $design, string $name): string
    {
        return collect($design['variants'])->firstWhere('name', $name)['id'];
    }

    private function costOnTheSaleLine(string $saleId): ?string
    {
        return SaleItem::withoutTenancy()->where('sale_id', $saleId)->sole()->unit_cost;
    }

    // ── the rule ────────────────────────────────────────────────────────

    public function test_the_rule_is_the_sizes_own_cost_then_the_designs_then_nothing(): void
    {
        $design = new Product(['cost' => 1600]);

        $this->assertSame(1600.0, UnitCost::of($design), 'a design with no sizes costs what it cost');
        $this->assertSame(1600.0, UnitCost::of($design, new ProductVariant(['cost' => null])), 'a size with no cost of its own was costed at nothing');
        $this->assertSame(1750.0, UnitCost::of($design, new ProductVariant(['cost' => 1750])), 'a size bought at its own price lost it to the design\'s');
        $this->assertSame(0.0, UnitCost::of($design, new ProductVariant(['cost' => 0])), 'a size that really cost nothing — a free sample — was given the design\'s cost');
        $this->assertNull(UnitCost::of(new Product(['cost' => null]), new ProductVariant(['cost' => null])));
        $this->assertSame(19200.0, UnitCost::ofPack($design, null, 12.0), 'a dozen costs twelve');
        $this->assertNull(UnitCost::ofPack(new Product(['cost' => null]), null, 12.0));
    }

    // ── at the till ─────────────────────────────────────────────────────

    public function test_a_size_sold_at_the_till_is_recorded_at_its_designs_cost(): void
    {
        $kurta = $this->kurta();

        $sale = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $kurta['id'], 'variant_id' => $this->sizeOf($kurta, 'M'), 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 5900,
        ])->assertCreated()->json('data');

        $this->assertSame('1600.00', $this->costOnTheSaleLine($sale['id']), 'a size was sold at a cost of nothing — the whole price reads as profit');
    }

    public function test_a_size_with_a_cost_of_its_own_keeps_it(): void
    {
        $kurta = $this->kurta();
        ProductVariant::withoutTenancy()->whereKey($this->sizeOf($kurta, 'XL'))->update(['cost' => 1750]);

        $sale = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $kurta['id'], 'variant_id' => $this->sizeOf($kurta, 'XL'), 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 3150,
        ])->assertCreated()->json('data');

        $this->assertSame('1750.00', $this->costOnTheSaleLine($sale['id']));
    }

    public function test_the_days_profit_takes_the_cost_of_a_size_off(): void
    {
        $kurta = $this->kurta();
        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $kurta['id'], 'variant_id' => $this->sizeOf($kurta, 'M'), 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 5900,
        ])->assertCreated();

        // What every profit figure in the product adds up: cost × quantity, off the sale lines.
        $costOfGoods = (float) DB::table('sale_items')->where('tenant_id', $this->shop->id)->sum(DB::raw('unit_cost * quantity'));

        $this->assertSame(3200.0, $costOfGoods, 'two kurtas at Rs 1,600 cost Rs 3,200 — the reports would say they cost nothing');
    }

    // ── on an order ─────────────────────────────────────────────────────

    public function test_a_size_taken_on_an_order_is_recorded_at_its_designs_cost(): void
    {
        $kurta = $this->kurta();

        $order = $this->asOwner()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233',
            'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $kurta['id'], 'variant_id' => $this->sizeOf($kurta, 'M'), 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame(
            1600.0,
            (float) DB::table('order_items')->where('order_id', $order['id'])->value('unit_cost'),
            'a size ordered by phone was recorded at a cost of nothing',
        );
    }

    // ── on a tab ────────────────────────────────────────────────────────

    public function test_a_size_put_on_a_tab_is_recorded_at_its_designs_cost(): void
    {
        // A café's drink in two sizes is the same thing as a kurta in two.
        $kurta = $this->kurta();
        $table = DiningTable::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'T1', 'seats' => 4]);
        $tab = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $kurta['id'], 'variant_id' => $this->sizeOf($kurta, 'M'), 'quantity' => 1]],
        ])->assertSuccessful();

        $this->assertSame(
            1600.0,
            (float) DB::table('restaurant_ticket_items')->where('ticket_id', $tab['id'])->value('unit_cost'),
            'a size put on a tab was recorded at a cost of nothing',
        );
    }

    // ── and nobody reads a size's cost on its own again ─────────────────

    public function test_no_selling_path_reads_the_cost_of_size_or_else_design(): void
    {
        // The shape of the fault: take "the size, or else the design" and read
        // ITS cost. Written three times, in three files, before it was found.
        $offenders = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $source = file_get_contents($file->getPathname());
            if (preg_match('/\$(source|bought)\s*=\s*\$variant\s*\?\?\s*\$product\s*;/', $source) && preg_match('/\$(source|bought)->cost\b/', $source)) {
                $offenders[] = str_replace(app_path().'/', '', $file->getPathname());
            }
        }

        $this->assertSame([], $offenders, 'these read the cost of "the size or else the design" — a size with none of its own costs nothing there. Ask UnitCost.');
    }
}
