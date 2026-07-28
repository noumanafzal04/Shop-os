<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\RecipeItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Recipe / BOM: a made-to-order dish depletes its raw ingredients when sold,
 * restores them on return/cancel, and never blocks a sale on a short
 * ingredient (the dish is already made).
 */
class RecipeBomTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food',
            'features' => BusinessTypes::defaultFeatures('food'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function ingredient(string $name, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 0, 'stock_quantity' => $stock,
        ]);
    }

    /** A made-to-order dish (no own stock) with a recipe of ingredients. */
    private function dish(string $name, float $price, array $recipe): Product
    {
        $dish = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'track_inventory' => false,
        ]);
        foreach ($recipe as $i => [$ingredient, $qty]) {
            RecipeItem::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id,
                'dish_product_id' => $dish->id,
                'ingredient_product_id' => $ingredient->id,
                'quantity' => $qty,
                'sort_order' => $i,
            ]);
        }

        return $dish;
    }

    private function sell(Product $dish, float $qty): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => $qty * (float) $dish->price,
            'items' => [['product_id' => $dish->id, 'quantity' => $qty]],
        ])->assertCreated()->json('data');
    }

    public function test_selling_a_dish_depletes_its_ingredients(): void
    {
        $bun = $this->ingredient('Bun', 100);
        $patty = $this->ingredient('Patty', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 2], [$patty, 1]]);

        $this->sell($burger, 3);

        // 3 burgers → 6 buns, 3 patties.
        $this->assertSame(94.0, (float) $bun->refresh()->stock_quantity);
        $this->assertSame(97.0, (float) $patty->refresh()->stock_quantity);
        // The dish holds no stock of its own.
        $this->assertSame(0.0, (float) $burger->refresh()->stock_quantity);
    }

    public function test_a_short_ingredient_never_blocks_the_sale(): void
    {
        $bun = $this->ingredient('Bun', 1); // only 1 bun left
        $burger = $this->dish('Burger', 500, [[$bun, 2]]);

        // Selling one burger needs 2 buns — the food is already made, so the
        // sale MUST go through; stock just goes negative to signal a recount.
        $this->sell($burger, 1);

        $this->assertSame(-1.0, (float) $bun->refresh()->stock_quantity);
    }

    public function test_returning_a_dish_restores_its_ingredients(): void
    {
        $bun = $this->ingredient('Bun', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 2]]);

        $sale = $this->sell($burger, 2); // −4 buns → 96
        $this->assertSame(96.0, (float) $bun->refresh()->stock_quantity);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        // One burger returned → 2 buns back → 98.
        $this->assertSame(98.0, (float) $bun->refresh()->stock_quantity);
    }

    public function test_cancelling_a_dish_restores_its_ingredients(): void
    {
        $bun = $this->ingredient('Bun', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 3]]);

        $sale = $this->sell($burger, 2); // −6 → 94
        $this->assertSame(94.0, (float) $bun->refresh()->stock_quantity);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        // Cancel reverses every ingredient movement → back to 100.
        $this->assertSame(100.0, (float) $bun->refresh()->stock_quantity);
    }

    public function test_recipe_is_rejected_on_a_non_food_product(): void
    {
        $flour = $this->ingredient('Flour', 100);

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product',
            'name' => 'Toy Car', 'price' => 300,
            'recipe_items' => [['ingredient_product_id' => $flour->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['recipe_items']]);
    }

    public function test_recipe_persists_through_the_product_api(): void
    {
        $bun = $this->ingredient('Bun', 100);

        $dish = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item',
            'name' => 'Slider', 'price' => 250, 'track_inventory' => false,
            'recipe_items' => [['ingredient_product_id' => $bun->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertCount(1, $dish['product']['recipe_items'] ?? $dish['recipe_items'] ?? []);
        $this->assertTrue(Product::withoutTenancy()->find($dish['product']['id'] ?? $dish['id'])->hasRecipe());
    }
}
