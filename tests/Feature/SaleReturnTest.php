<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class SaleReturnTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'retail', 'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Mug', 'price' => 300, 'cost' => 150, 'stock_quantity' => 20, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function makeSale(int $qty = 3): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
            'amount_paid' => 300 * $qty,
        ])->assertCreated()->json('data');
    }

    public function test_full_return_restocks_and_marks_refunded(): void
    {
        $sale = $this->makeSale(3);
        $this->assertEquals(17, $this->product->fresh()->stock_quantity); // 20 - 3

        $itemId = $sale['items'][0]['id'];
        $ret = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $itemId, 'quantity' => 3]],
            'reason' => 'Defective', 'refund_method' => 'cash',
        ])->assertCreated()->json('data');

        $this->assertSame('RET-000001', $ret['return_number']);
        $this->assertEquals(900, $ret['refund_total']);
        $this->assertEquals(20, $this->product->fresh()->stock_quantity); // restored
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
        $this->assertSame(1, StockMovement::withoutTenancy()->where('reference_type', 'sale_return')->count());
    }

    public function test_return_numbers_come_from_a_gap_free_counter(): void
    {
        // Two returns across two sales must get sequential, distinct numbers
        // from the locked per-tenant counter — never a count()+1 collision.
        $s1 = $this->makeSale(1);
        $r1 = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$s1['id']}/returns", [
            'items' => [['sale_item_id' => $s1['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $s2 = $this->makeSale(1);
        $r2 = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$s2['id']}/returns", [
            'items' => [['sale_item_id' => $s2['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertSame('RET-000001', $r1['return_number']);
        $this->assertSame('RET-000002', $r2['return_number']);
    }

    public function test_partial_return_marks_partially_refunded(): void
    {
        $sale = $this->makeSale(3);
        $itemId = $sale['items'][0]['id'];

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $itemId, 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.refund_total', '300.00');

        $this->assertEquals(18, $this->product->fresh()->stock_quantity); // 17 + 1
        $this->assertSame('partially_refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    public function test_cannot_return_more_than_remaining(): void
    {
        $sale = $this->makeSale(2);
        $itemId = $sale['items'][0]['id'];

        // Return 1, then try to return 2 more (only 1 left).
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $itemId, 'quantity' => 1]],
        ])->assertCreated();

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $itemId, 'quantity' => 2]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'RETURN_QTY_EXCEEDED');
    }

    public function test_cannot_return_a_cancelled_sale(): void
    {
        $sale = $this->makeSale(1);
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/cancel")->assertOk();

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_NOT_RETURNABLE');
    }

    public function test_return_shows_on_sale(): void
    {
        $sale = $this->makeSale(2);
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();

        $fresh = $this->actingAsUser($this->owner)->getJson("/api/v1/sales/{$sale['id']}")->json('data');
        $this->assertCount(1, $fresh['returns']);
        $this->assertCount(1, $fresh['returns'][0]['items']);
    }

    public function test_staff_without_sales_permission_blocked(): void
    {
        $sale = $this->makeSale(1);
        $staff = User::factory()->tenantStaff($this->tenant, ['products.manage'])->create();
        $this->actingAsUser($staff)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertStatus(403);
    }

    // ── P1: refunds are coupon/discount-aware ───────────────────────

    public function test_refund_is_proportional_to_discounted_price_paid(): void
    {
        // 3 × 300 = 900 subtotal, − 90 discount = 810 paid. A discount ratio
        // of 10% means each 300 unit refunds 270, never the full 300.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'card',
            'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
            'discount' => 90, 'amount_paid' => 810,
        ])->assertCreated()->json('data');

        $ret = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(270, $ret['refund_total']);
        // Refund method defaults to how the customer paid (card), not cash.
        $this->assertSame('card', $ret['refund_method']);

        // A full return never refunds more than the 810 actually paid.
        $ret2 = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(540, $ret2['refund_total']);
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    public function test_decimal_quantity_fully_returns_and_marks_refunded(): void
    {
        $weighed = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Loose Rice', 'price' => 200, 'cost' => 120, 'stock_quantity' => 10,
            'track_inventory' => true, 'sold_by' => 'weight',
        ]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'items' => [['product_id' => $weighed->id, 'quantity' => 2.5]],
            'amount_paid' => 500,
        ])->assertCreated()->json('data');

        // Returning the full 2.5 kg must land on Refunded (not stuck partial)
        // and restore fractional stock exactly.
        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2.5]],
        ])->assertCreated()->assertJsonPath('data.refund_total', '500.00');

        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
        $this->assertEquals(10, $weighed->fresh()->stock_quantity);
    }

    /**
     * The P0 hole: a retried PARTIAL return used to refund cash twice AND
     * restock twice. The over-return guard reads PRIOR returns, so 1-of-3
     * passes again on the retry, and the restock idempotency keys embed the new
     * return's id so they never collapsed. Same key must replay the original.
     */
    public function test_retried_partial_return_replays_instead_of_double_refunding(): void
    {
        $sale = $this->makeSale(3);          // 20 − 3 = 17 in stock
        $key = 'ret-retry-key-001';

        $first = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'idempotency_key' => $key,
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEquals(18, $this->product->fresh()->stock_quantity);

        // The retry (timeout / double-click) — identical body, identical key.
        $second = $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'idempotency_key' => $key,
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // Same return replayed — not a second refund.
        $this->assertSame($first['id'], $second['id']);
        $this->assertSame($first['return_number'], $second['return_number']);
        $this->assertSame(1, \App\Models\SaleReturn::withoutTenancy()->where('sale_id', $sale['id'])->count());
        // Stock restocked ONCE (18, not 19).
        $this->assertEquals(18, $this->product->fresh()->stock_quantity);
        // Sale stays partially refunded, not double-counted.
        $this->assertSame('partially_refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    /** Distinct keys are genuinely distinct returns — the guard must not over-block. */
    public function test_partial_returns_with_different_keys_are_separate(): void
    {
        $sale = $this->makeSale(3);          // stock 17

        foreach (['k1', 'k2'] as $key) {
            $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
                'idempotency_key' => $key,
                'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            ])->assertCreated();
        }

        $this->assertSame(2, \App\Models\SaleReturn::withoutTenancy()->where('sale_id', $sale['id'])->count());
        $this->assertEquals(19, $this->product->fresh()->stock_quantity);
    }

    /** Omitting the key keeps the legacy behaviour (no replay, still guarded by qty). */
    public function test_return_without_key_still_works(): void
    {
        $sale = $this->makeSale(2);

        $this->actingAsUser($this->owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 2]],
        ])->assertCreated();

        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
        $this->assertEquals(20, $this->product->fresh()->stock_quantity);
    }
}
