<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Petroleum & Energy base type. A fuel station reuses the existing platform:
 * fuel is a volume-sold physical product (fractional litres), the forecourt
 * mart + lubricants are physical products, and the wash/service bay is a
 * service line. (Tank-dip reconciliation and pump-meter shifts are a separate
 * Fuel Management module — not covered here.)
 */
class PetroleumEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $petrol;   // sold by the litre

    private Product $oil;      // a bottle of engine oil

    private Product $carWash;  // a service

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'petroleum',
            'features' => BusinessTypes::defaultFeatures('petroleum'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->petrol = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Petrol', 'price' => 290, 'stock_quantity' => 5000,
            'track_inventory' => true, 'sold_by' => 'weight', // volume → fractional litres
        ]);
        $this->oil = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Engine Oil 1L', 'price' => 1200, 'stock_quantity' => 40, 'track_inventory' => true,
        ]);
        $this->carWash = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Car Wash', 'price' => 500, 'track_inventory' => false,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_fuel_sells_by_fractional_litre_and_decrements_volume(): void
    {
        // A customer asks for "Rs 3625 of petrol" → 12.5 L at Rs 290.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 3625,
            'items' => [['product_id' => $this->petrol->id, 'quantity' => 12.5]],
        ])->assertCreated()->json('data');

        $this->assertEquals(3625, $sale['total']);
        $this->assertEquals(4987.5, $this->petrol->fresh()->stock_quantity); // 5000 - 12.5
    }

    public function test_service_line_sells_with_no_stock_impact(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $this->carWash->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(500, $sale['total']);
        $this->assertSame('service', $sale['items'][0]['item_type']);
        // Services hold no stock — selling one never decrements (stays at 0).
        $this->assertEquals(0, $this->carWash->fresh()->stock_quantity);
    }

    public function test_mixed_forecourt_sale_fuel_oil_and_wash(): void
    {
        // 20 L petrol (5800) + 1 oil (1200) + 1 wash (500) = 7500.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 7500,
            'items' => [
                ['product_id' => $this->petrol->id, 'quantity' => 20],
                ['product_id' => $this->oil->id, 'quantity' => 1],
                ['product_id' => $this->carWash->id, 'quantity' => 1],
            ],
        ])->assertCreated()->json('data');

        $this->assertEquals(7500, $sale['total']);
        $this->assertEquals(4980, $this->petrol->fresh()->stock_quantity); // 5000 - 20
        $this->assertEquals(39, $this->oil->fresh()->stock_quantity);      // 40 - 1
    }

    public function test_a_unit_sold_accessory_still_rejects_a_fractional_quantity(): void
    {
        // The bottle of oil is unit-sold — half a bottle makes no sense.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1200,
            'items' => [['product_id' => $this->oil->id, 'quantity' => 1.5]],
        ])->assertStatus(422);
    }
}
