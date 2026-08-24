<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\RecipeItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\RecipeCost;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A size is what a kitchen scales.
 *
 * A recipe belonged to a DISH, so a pizzeria that wrote one recipe for a pizza
 * sold in three sizes had every size draw the same flour. Measured before any
 * of this was built: one Small and one Large, both `2 dough`.
 */
class SizedRecipeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'food',
            'features' => ['inventory' => true] + BusinessTypes::defaultFeatures('food'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function ingredient(string $name, float $stock, ?float $cost = null): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 0, 'stock_quantity' => $stock,
            'track_inventory' => true, 'cost' => $cost,
        ]);
    }

    /** A pizza in two sizes, with the Large spelled out separately. */
    private function pizza(Product $dough, float $smallQty, ?float $largeQty): array
    {
        $created = $this->asOwner()->postJson('/api/v1/products', [
            'name' => 'Pizza', 'item_type' => 'food_item', 'type' => 'product',
            'price' => 500, 'track_inventory' => false,
            'variants' => [
                ['name' => 'Small', 'price' => 400],
                ['name' => 'Large', 'price' => 900],
            ],
        ])->assertCreated()->json('data');

        $dish = Product::withoutTenancy()->whereKey($created['id'])->first();
        $sizes = ProductVariant::withoutTenancy()->where('product_id', $dish->id)->get();
        $small = $sizes->firstWhere('name', 'Small');
        $large = $sizes->firstWhere('name', 'Large');

        $rows = [['ingredient_product_id' => $dough->id, 'quantity' => $smallQty]];
        if ($largeQty !== null) {
            $rows[] = ['ingredient_product_id' => $dough->id, 'quantity' => $largeQty, 'variant_id' => $large->id];
        }

        $this->asOwner()->putJson("/api/v1/products/{$dish->id}", ['recipe_items' => $rows])->assertOk();

        return [$dish, $small, $large];
    }

    private function sell(Product $dish, ProductVariant $size, float $qty): array
    {
        return $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => $qty * (float) $size->price,
            'items' => [['product_id' => $dish->id, 'variant_id' => $size->id, 'quantity' => $qty]],
        ])->assertCreated()->json('data');
    }

    public function test_a_large_draws_more_than_a_small(): void
    {
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $this->sell($dish, $small, 1);
        $this->assertSame(98.0, (float) $dough->refresh()->stock_quantity, 'a Small takes the dish recipe');

        $this->sell($dish, $large, 1);
        $this->assertSame(93.0, (float) $dough->refresh()->stock_quantity, 'a Large takes its own');
    }

    public function test_a_size_with_nothing_of_its_own_falls_back_to_the_dish(): void
    {
        // The Medium is never spelled out. It must not consume NOTHING — every
        // recipe in the database is dish-level, and "no rows for this size"
        // has to keep meaning "the dish's recipe".
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $this->sell($dish, $small, 3);

        $this->assertSame(94.0, (float) $dough->refresh()->stock_quantity);
    }

    public function test_a_dish_with_no_sizes_is_untouched(): void
    {
        $flour = $this->ingredient('Flour', 50);
        $dish = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Biryani', 'price' => 500, 'track_inventory' => false,
        ]);
        RecipeItem::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'dish_product_id' => $dish->id,
            'ingredient_product_id' => $flour->id, 'quantity' => 3, 'sort_order' => 0,
        ]);

        $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $dish->id, 'quantity' => 2]],
        ])->assertCreated();

        $this->assertSame(44.0, (float) $flour->refresh()->stock_quantity);
    }

    public function test_returning_a_large_puts_a_large_back(): void
    {
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $sale = $this->sell($dish, $large, 2); // −10 → 90
        $this->assertSame(90.0, (float) $dough->refresh()->stock_quantity);

        $this->asOwner()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        // One LARGE back → 5 dough, not the Small's 2.
        $this->assertSame(95.0, (float) $dough->refresh()->stock_quantity);
    }

    public function test_a_large_costs_what_a_large_uses(): void
    {
        $dough = $this->ingredient('Dough', 100, 30); // PKR 30 per unit
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $dish->refresh();
        $this->assertSame(60.0, RecipeCost::forDish($dish, [], $small));
        $this->assertSame(150.0, RecipeCost::forDish($dish, [], $large));
        // No size named → the dish's own recipe.
        $this->assertSame(60.0, RecipeCost::forDish($dish));
    }

    public function test_the_sale_line_records_the_size_s_own_food_cost(): void
    {
        $dough = $this->ingredient('Dough', 100, 30);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $sale = $this->sell($dish, $large, 1);

        // Every margin figure on the platform is built from this column.
        $this->assertSame('150.00', $sale['items'][0]['unit_cost']);
    }

    public function test_a_recipe_cannot_name_a_size_of_some_other_dish(): void
    {
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $other = $this->asOwner()->postJson('/api/v1/products', [
            'name' => 'Burger', 'item_type' => 'food_item', 'type' => 'product', 'price' => 300,
            'variants' => [['name' => 'Double', 'price' => 500]],
        ])->assertCreated()->json('data');
        $foreign = ProductVariant::withoutTenancy()->where('product_id', $other['id'])->first();

        $this->asOwner()->putJson("/api/v1/products/{$dish->id}", [
            'recipe_items' => [
                ['ingredient_product_id' => $dough->id, 'quantity' => 2, 'variant_id' => $foreign->id],
            ],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RECIPE_VARIANT_UNKNOWN');
    }

    public function test_the_same_ingredient_twice_for_one_size_is_refused(): void
    {
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $this->asOwner()->putJson("/api/v1/products/{$dish->id}", [
            'recipe_items' => [
                ['ingredient_product_id' => $dough->id, 'quantity' => 2, 'variant_id' => $large->id],
                ['ingredient_product_id' => $dough->id, 'quantity' => 3, 'variant_id' => $large->id],
            ],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RECIPE_DUPLICATE');
    }

    public function test_the_same_ingredient_once_per_size_is_an_ordinary_recipe(): void
    {
        // `distinct` on the request would have refused this, and it is the
        // commonest sized recipe there is: more of the same flour.
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, 5);

        $this->assertSame(2, RecipeItem::withoutTenancy()->where('dish_product_id', $dish->id)->count());
    }

    public function test_a_sized_dish_whose_recipe_names_no_size_says_so(): void
    {
        $dough = $this->ingredient('Dough', 100);
        [$dish, $small, $large] = $this->pizza($dough, 2, null);

        $res = $this->asOwner()->putJson("/api/v1/products/{$dish->id}", [
            'recipe_items' => [['ingredient_product_id' => $dough->id, 'quantity' => 2]],
        ])->assertOk();

        $this->assertNotEmpty(array_filter(
            $res->json('meta.warnings') ?? [],
            fn ($w) => str_contains($w, 'same ingredients'),
        ), 'a shop is told every size will draw the same');
    }
}
