<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\MovingCost;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * What the stock on the shelf actually cost.
 *
 * Every margin, profit and COGS figure comes from `products.cost`, and nothing
 * ever wrote to it except a human on the product form. A kiryana bought sugar
 * at Rs 140/kg in March; every delivery since was 148, 155, 162, each recorded
 * at its true price on the purchase order — and the product's cost stayed 140
 * all year, so the Margins report said he was making Rs 22/kg while he was
 * making eight.
 *
 * The real answer was in the database at every single delivery. Nothing read it.
 */
class MovingCostTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $mart;

    private User $owner;

    private Supplier $wholesaler;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->mart = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->mart)->create();
        $this->wholesaler = Supplier::withoutTenancy()->create([
            'tenant_id' => $this->mart->id, 'name' => 'Akbari Mandi',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    private function sugar(?float $cost, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->mart->id, 'type' => 'product',
            'item_type' => 'physical_product', 'name' => 'Sugar',
            'price' => 175, 'cost' => $cost, 'sold_by' => 'weight',
            'stock_quantity' => $stock, 'track_inventory' => true,
        ]);
    }

    /** Order and receive `qty` at `unitCost`, optionally in packs of `factor`. */
    private function receive(Product $product, float $qty, float $unitCost, ?string $unitId = null): void
    {
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->wholesaler->id,
            'order_date' => now()->toDateString(),
            'items' => [array_filter([
                'product_id' => $product->id,
                'quantity' => $qty,
                'unit_cost' => $unitCost,
                'product_unit_id' => $unitId,
            ], fn ($v) => $v !== null)],
        ])->assertCreated()->json('data');

        // A draft cannot receive goods — it is placed first, like a real one.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/purchase-orders/{$po['id']}/place", [])->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])
            ->assertOk();
    }

    // ── The rule, on its own ────────────────────────────────────────────

    public function test_the_shelf_holds_both_prices_so_the_cost_is_the_blend(): void
    {
        // 40kg at 140 and 60kg at 160 is not stock worth 160. It is worth 152,
        // and a margin calculated on 160 gives away the eight rupees of it that
        // were already earned.
        $this->assertEqualsWithDelta(152.0, MovingCost::blend(140, 40, 160, 60), 0.01);
    }

    public function test_an_empty_shelf_takes_the_new_price_outright(): void
    {
        $this->assertEqualsWithDelta(160.0, MovingCost::blend(140, 0, 160, 50), 0.01);
    }

    public function test_an_oversold_line_does_not_drag_the_blend_negative(): void
    {
        // Negative on-hand happens. It must not weight the average.
        $this->assertEqualsWithDelta(160.0, MovingCost::blend(140, -5, 160, 50), 0.01);
    }

    public function test_a_first_ever_cost_is_simply_the_price_paid(): void
    {
        $this->assertEqualsWithDelta(160.0, MovingCost::blend(null, 100, 160, 50), 0.01);
    }

    public function test_a_delivery_with_no_price_never_wipes_a_known_cost(): void
    {
        // Missing information is not evidence that the goods were free — and
        // letting it through would destroy the very figure this keeps true.
        $this->assertEqualsWithDelta(140.0, MovingCost::blend(140, 40, null, 60), 0.01);
    }

    // ── Where it matters ────────────────────────────────────────────────

    public function test_receiving_a_delivery_moves_the_cost_towards_what_was_paid(): void
    {
        $sugar = $this->sugar(cost: 140, stock: 40);

        $this->receive($sugar, qty: 60, unitCost: 160);

        // (140×40 + 160×60) / 100
        $this->assertEqualsWithDelta(152.0, (float) $sugar->fresh()->cost, 0.01);
        $this->assertEqualsWithDelta(100.0, (float) $sugar->fresh()->stock_quantity, 0.01);
    }

    public function test_a_sale_after_the_delivery_files_the_real_cost(): void
    {
        // The whole point — every margin figure is built from this.
        $sugar = $this->sugar(cost: 140, stock: 40);
        $this->receive($sugar, qty: 60, unitCost: 160);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $sugar->id, 'quantity' => 1]],
            'amount_paid' => 175,
        ])->assertCreated()->json('data');

        // Not 140, which is what March's rate would still have said.
        $this->assertEquals(152, $sale['items'][0]['unit_cost']);
    }

    public function test_the_figure_converges_as_the_old_stock_sells_through(): void
    {
        // Self-correcting without anybody keying anything, which is the reason
        // a weighted average beats a last-price rule.
        $sugar = $this->sugar(cost: 140, stock: 10);

        $this->receive($sugar, qty: 90, unitCost: 160);   // → 158
        $this->assertEqualsWithDelta(158.0, (float) $sugar->fresh()->cost, 0.01);

        $this->receive($sugar, qty: 400, unitCost: 160);  // → ~159.6
        $this->assertEqualsWithDelta(159.6, (float) $sugar->fresh()->cost, 0.1);
    }

    public function test_a_pack_priced_order_blends_per_base_unit(): void
    {
        // A line ordered in packs receives base units. Blending a pack price
        // against a per-unit cost would multiply the error by the pack size.
        $sugar = $this->sugar(cost: 140, stock: 0);

        $bag = ProductUnit::withoutTenancy()->create([
            'tenant_id' => $this->mart->id, 'product_id' => $sugar->id,
            'name' => 'Bag', 'factor' => 50,
        ]);

        // Two 50kg bags at 8,000 each — 160/kg, not 8,000/kg.
        $this->receive($sugar, qty: 2, unitCost: 8000, unitId: $bag->id);

        $this->assertEqualsWithDelta(160.0, (float) $sugar->fresh()->cost, 0.01);
        $this->assertEqualsWithDelta(100.0, (float) $sugar->fresh()->stock_quantity, 0.01);
    }
}
