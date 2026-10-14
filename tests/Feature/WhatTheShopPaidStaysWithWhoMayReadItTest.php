<?php

namespace Tests\Feature;

use App\Models\FuelDelivery;
use App\Models\OrderItem;
use App\Models\ProductBatch;
use App\Models\PurchaseOrderItem;
use App\Models\RestaurantTicketItem;
use App\Models\SaleItem;
use App\Models\StockCountItem;
use App\Models\StockDisposal;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * WHAT THE SHOP PAID STAYS WITH WHOEVER MAY READ A COST — ON EVERY LINE.
 *
 * Tester pass 2 (B38): a cashier opening a sale read the buying cost of every
 * line — Cotton Shirt XL sold at 1,800, `unit_cost` 1,000. The product list
 * had hidden `cost` from them for months; the sale line carried the same
 * figure under another name. Every line that keeps a cost now strips it the
 * way the product does.
 */
class WhatTheShopPaidStaysWithWhoMayReadItTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->cashier = User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff',
            'permissions' => ['sales.manage', 'discounts.apply', 'customers.manage', 'tables.serve_any'],
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_a_cashier_opening_a_sale_reads_no_cost(): void
    {
        $shirt = $this->as($this->owner)->postJson('/api/v1/products', [
            'name' => 'Cotton Shirt', 'item_type' => 'physical_product', 'price' => 1800, 'cost' => 1000, 'track_inventory' => false,
        ])->assertCreated()->json('data');

        $rung = $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $shirt['id'], 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1800,
        ])->assertCreated()->json('data');
        $this->assertArrayNotHasKey('unit_cost', $rung['items'][0], 'the sale the cashier just rang came back with its cost');

        $read = $this->as($this->cashier)->getJson("/api/v1/sales/{$rung['id']}")->assertOk()->json('data.items.0');
        $this->assertArrayNotHasKey('unit_cost', $read, 'a cashier opening a sale read what the shop paid');
        $this->assertEquals(1800, (float) $read['unit_price']);

        // Whoever may read a cost still does — and the cost was kept.
        $owned = $this->as($this->owner)->getJson("/api/v1/sales/{$rung['id']}")->assertOk()->json('data.items.0');
        $this->assertEquals(1000, (float) $owned['unit_cost']);
    }

    /** @return array<string, array{class-string<Model>, list<string>}> */
    public static function linesWithACost(): array
    {
        return [
            'a sale line' => [SaleItem::class, ['unit_cost']],
            'an order line' => [OrderItem::class, ['unit_cost']],
            'a table tab line' => [RestaurantTicketItem::class, ['unit_cost']],
            'a stock count line' => [StockCountItem::class, ['unit_cost']],
            'a disposal' => [StockDisposal::class, ['unit_cost', 'total_cost']],
            'a batch' => [ProductBatch::class, ['cost']],
            'a fuel delivery' => [FuelDelivery::class, ['unit_cost', 'total_cost']],
            'a purchase order line' => [PurchaseOrderItem::class, ['unit_cost']],
        ];
    }

    /**
     * @param  class-string<Model>  $class
     * @param  list<string>  $keys
     */
    #[DataProvider('linesWithACost')]
    public function test_every_line_that_keeps_a_cost_hides_it(string $class, array $keys): void
    {
        $line = (new $class)->forceFill(array_fill_keys($keys, 950) + ['quantity' => 2]);

        $this->actingAs($this->cashier);
        foreach ($keys as $key) {
            $this->assertArrayNotHasKey($key, $line->toArray(), "{$class} gave a cashier its {$key}");
        }
        $this->assertArrayHasKey('quantity', $line->toArray(), 'more than the cost was taken away');

        $this->actingAs($this->owner);
        foreach ($keys as $key) {
            $this->assertEquals(950, (float) $line->toArray()[$key], "{$class} hid its {$key} from the owner");
        }
    }
}
