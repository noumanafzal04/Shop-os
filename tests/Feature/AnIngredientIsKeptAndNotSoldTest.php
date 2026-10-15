<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * FLOUR IS COUNTED, BOUGHT AND USED UP — AND NEVER SOLD.
 *
 * Tester pass 5 (B62), Johar Café: "QA Flour kg" (price 0, cost 120, stock
 * 10), the ingredient of a paratha, was offered on the till catalog and in
 * the till's search at 0, and nothing in the catalogue could say "kept, not
 * sold". Now an item can be: it never reaches the till or the storefront, it
 * is refused by name on every way of selling, and the dish that uses it still
 * uses it up.
 */
class AnIngredientIsKeptAndNotSoldTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private string $flour;

    private string $paratha;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $cafe = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'business_type' => 'restaurant']);
        $this->owner = User::factory()->shopOwner($cafe)->create();

        $this->flour = $this->as()->postJson('/api/v1/products', [
            'name' => 'QA Flour kg', 'item_type' => 'physical_product', 'price' => 0, 'cost' => 120,
            'track_inventory' => true, 'stock_quantity' => 10, 'for_sale' => false, 'visible_in_marketplace' => true,
        ])->assertCreated()->json('data.id');
        $this->paratha = $this->as()->postJson('/api/v1/products', [
            'name' => 'QA Paratha', 'item_type' => 'food_item', 'price' => 60, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $this->as()->putJson("/api/v1/products/{$this->paratha}", [
            'recipe_items' => [['ingredient_product_id' => $this->flour, 'quantity' => 0.1]],
        ])->assertOk();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function refused(TestResponse $res, string $how): void
    {
        $res->assertStatus(422);
        $this->assertSame('NOT_FOR_SALE', $res->json('meta.error_code'), "{$how}: the flour was not refused as not for sale");
        $this->assertStringContainsString('QA Flour kg', $res->json('message'));
    }

    public function test_it_is_kept_as_not_for_sale_and_never_listed_online(): void
    {
        $flour = Product::withoutTenancy()->findOrFail($this->flour);

        $this->assertFalse($flour->for_sale);
        $this->assertFalse($flour->visible_in_marketplace, 'an ingredient is listed on the storefront');
    }

    public function test_the_till_is_never_offered_it(): void
    {
        $items = collect($this->as()->getJson('/api/v1/pos/catalog')->assertOk()->json('data.products.items'))->keyBy('id');

        $this->assertTrue($items[$this->flour]['deleted'] ?? false, 'the till catalog offers the flour');
        $this->assertArrayNotHasKey('deleted', $items[$this->paratha], 'the dish is gone from the till too');

        $found = collect($this->as()->getJson('/api/v1/products?search=QA&is_active=1&for_sale=1')->assertOk()->json('data'))->pluck('name');
        $this->assertSame(['QA Paratha'], $found->values()->all(), "the till's search offers the flour");
    }

    public function test_every_way_of_selling_refuses_it_by_name(): void
    {
        $line = [['product_id' => $this->flour, 'quantity' => 1]];

        $this->refused($this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => $line, 'payment_method' => 'cash', 'amount_paid' => 0,
        ]), 'a till sale');

        $tab = $this->as()->postJson('/api/v1/restaurant/tickets', ['order_type' => 'takeaway', 'customer_name' => 'Adnan'])
            ->assertCreated()->json('data');
        $this->refused($this->as()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", ['items' => $line]), 'a tab');

        $this->refused($this->as()->postJson('/api/v1/orders', [
            'channel' => 'phone', 'customer_name' => 'Mrs. Khan', 'customer_phone' => '03001112233', 'fulfillment_type' => 'pickup',
            'items' => $line,
        ]), 'a phone order');

        $this->refused($this->as()->postJson('/api/v1/sale-documents', ['kind' => 'quotation', 'items' => $line]), 'a quotation');

        $this->assertEquals(10, (float) Product::withoutTenancy()->findOrFail($this->flour)->stock_quantity);
    }

    public function test_the_dish_that_uses_it_still_uses_it_up(): void
    {
        $this->as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $this->paratha, 'quantity' => 3]],
            'payment_method' => 'cash', 'amount_paid' => 180,
        ])->assertCreated();

        $this->assertEquals(9.7, (float) Product::withoutTenancy()->findOrFail($this->flour)->stock_quantity);
    }
}
