<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * FOOD combo/deal bundles: a deal product bundles other products at one price;
 * selling it draws each component's stock down. One shared stock pool.
 */
class ComboDealTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant', 'features' => BusinessTypes::defaultFeatures('restaurant'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function comp(string $name, float $price, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'stock_quantity' => $stock, 'track_inventory' => true,
        ]);
    }

    /** A deal product created via the API so combo_items sync is exercised. */
    private function makeDeal(array $components, float $price = 500): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Lunch Deal', 'price' => $price,
            'combo_items' => $components,
        ])->assertCreated()->json('data');
    }

    public function test_deal_persists_its_components(): void
    {
        $burger = $this->comp('Burger', 300, 10);
        $drink = $this->comp('Drink', 100, 30);

        $deal = $this->makeDeal([
            ['component_product_id' => $burger->id, 'quantity' => 1],
            ['component_product_id' => $drink->id, 'quantity' => 2],
        ]);

        $this->assertCount(2, $deal['combo_items']);
        $this->assertFalse((bool) $deal['track_inventory']); // deal holds no stock of its own
    }

    public function test_selling_a_deal_draws_component_stock_and_charges_bundle_price(): void
    {
        $burger = $this->comp('Burger', 300, 10);
        $fries = $this->comp('Fries', 150, 20);
        $drink = $this->comp('Drink', 100, 30);

        $deal = $this->makeDeal([
            ['component_product_id' => $burger->id, 'quantity' => 1],
            ['component_product_id' => $fries->id, 'quantity' => 1],
            ['component_product_id' => $drink->id, 'quantity' => 2], // 2 drinks in the deal
        ], 500);

        // Sell 2 deals → bundle price 500 × 2 = 1000.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $deal['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertSame('500.00', $sale['items'][0]['unit_price']);
        $this->assertSame('1000.00', $sale['total']);
        // Components: burger 10−2, fries 20−2, drink 30−(2×2)=26.
        $this->assertEquals(8, $burger->fresh()->stock_quantity);
        $this->assertEquals(18, $fries->fresh()->stock_quantity);
        $this->assertEquals(26, $drink->fresh()->stock_quantity);
    }

    public function test_deal_out_of_stock_component_fails_the_whole_sale(): void
    {
        $burger = $this->comp('Burger', 300, 1); // only 1 in stock
        $drink = $this->comp('Drink', 100, 30);
        $deal = $this->makeDeal([
            ['component_product_id' => $burger->id, 'quantity' => 1],
            ['component_product_id' => $drink->id, 'quantity' => 1],
        ]);

        // Try to sell 2 deals → needs 2 burgers, only 1 → fails, nothing applied.
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $deal['id'], 'quantity' => 2]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'INSUFFICIENT_STOCK');

        $this->assertEquals(1, $burger->fresh()->stock_quantity);  // untouched
        $this->assertEquals(30, $drink->fresh()->stock_quantity);  // untouched
    }

    public function test_a_deal_cannot_contain_another_deal(): void
    {
        $burger = $this->comp('Burger', 300, 10);
        $inner = $this->makeDeal([['component_product_id' => $burger->id, 'quantity' => 1]]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Mega Deal', 'price' => 900,
            'combo_items' => [['component_product_id' => $inner['id'], 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'COMBO_NESTED');
    }
}
