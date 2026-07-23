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
 * Online orders reach parity with the POS: they can carry packs (strip/box)
 * and combos/deals, with the same hold → release → complete stock maths.
 */
class OnlineOrderParityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'online_shop_enabled' => true, 'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant', 'features' => BusinessTypes::defaultFeatures('restaurant'),
            'delivery_fee' => 100,
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->customer = User::factory()->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function tracked(string $name, float $price, float $stock): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'stock_quantity' => $stock,
            'track_inventory' => true, 'visible_in_marketplace' => true, 'is_active' => true,
        ]);
    }

    private function place(array $items): array
    {
        return $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug,
            'fulfillment_type' => 'delivery',
            'delivery_address' => '12 Main St',
            'items' => $items,
        ])->assertCreated()->json('data');
    }

    private function complete(string $orderId): void
    {
        foreach (['confirmed', 'preparing', 'out_for_delivery', 'completed'] as $s) {
            $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$orderId}/advance", ['status' => $s])->assertOk();
        }
    }

    public function test_online_pack_order_holds_and_completes_in_base_units(): void
    {
        $p = $this->tracked('Panadol', 10, 1000);
        $strip = $p->units()->create(['tenant_id' => $this->shop->id, 'name' => 'Strip', 'factor' => 10]);

        // Order 2 strips → 20 tablets held; priced 10×10 = 100 each.
        $order = $this->place([['product_id' => $p->id, 'product_unit_id' => $strip->id, 'quantity' => 2]]);

        $this->assertSame('100.00', $order['items'][0]['unit_price']);
        $this->assertSame('Strip', $order['items'][0]['unit_name']);
        $this->assertEquals(980, $p->fresh()->stock_quantity); // 1000 − 20 held

        $this->complete($order['id']);
        $this->assertEquals(980, $p->fresh()->stock_quantity); // release +20, sale −20 → net 980
    }

    public function test_online_combo_order_draws_components_and_completes(): void
    {
        $burger = $this->tracked('Burger', 300, 10);
        $drink = $this->tracked('Drink', 100, 30);

        $deal = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Combo', 'price' => 500,
            'combo_items' => [
                ['component_product_id' => $burger->id, 'quantity' => 1],
                ['component_product_id' => $drink->id, 'quantity' => 2],
            ],
        ])->assertCreated()->json('data');

        // Order 2 combos → burger −2, drink −4.
        $order = $this->place([['product_id' => $deal['id'], 'quantity' => 2]]);
        $this->assertSame('500.00', $order['items'][0]['unit_price']);
        $this->assertEquals(8, $burger->fresh()->stock_quantity);
        $this->assertEquals(26, $drink->fresh()->stock_quantity);

        $this->complete($order['id']);
        $this->assertEquals(8, $burger->fresh()->stock_quantity);  // net unchanged
        $this->assertEquals(26, $drink->fresh()->stock_quantity);
    }

    public function test_cancelling_an_online_combo_restores_components(): void
    {
        $burger = $this->tracked('Burger', 300, 10);
        $deal = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'deal', 'name' => 'Combo', 'price' => 500,
            'combo_items' => [['component_product_id' => $burger->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $order = $this->place([['product_id' => $deal['id'], 'quantity' => 3]]);
        $this->assertEquals(7, $burger->fresh()->stock_quantity); // 10 − 3

        $this->actingAsUser($this->owner)->postJson("/api/v1/orders/{$order['id']}/advance", ['status' => 'cancelled'])->assertOk();
        $this->assertEquals(10, $burger->fresh()->stock_quantity); // restored
    }

    public function test_order_with_a_required_modifier_group_completes(): void
    {
        $pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pizza', 'price' => 1000, 'track_inventory' => false,
            'visible_in_marketplace' => true, 'is_active' => true,
        ]);

        // Crust is REQUIRED (min_select 1) — this is what used to break completion.
        $groups = $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Thin', 'price_delta' => 0],
                    ['name' => 'Stuffed', 'price_delta' => 200],
                ]],
            ],
        ])->assertOk()->json('data.modifier_groups');
        $stuffed = collect($groups[0]['options'])->firstWhere('name', 'Stuffed')['id'];

        // Place with the required crust chosen (base 1000 + 200 = 1200).
        $order = $this->actingAsUser($this->customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'delivery', 'delivery_address' => '12 Main St',
            'items' => [['product_id' => $pizza->id, 'quantity' => 1, 'modifier_option_ids' => [$stuffed]]],
        ])->assertCreated()->json('data');
        $this->assertSame('1200.00', $order['items'][0]['unit_price']);

        // Completion must NOT throw MODIFIER_MIN — the trusted path forwards the
        // captured snapshot instead of re-resolving an empty selection.
        $this->complete($order['id']);

        $sale = \App\Models\Sale::withoutTenancy()->where('channel', 'online')->firstOrFail();
        $this->assertSame('completed', \App\Models\Order::withoutTenancy()->find($order['id'])->status->value);
        // Priced once (no double-count) and the snapshot survives onto the sale.
        $this->assertSame('1200.00', $sale->items->first()->unit_price);
        $this->assertCount(1, $sale->items->first()->modifiers);
    }
}
