<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class ReportsExpansionTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Item', 'price' => 100, 'cost' => 60, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_tax_report_sums_tax_collected(): void
    {
        // One taxable product (18%) and one exempt (0%) → only one taxable sale.
        Product::withoutTenancy()->whereKey($this->product->id)->update(['tax_rate' => 18]);
        $exempt = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Exempt', 'price' => 100, 'cost' => 60, 'stock_quantity' => 100,
            'track_inventory' => true, 'tax_rate' => 0,
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], 'amount_paid' => 118,
        ])->assertCreated();
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $exempt->id, 'quantity' => 1]], 'amount_paid' => 100,
        ])->assertCreated();

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/reports/tax?period=monthly')->assertOk()->json('data');
        $this->assertEquals(18, $data['totals']['tax_collected']);
        $this->assertSame(1, $data['totals']['taxable_sales']);
    }

    public function test_staff_report_groups_sales_by_cashier(): void
    {
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Cashier Sara']);
        $this->actingAsUser($cashier)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 2]], 'amount_paid' => 200,
        ])->assertCreated();

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/reports/staff?period=monthly')->assertOk()->json('data');
        $sara = collect($data['staff'])->firstWhere('staff_id', $cashier->id);
        $this->assertNotNull($sara);
        $this->assertSame('Cashier Sara', $sara['name']);
        $this->assertEquals(200, $sara['revenue']);
        $this->assertSame(1, $sara['sales_count']);
    }

    public function test_purchases_report_totals_and_by_supplier(): void
    {
        $supplierId = $this->actingAsUser($this->owner)->postJson('/api/v1/suppliers', ['name' => 'Acme'])->json('data.id');
        $po = $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->product->id, 'quantity' => 10, 'unit_cost' => 50]],
        ])->json('data'); // total 500
        $this->actingAsUser($this->owner)->postJson("/api/v1/suppliers/{$supplierId}/payments", [
            'amount' => 200, 'purchase_order_id' => $po['id'],
        ])->assertCreated();

        $data = $this->actingAsUser($this->owner)->getJson('/api/v1/reports/purchases?period=monthly')->assertOk()->json('data');
        $this->assertEquals(500, $data['totals']['ordered_value']);
        $this->assertEquals(200, $data['totals']['paid']);
        $this->assertEquals(300, $data['totals']['outstanding']);
        $this->assertSame('Acme', $data['by_supplier'][0]['supplier']);
        $this->assertEquals(300, $data['by_supplier'][0]['outstanding']);
    }

    public function test_reports_require_permission(): void
    {
        $staff = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/reports/tax?period=monthly')->assertStatus(403);
    }

    public function test_reports_isolated_per_tenant(): void
    {
        $supplierId = $this->actingAsUser($this->owner)->postJson('/api/v1/suppliers', ['name' => 'Acme'])->json('data.id');
        $this->actingAsUser($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'unit_cost' => 50]],
        ])->assertCreated();

        $other = User::factory()->shopOwner()->create();
        $data = $this->actingAsUser($other)->getJson('/api/v1/reports/purchases?period=monthly')->json('data');
        $this->assertEquals(0, $data['totals']['ordered_value']);
    }
}
