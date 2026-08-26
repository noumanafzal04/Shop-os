<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHICH PIZZA IS IN THE FAMILY DEAL.
 *
 * A deal listed its components by PRODUCT, and a product can have sizes. So a
 * deal containing a pizza never said which pizza, and the sale had nothing to
 * take off the shelf: the deduction ran against the parent's `stock_quantity`,
 * which for a varianted product is an orphaned leftover and is always zero.
 *
 * Measured before it was fixed, on a shop holding ten Small and ten Large:
 *
 *     PARENT stock: 0 · effective: 20
 *     SALE → 422  "Not enough Pizza: only 0 in stock."
 *
 * Not a wrong number — a REFUSAL, on a full shelf. A deal containing any sized
 * product could not be sold at all.
 */
class DealWithSizesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function login(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A pizza in two sizes, ten of each. */
    private function pizza(): array
    {
        return $this->login()->postJson('/api/v1/products', [
            'name' => 'Pizza', 'item_type' => 'physical_product', 'price' => 900,
            'track_inventory' => true,
            'variants' => [
                ['name' => 'Small', 'price' => 700, 'stock_quantity' => 10],
                ['name' => 'Large', 'price' => 1200, 'stock_quantity' => 10],
            ],
        ])->assertCreated()->json('data');
    }

    private function sizeOf(array $product, string $name): string
    {
        return collect($product['variants'])->firstWhere('name', $name)['id'];
    }

    private function deal(array $items, int $expect = 201)
    {
        return $this->login()->postJson('/api/v1/products', [
            'name' => 'Family Deal '.uniqid(), 'item_type' => 'deal', 'price' => 1500,
            'combo_items' => $items,
        ])->assertStatus($expect);
    }

    public function test_a_deal_that_names_a_size_sells_and_takes_it_off_that_shelf(): void
    {
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');

        $deal = $this->deal([
            ['component_product_id' => $pizza['id'], 'variant_id' => $large, 'quantity' => 1],
        ])->json('data');

        $this->login()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $deal['id'], 'quantity' => 2]],
            'payment_method' => 'cash', 'amount_paid' => 3000,
        ])->assertCreated();

        $this->assertSame(8.0, (float) ProductVariant::query()->find($large)->stock_quantity,
            'the deal sold and the Large shelf did not move');
        $this->assertSame(10.0, (float) ProductVariant::query()
            ->find($this->sizeOf($pizza, 'Small'))->stock_quantity,
            'selling a Large deal took stock off the Small');
    }

    public function test_a_deal_cannot_be_saved_without_saying_which_size(): void
    {
        // Asked once, where somebody is looking at the deal — rather than
        // discovered at the counter as an unsellable item.
        $pizza = $this->pizza();

        $res = $this->deal([
            ['component_product_id' => $pizza['id'], 'quantity' => 1],
        ], 422);

        $this->assertSame('COMBO_VARIANT_REQUIRED', $res->json('meta.error_code'));
    }

    public function test_a_deal_cannot_name_a_size_belonging_to_something_else(): void
    {
        $pizza = $this->pizza();
        $other = $this->pizza();

        $this->deal([
            ['component_product_id' => $pizza['id'],
                'variant_id' => $this->sizeOf($other, 'Large'), 'quantity' => 1],
        ], 422);
    }

    public function test_a_deal_can_hold_two_sizes_of_the_same_thing(): void
    {
        // "Two Small and one Large" is an ordinary deal. The component id used
        // to be `distinct`, which made it unsaveable.
        $pizza = $this->pizza();

        $this->deal([
            ['component_product_id' => $pizza['id'], 'variant_id' => $this->sizeOf($pizza, 'Small'), 'quantity' => 2],
            ['component_product_id' => $pizza['id'], 'variant_id' => $this->sizeOf($pizza, 'Large'), 'quantity' => 1],
        ]);
    }

    public function test_the_same_item_and_size_twice_is_still_refused(): void
    {
        $pizza = $this->pizza();
        $small = $this->sizeOf($pizza, 'Small');

        $res = $this->deal([
            ['component_product_id' => $pizza['id'], 'variant_id' => $small, 'quantity' => 1],
            ['component_product_id' => $pizza['id'], 'variant_id' => $small, 'quantity' => 1],
        ], 422);

        $this->assertSame('COMBO_DUPLICATE', $res->json('meta.error_code'));
    }

    public function test_a_component_with_no_sizes_still_needs_none(): void
    {
        $drink = $this->login()->postJson('/api/v1/products', [
            'name' => 'Cola', 'item_type' => 'physical_product', 'price' => 80,
            'track_inventory' => true, 'stock_quantity' => 20,
        ])->assertCreated()->json('data');

        $deal = $this->deal([
            ['component_product_id' => $drink['id'], 'quantity' => 2],
        ])->json('data');

        $this->login()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $deal['id'], 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1500,
        ])->assertCreated();

        $this->assertSame(18.0, (float) Product::query()->find($drink['id'])->stock_quantity);
    }

    public function test_returning_the_deal_puts_the_size_back(): void
    {
        $pizza = $this->pizza();
        $large = $this->sizeOf($pizza, 'Large');
        $deal = $this->deal([
            ['component_product_id' => $pizza['id'], 'variant_id' => $large, 'quantity' => 1],
        ])->json('data');

        $sale = $this->login()->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $deal['id'], 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1500,
        ])->assertCreated()->json('data');

        $this->login()->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'refund_method' => 'cash',
        ])->assertCreated();

        $this->assertSame(10.0, (float) ProductVariant::query()->find($large)->stock_quantity,
            'the refund put the pizza back on a shelf nobody sells from');
    }
}
