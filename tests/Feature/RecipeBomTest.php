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

    public function test_return_restocks_the_recipe_as_sold_not_as_later_edited(): void
    {
        $bun = $this->ingredient('Bun', 100);
        $patty = $this->ingredient('Patty', 100);
        $cheese = $this->ingredient('Cheese', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 2], [$patty, 1]]);

        $sale = $this->sell($burger, 2); // −4 bun (96), −2 patty (98)
        $this->assertSame(96.0, (float) $bun->refresh()->stock_quantity);
        $this->assertSame(98.0, (float) $patty->refresh()->stock_quantity);

        // The recipe is EDITED after the sale: now 5 buns + cheese, no patty.
        RecipeItem::withoutTenancy()->where('dish_product_id', $burger->id)->delete();
        RecipeItem::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'dish_product_id' => $burger->id, 'ingredient_product_id' => $bun->id, 'quantity' => 5, 'sort_order' => 0]);
        RecipeItem::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'dish_product_id' => $burger->id, 'ingredient_product_id' => $cheese->id, 'quantity' => 1, 'sort_order' => 1]);

        // Return 1 of the 2 burgers. The restock must mirror what was ACTUALLY
        // sold (2 bun + 1 patty per burger), NOT the edited recipe (5 bun +
        // cheese) — the BOM snapshot on the sale line is the source of truth.
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        $this->assertSame(98.0, (float) $bun->refresh()->stock_quantity);    // 96 + 2 (not +5)
        $this->assertSame(99.0, (float) $patty->refresh()->stock_quantity);  // 98 + 1
        $this->assertSame(100.0, (float) $cheese->refresh()->stock_quantity); // never sold → untouched
    }

    public function test_cancelling_a_dish_restores_its_ingredients(): void
    {
        $bun = $this->ingredient('Bun', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 3]]);

        $sale = $this->sell($burger, 2); // −6 → 94
        $this->assertSame(94.0, (float) $bun->refresh()->stock_quantity);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

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
        $this->withInventory();
        $bun = $this->ingredient('Bun', 100);

        $dish = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item',
            'name' => 'Slider', 'price' => 250, 'track_inventory' => false,
            'recipe_items' => [['ingredient_product_id' => $bun->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        $this->assertCount(1, $dish['product']['recipe_items'] ?? $dish['recipe_items'] ?? []);
        $this->assertTrue(Product::withoutTenancy()->find($dish['product']['id'] ?? $dish['id'])->hasRecipe());
    }

    // ── A recipe that actually deducts something ────────────────────
    //
    // Two defaults used to make a recipe inert for a brand-new restaurant, and
    // neither said so on screen: food shops start with the Inventory module
    // OFF, and food items start untracked. A merchant could write out a full
    // recipe, save it without complaint, and sell a thousand burgers while
    // every ingredient stayed at its opening figure.

    /** Grants the stock module — what an admin does for a kitchen that counts. */
    private function withInventory(): void
    {
        $this->tenant->forceFill([
            'features' => array_merge($this->tenant->features ?? [], ['inventory' => true]),
        ])->save();
        $this->tenant->refresh();
    }

    /** A menu item as a food shop actually creates one: no stock of its own. */
    private function untrackedItem(string $name): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => 0, 'track_inventory' => false, 'stock_quantity' => 0,
        ]);
    }

    public function test_a_shop_without_the_stock_module_cannot_keep_a_recipe(): void
    {
        // The default food shop. There is no stock for a recipe to draw down,
        // so it is refused rather than stored as decoration.
        $this->assertFalse($this->tenant->featureEnabled('inventory'));
        $flour = $this->ingredient('Flour', 100);

        $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Naan', 'price' => 60, 'track_inventory' => false,
            'recipe_items' => [['ingredient_product_id' => $flour->id, 'quantity' => 0.2]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RECIPE_NEEDS_INVENTORY');
    }

    public function test_clearing_a_recipe_survives_losing_the_stock_module(): void
    {
        // A shop whose module is switched off after the fact must still be
        // able to tidy up — the refusal is on keeping a recipe, not on
        // abandoning one.
        $this->withInventory();
        $bun = $this->ingredient('Bun', 100);
        $burger = $this->dish('Burger', 500, [[$bun, 2]]);

        $this->tenant->forceFill([
            'features' => array_merge($this->tenant->features ?? [], ['inventory' => false]),
        ])->save();

        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$burger->id}", [
            'recipe_items' => [],
        ])->assertOk();

        $this->assertFalse($burger->refresh()->hasRecipe());
    }

    public function test_naming_an_ingredient_starts_counting_it(): void
    {
        $this->withInventory();
        // Created the way a restaurant creates everything: untracked.
        $chicken = $this->untrackedItem('Chicken (raw)');
        $this->assertFalse($chicken->track_inventory);

        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Karahi', 'price' => 1200, 'track_inventory' => false,
            'recipe_items' => [['ingredient_product_id' => $chicken->id, 'quantity' => 0.5]],
        ])->assertCreated();

        // Being named as an ingredient IS the declaration that it gets
        // consumed and counted.
        $this->assertTrue($chicken->refresh()->track_inventory);
        // And the merchant is told, because it changes how that item behaves
        // when sold on its own.
        $this->assertStringContainsString(
            'Chicken (raw)',
            implode(' ', $response->json('meta.warnings') ?? []),
        );
    }

    public function test_the_whole_journey_a_restaurant_actually_takes(): void
    {
        // Admin grants the stock module → the kitchen writes a recipe against
        // items it never tracked → selling the dish moves real stock.
        $this->withInventory();
        $rice = $this->untrackedItem('Rice');
        $chicken = $this->untrackedItem('Chicken (raw)');

        $dish = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Biryani', 'price' => 450, 'track_inventory' => false,
            'recipe_items' => [
                ['ingredient_product_id' => $rice->id, 'quantity' => 0.25],
                ['ingredient_product_id' => $chicken->id, 'quantity' => 0.2],
            ],
        ])->assertCreated()->json('data');

        // Opening stock, now that there is something to count.
        foreach ([[$rice, 50], [$chicken, 30]] as [$item, $qty]) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/inventory/adjust', [
                'product_id' => $item->id, 'type' => 'in', 'quantity' => $qty, 'reason' => 'Opening',
            ])->assertSuccessful();
        }

        $this->sell(Product::withoutTenancy()->find($dish['id']), 4);

        // 4 plates → 1kg rice, 0.8kg chicken.
        $this->assertEqualsWithDelta(49.0, (float) $rice->refresh()->stock_quantity, 0.001);
        $this->assertEqualsWithDelta(29.2, (float) $chicken->refresh()->stock_quantity, 0.001);
    }

    public function test_a_service_ingredient_is_named_as_uncountable_rather_than_ignored(): void
    {
        $this->withInventory();
        $labour = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Chef time', 'price' => 0, 'track_inventory' => false,
        ]);

        $response = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Tasting menu', 'price' => 3000, 'track_inventory' => false,
            'recipe_items' => [['ingredient_product_id' => $labour->id, 'quantity' => 1]],
        ])->assertCreated();

        // Nothing to count, so nothing is switched on — and the merchant is
        // told, rather than left believing the labour line is consumed.
        $this->assertFalse($labour->refresh()->track_inventory);
        $this->assertStringContainsString(
            'Not deducted from stock',
            implode(' ', $response->json('meta.warnings') ?? []),
        );
    }
}
