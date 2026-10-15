<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\PurchaseOrderItem;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * FUEL IN A TANK COMES IN BY TANKER, WITH THE DIPS — FOR EVERYONE.
 *
 * Tester pass 2 (B41), Canal Road Fuels: the forecourt attendant is refused a
 * tanker delivery (403) and took 1,000 L of petrol into stock anyway, through
 * a purchase order's Receive — stock 27,841.538 → 28,841.538, no dip, no
 * tank. The owner (2026-10-14): fuel only by tanker; the shop's other goods
 * are still received by whoever keeps the stock.
 */
class FuelComesInByTankerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $station;

    private User $owner;

    private User $attendant;

    private Product $petrol;

    private Product $oil;

    private string $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->station = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'petroleum',
            'features' => BusinessTypes::defaultFeatures('petroleum'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->station)->create();
        $this->attendant = User::factory()->create([
            'tenant_id' => $this->station->id, 'role' => 'staff',
            'permissions' => collect(StaffPresets::all())->firstWhere('code', 'forecourt_attendant')['permissions'],
        ]);

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product', 'name' => 'Petrol', 'price' => 268.50, 'cost' => 250,
            'unit' => 'Litre', 'sold_by' => 'weight', 'track_inventory' => true, 'stock_quantity' => 10000, 'is_active' => true,
        ]);
        FuelTank::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'branch_id' => $this->main(), 'product_id' => $this->petrol->id,
            'name' => 'Tank 1 — Petrol', 'capacity_litres' => 30000, 'current_dip_litres' => 10000, 'dead_stock_litres' => 0, 'is_active' => true,
        ]);
        $this->oil = Product::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'type' => 'product', 'name' => 'Engine Oil 4L', 'price' => 6200, 'cost' => 5400,
            'track_inventory' => true, 'stock_quantity' => 12, 'is_active' => true,
        ]);
        $this->supplier = Supplier::withoutTenancy()->create(['tenant_id' => $this->station->id, 'name' => 'PSO Depot', 'is_active' => true])->id;
    }

    private function main(): string
    {
        return Branch::withoutTenancy()->where('tenant_id', $this->station->id)->where('is_default', true)->value('id');
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function order(Product $product, float $quantity, float $cost): TestResponse
    {
        return $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => '2026-10-14', 'status' => 'ordered',
            'items' => [['product_id' => $product->id, 'quantity' => $quantity, 'unit_cost' => $cost]],
        ]);
    }

    public function test_an_order_for_tank_fuel_is_refused_when_it_is_made(): void
    {
        $this->order($this->petrol, 1000, 260)
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'FUEL_COMES_BY_TANKER');
        $this->assertSame(0, PurchaseOrder::withoutTenancy()->count());
    }

    public function test_tank_fuel_already_on_an_order_is_never_received_into_stock(): void
    {
        // An order raised before this rule, still open.
        $po = PurchaseOrder::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'supplier_id' => $this->supplier, 'po_number' => 'PO-000001',
            'status' => 'ordered', 'order_date' => '2026-10-14', 'subtotal' => 260000, 'total' => 260000,
        ]);
        PurchaseOrderItem::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'purchase_order_id' => $po->id, 'product_id' => $this->petrol->id,
            'product_name' => 'Petrol', 'quantity_ordered' => 1000, 'unit_cost' => 260, 'line_total' => 260000,
        ]);

        foreach ([$this->attendant, $this->owner] as $who) {
            $this->as($who)->postJson("/api/v1/purchase-orders/{$po->id}/receive", [])
                ->assertStatus(422)->assertJsonPath('meta.error_code', 'FUEL_COMES_BY_TANKER');
        }
        $this->assertEquals(10000, (float) $this->petrol->fresh()->stock_quantity, 'petrol came into stock with no dip');
    }

    public function test_the_stations_other_goods_are_still_bought_and_received(): void
    {
        $po = $this->order($this->oil, 6, 5400)->assertCreated()->json('data');

        $this->as($this->attendant)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", [])->assertOk();
        $this->assertEquals(18, (float) $this->oil->fresh()->stock_quantity);
    }

    /** Both have been bought before, and both have run below the level the shop set. */
    private function bothRunLow(): void
    {
        $po = PurchaseOrder::withoutTenancy()->create([
            'tenant_id' => $this->station->id, 'supplier_id' => $this->supplier, 'po_number' => 'PO-000009',
            'status' => 'received', 'order_date' => '2026-10-01', 'subtotal' => 0, 'total' => 0,
        ]);
        foreach ([[$this->petrol, 250], [$this->oil, 5400]] as [$product, $cost]) {
            PurchaseOrderItem::withoutTenancy()->create([
                'tenant_id' => $this->station->id, 'purchase_order_id' => $po->id, 'product_id' => $product->id,
                'product_name' => $product->name, 'quantity_ordered' => 1, 'unit_cost' => $cost, 'line_total' => $cost,
            ]);
        }
        $this->petrol->update(['low_stock_threshold' => 30000]);
        $this->oil->update(['low_stock_threshold' => 20]);
    }

    public function test_fuel_on_the_reorder_list_is_left_out_by_name_and_the_rest_is_still_ordered(): void
    {
        // Tester pass 4 (B54): one fuel line refused the whole press — the
        // engine oil beside it was never drafted.
        $this->bothRunLow();

        $res = $this->as($this->owner)->postJson('/api/v1/purchase-orders/from-reorder-list', [
            'product_ids' => [$this->petrol->id, $this->oil->id],
        ])->assertCreated();

        $this->assertStringContainsString('kept in a tank', $res->json('message'));
        $this->assertStringContainsString('Petrol', $res->json('message'));
        $this->assertCount(1, $res->json('data'));
        $lines = PurchaseOrderItem::withoutTenancy()->where('purchase_order_id', $res->json('data.0.id'))->pluck('product_id')->all();
        $this->assertSame([$this->oil->id], $lines, 'the draft is not the engine oil alone');
    }

    public function test_a_reorder_list_of_fuel_alone_is_sent_to_the_tanker(): void
    {
        $this->bothRunLow();
        $before = PurchaseOrder::withoutTenancy()->count();

        $this->as($this->owner)->postJson('/api/v1/purchase-orders/from-reorder-list', ['product_ids' => [$this->petrol->id]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'FUEL_COMES_BY_TANKER');
        $this->assertSame($before, PurchaseOrder::withoutTenancy()->count());
    }

    public function test_the_reorder_list_says_which_rows_come_by_tanker(): void
    {
        $this->bothRunLow();

        $rows = collect($this->as($this->owner)->getJson('/api/v1/inventory/low-stock')->assertOk()->json('data'))->keyBy('name');

        $this->assertTrue($rows['Petrol']['by_tanker']);
        $this->assertFalse($rows['Engine Oil 4L']['by_tanker']);
    }
}
