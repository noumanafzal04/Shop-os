<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\RecipeItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\RecipeCost;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * What a dish costs to make.
 *
 * Every margin figure on this platform comes from `sale_items.unit_cost`, and
 * that was set from `product.cost` — one number typed onto the dish's record.
 * For a tin of paint that is exactly right: it is what the shop paid.
 *
 * A cooked dish has no such number. Its cost is half a kilo of chicken, onions,
 * oil and spices, and those move violently here. So a restaurant's Margins
 * report — the report it opens to decide what to charge — was computed
 * perfectly from a figure nobody maintains, **while every ingredient of the
 * real answer was already in the database.**
 */
class RecipeCostTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $restaurant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->restaurant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'food', 'features' => BusinessTypes::defaultFeatures('food'),
        ]);
        $this->owner = User::factory()->shopOwner($this->restaurant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /** @param array<string, mixed> $extra */
    private function product(string $name, ?float $cost, array $extra = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->restaurant->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'name' => $name,
            'price' => 0,
            'cost' => $cost,
            'stock_quantity' => 1000,
            'track_inventory' => true,
        ], $extra));
    }

    /** @param array<int, array{0: Product, 1: float}> $ingredients */
    private function recipe(Product $dish, array $ingredients): void
    {
        foreach ($ingredients as [$ingredient, $qty]) {
            RecipeItem::withoutTenancy()->create([
                'tenant_id' => $this->restaurant->id,
                'dish_product_id' => $dish->id,
                'ingredient_product_id' => $ingredient->id,
                'quantity' => $qty,
            ]);
        }
    }

    // ── The figure itself ───────────────────────────────────────────────

    public function test_a_dish_costs_what_its_recipe_consumed(): void
    {
        $chicken = $this->product('Chicken', 700);   // per kg
        $onion = $this->product('Onion', 80);
        $oil = $this->product('Oil', 500);

        $karahi = $this->product('Chicken Karahi', 400, ['price' => 1400, 'track_inventory' => false]);
        // Half a kilo of chicken, 200g onion, 50ml oil.
        $this->recipe($karahi, [[$chicken, 0.5], [$onion, 0.2], [$oil, 0.05]]);

        // 350 + 16 + 25
        $this->assertEqualsWithDelta(391.0, RecipeCost::forDish($karahi->fresh()), 0.01);
    }

    public function test_a_bought_in_item_is_untouched_by_any_of_this(): void
    {
        // A bottle of Coke has a purchase cost and no recipe. Null here means
        // "not a dish", and the caller keeps using what the shop paid.
        $coke = $this->product('Coke 500ml', 60);

        $this->assertNull(RecipeCost::forDish($coke));
    }

    // ── Unknown is not zero ─────────────────────────────────────────────

    public function test_one_ingredient_with_no_cost_makes_the_whole_dish_uncostable(): void
    {
        // A partial food cost is not a smaller cost, it is a WRONG one — and
        // wrong in the direction that makes a kitchen underprice.
        $chicken = $this->product('Chicken', 700);
        $spices = $this->product('Spice mix', null);

        $karahi = $this->product('Chicken Karahi', 400, ['track_inventory' => false]);
        $this->recipe($karahi, [[$chicken, 0.5], [$spices, 0.02]]);

        $this->assertNull(RecipeCost::forDish($karahi->fresh()));
    }

    public function test_it_names_the_ingredients_that_are_stopping_it(): void
    {
        // "I cannot cost this dish" is a complaint. "Spice mix and Coriander
        // have no cost recorded" is a job somebody can do in a minute.
        $chicken = $this->product('Chicken', 700);
        $spices = $this->product('Spice mix', null);
        $coriander = $this->product('Coriander', null);

        $karahi = $this->product('Chicken Karahi', 400, ['track_inventory' => false]);
        $this->recipe($karahi, [[$chicken, 0.5], [$spices, 0.02], [$coriander, 0.01]]);

        $this->assertSame(['Spice mix', 'Coriander'], RecipeCost::missingCosts($karahi->fresh()));
    }

    // ── Kitchens nest ───────────────────────────────────────────────────

    public function test_a_prepped_base_costs_what_it_s_ingredients_cost(): void
    {
        // A gravy is made in the morning and three dishes are built on it. Its
        // own `cost` column is empty, as it should be — nobody buys gravy.
        $tomato = $this->product('Tomato', 100);
        $oil = $this->product('Oil', 500);

        $gravy = $this->product('Gravy base', null, ['track_inventory' => false]);
        $this->recipe($gravy, [[$tomato, 0.4], [$oil, 0.1]]);   // 40 + 50 = 90

        $chicken = $this->product('Chicken', 700);
        $handi = $this->product('Chicken Handi', null, ['track_inventory' => false]);
        $this->recipe($handi, [[$chicken, 0.4], [$gravy, 1]]);  // 280 + 90

        $this->assertEqualsWithDelta(370.0, RecipeCost::forDish($handi->fresh()), 0.01);
    }

    public function test_a_prepped_base_that_costs_out_is_not_reported_as_missing(): void
    {
        // Its own cost column is empty and that is correct — it is not a gap.
        $tomato = $this->product('Tomato', 100);
        $gravy = $this->product('Gravy base', null, ['track_inventory' => false]);
        $this->recipe($gravy, [[$tomato, 0.4]]);

        $handi = $this->product('Chicken Handi', null, ['track_inventory' => false]);
        $this->recipe($handi, [[$gravy, 1]]);

        $this->assertSame([], RecipeCost::missingCosts($handi->fresh()));
    }

    public function test_a_recipe_that_refers_to_itself_refuses_rather_than_hangs(): void
    {
        // A mis-entry, not a reason to exhaust the stack.
        $dish = $this->product('Impossible', null, ['track_inventory' => false]);
        $this->recipe($dish, [[$dish, 1]]);

        $this->assertNull(RecipeCost::forDish($dish->fresh()));
    }

    public function test_a_kitchen_may_nest_as_deep_as_it_actually_does(): void
    {
        // Roasted blend → spice paste → gravy → dish. Four levels, and every
        // one of them is a real thing somebody preps in the morning.
        //
        // This test exists because a DEPTH CAP was written first and then
        // removed. Nothing could tell the cap apart from the cycle guard — both
        // terminate a self-referring recipe — but the cap silently answered
        // "uncostable" for a legitimate nest like this one, which is a wrong
        // answer wearing the same clothes as an honest refusal.
        $cumin = $this->product('Cumin', 1000);
        $tomato = $this->product('Tomato', 100);
        $chicken = $this->product('Chicken', 700);

        $blend = $this->product('Roasted blend', null, ['track_inventory' => false]);
        $this->recipe($blend, [[$cumin, 0.01]]);                 // 10

        $paste = $this->product('Spice paste', null, ['track_inventory' => false]);
        $this->recipe($paste, [[$blend, 1]]);                    // 10

        $gravy = $this->product('Gravy base', null, ['track_inventory' => false]);
        $this->recipe($gravy, [[$paste, 1], [$tomato, 0.5]]);    // 10 + 50 = 60

        $handi = $this->product('Chicken Handi', null, ['track_inventory' => false]);
        $this->recipe($handi, [[$gravy, 1], [$chicken, 0.4]]);   // 60 + 280 = 340

        $this->assertEqualsWithDelta(340.0, RecipeCost::forDish($handi->fresh()), 0.01);
    }

    // ── Where it actually matters ───────────────────────────────────────

    public function test_a_sold_dish_records_what_it_cost_to_make_not_what_was_typed(): void
    {
        // The whole point. Every margin, profit and COGS figure is built from
        // `sale_items.unit_cost`.
        $chicken = $this->product('Chicken', 700);
        $onion = $this->product('Onion', 80);

        $karahi = $this->product('Chicken Karahi', 400, ['price' => 1400, 'track_inventory' => false]);
        $this->recipe($karahi, [[$chicken, 0.5], [$onion, 0.2]]);   // 350 + 16 = 366

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $karahi->id, 'quantity' => 1]],
            'amount_paid' => 1400,
        ])->assertCreated()->json('data');

        // Not 400, which is what somebody typed on the dish months ago.
        $this->assertEquals(366, $sale['items'][0]['unit_cost']);
    }

    public function test_an_uncostable_dish_keeps_the_figure_the_shop_typed(): void
    {
        // The behaviour that existed before, so nothing regresses while the
        // recipe is incomplete. The product form names what is missing.
        $spices = $this->product('Spice mix', null);
        $dish = $this->product('Mystery Special', 250, ['price' => 900, 'track_inventory' => false]);
        $this->recipe($dish, [[$spices, 0.05]]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $dish->id, 'quantity' => 1]],
            'amount_paid' => 900,
        ])->assertCreated()->json('data');

        $this->assertEquals(250, $sale['items'][0]['unit_cost']);
    }

    public function test_the_margin_report_reads_the_real_food_cost(): void
    {
        // The report a restaurant opens to decide what to charge.
        $chicken = $this->product('Chicken', 700);
        $karahi = $this->product('Chicken Karahi', 400, ['price' => 1400, 'track_inventory' => false]);
        $this->recipe($karahi, [[$chicken, 0.5]]);   // 350

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $karahi->id, 'quantity' => 2]],
            'amount_paid' => 2800,
        ])->assertCreated();

        $data = $this->actingAsUser($this->owner)
            ->getJson('/api/v1/reports/margins?period=monthly')->assertOk()->json('data');

        $this->assertEquals(700, $data['totals']['cogs']);
        $this->assertEquals(2100, $data['totals']['profit']);
    }

    public function test_the_product_screen_shows_the_cost_and_what_is_missing(): void
    {
        // Where a dish is priced is where the figure has to appear.
        $chicken = $this->product('Chicken', 700);
        $spices = $this->product('Spice mix', null);

        $costed = $this->product('Roast', null, ['price' => 900, 'track_inventory' => false]);
        $this->recipe($costed, [[$chicken, 0.3]]);

        $broken = $this->product('Mystery', null, ['price' => 900, 'track_inventory' => false]);
        $this->recipe($broken, [[$chicken, 0.3], [$spices, 0.01]]);

        $ok = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/products/{$costed->id}")->assertOk()->json('data');
        $this->assertEqualsWithDelta(210.0, $ok['recipe_cost'], 0.01);
        $this->assertSame([], $ok['recipe_cost_missing']);

        $bad = $this->actingAsUser($this->owner)
            ->getJson("/api/v1/products/{$broken->id}")->assertOk()->json('data');
        $this->assertNull($bad['recipe_cost']);
        $this->assertSame(['Spice mix'], $bad['recipe_cost_missing']);
    }
}
