<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\RecipeItem;
use App\Models\SaleItem;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A DEAL COOKS ITS DISHES (restaurant #RS1).
 *
 * The biryani sold on its own took chicken and rice off the shelf; the same
 * biryani inside the Family Deal took nothing, and the deal carried no cost —
 * the margins report printed "QA Family Deal · cogs 0 · margin 100%". One
 * level of nesting (deal → stocked item) was handled, the second (deal → dish
 * → ingredients) was not.
 */
class ADealCooksItsDishesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $chicken;

    private Product $rice;

    private Product $water;

    private Product $biryani;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food', 'features' => BusinessTypes::defaultFeatures('food'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->chicken = $this->stocked('Raw Chicken', 10, 800);
        $this->rice = $this->stocked('Rice', 10, 300);
        $this->water = $this->stocked('Bottled Water', 24, 55);
        $this->biryani = $this->dish('Chicken Biryani', [[$this->chicken, 0.25], [$this->rice, 0.2]]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function stocked(string $name, float $stock, ?float $cost): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 100, 'cost' => $cost, 'stock_quantity' => $stock, 'track_inventory' => true,
        ]);
    }

    private function dish(string $name, array $recipe): Product
    {
        $dish = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => 650, 'track_inventory' => false,
        ]);
        foreach ($recipe as $i => [$ingredient, $qty]) {
            RecipeItem::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'dish_product_id' => $dish->id,
                'ingredient_product_id' => $ingredient->id, 'quantity' => $qty, 'sort_order' => $i,
            ]);
        }

        return $dish;
    }

    private function deal(array $parts): string
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'name' => 'Family Deal '.count($parts), 'item_type' => 'deal', 'price' => 2199.99,
            'combo_items' => array_map(fn ($p) => ['component_product_id' => $p[0]->id, 'quantity' => $p[1]], $parts),
        ])->assertCreated()->json('data.id');
    }

    private function sell(string $productId, float $qty): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 100000,
            'items' => [['product_id' => $productId, 'quantity' => $qty]],
        ])->assertCreated()->json('data');
    }

    public function test_a_dish_inside_a_deal_takes_its_ingredients_off_the_shelf(): void
    {
        $deal = $this->deal([[$this->biryani, 1], [$this->water, 1]]);

        $this->sell($deal, 2);

        $this->assertEqualsWithDelta(9.5, (float) $this->chicken->refresh()->stock_quantity, 0.0001);
        $this->assertEqualsWithDelta(9.6, (float) $this->rice->refresh()->stock_quantity, 0.0001);
        $this->assertEqualsWithDelta(22, (float) $this->water->refresh()->stock_quantity, 0.0001);
        $this->assertStringContainsString('recipe: Chicken Biryani', (string) StockMovement::withoutTenancy()
            ->where('product_id', $this->chicken->id)->value('reason'));
    }

    public function test_a_deal_costs_what_is_inside_it(): void
    {
        $deal = $this->deal([[$this->biryani, 1], [$this->water, 2]]);

        $this->sell($deal, 1);

        // Biryani by its recipe: 0.25 × 800 + 0.2 × 300 = 260; two waters at 55.
        $this->assertEquals(370, (float) SaleItem::withoutTenancy()->value('unit_cost'));
    }

    /** #RS13: the deal's own card says what it costs, before anybody sells one — and what stops it. */
    public function test_a_deals_card_says_what_it_costs_and_what_is_missing(): void
    {
        $deal = $this->deal([[$this->biryani, 1], [$this->water, 2]]);
        $this->actingAsUser($this->owner)->getJson("/api/v1/products/{$deal}")->assertOk()
            ->assertJsonPath('data.recipe_cost', 370)
            ->assertJsonPath('data.recipe_cost_missing', []);

        $karahi = $this->stocked('Karahi (no cost)', 5, null);
        $short = $this->deal([[$this->biryani, 1], [$karahi, 1]]);
        $this->actingAsUser($this->owner)->getJson("/api/v1/products/{$short}")->assertOk()
            ->assertJsonPath('data.recipe_cost', null)
            ->assertJsonPath('data.recipe_cost_missing', ['Karahi (no cost)']);
    }

    /** Unknown is not zero: one part with no cost and the deal claims no computed figure. */
    public function test_a_deal_with_a_part_nobody_costed_does_not_invent_a_cost(): void
    {
        $karahi = $this->stocked('Karahi (no cost)', 5, null);
        $deal = $this->deal([[$this->biryani, 1], [$karahi, 1]]);

        $this->sell($deal, 1);

        $this->assertNull(SaleItem::withoutTenancy()->value('unit_cost'));
    }

    /** Returned, the deal puts the dish's ingredients back — and two dishes that share rice give all of it back. */
    public function test_returning_a_deal_puts_every_ingredient_back(): void
    {
        $pulao = $this->dish('Pulao', [[$this->rice, 0.3]]);
        $deal = $this->deal([[$this->biryani, 1], [$pulao, 1]]);
        $sale = $this->sell($deal, 1);
        $this->assertEqualsWithDelta(9.5, (float) $this->rice->refresh()->stock_quantity, 0.0001);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'reason' => 'Wrong order', 'refund_method' => 'cash',
        ])->assertCreated();

        $this->assertEqualsWithDelta(10, (float) $this->rice->refresh()->stock_quantity, 0.0001);
        $this->assertEqualsWithDelta(10, (float) $this->chicken->refresh()->stock_quantity, 0.0001);
    }
}
