<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Coupon;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * MART/RETAIL money-exactness locks:
 *  - returns refund the SOLD price snapshot, never the current shelf price
 *  - a sale-level discount + per-line tax refunds the exact discounted share
 *  - exchanges (even swap / cash-topped upgrade) keep money and stock exact
 *  - a coupon/discounted sale can never refund more than was actually paid
 */
class MartRetailEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private function shop(string $businessType = 'retail', array $overrides = []): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $tenant = Tenant::factory()->create(array_merge([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => $businessType,
            'features' => BusinessTypes::defaultFeatures($businessType),
            'timezone' => 'UTC',
        ], $overrides));
        $owner = User::factory()->shopOwner($tenant)->create();

        return [$tenant, $owner];
    }

    private function actingAsUser(User $user): static
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(Tenant $tenant, array $attrs): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $tenant->id, 'type' => 'product',
            'track_inventory' => true,
        ], $attrs));
    }

    // ── (1) price edits never rewrite refund history ─────────────────

    public function test_return_refunds_the_sold_price_even_after_price_changes(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        $iron = $this->product($tenant, ['name' => 'Steam Iron', 'price' => 500, 'stock_quantity' => 10]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $iron->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertSame('1000.00', $sale['total']);

        // Shelf price HIKED after the sale — the refund must stay at 500.
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$iron->id}", ['price' => 800])->assertOk();
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.refund_total', '500.00');

        // Shelf price SLASHED — the refund still isn't dragged down either.
        $this->actingAsUser($owner)->putJson("/api/v1/products/{$iron->id}", ['price' => 100])->assertOk();
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.refund_total', '500.00');

        // Both units back on the shelf; the customer got exactly the 1000 paid.
        $this->assertSame(10.0, (float) $iron->refresh()->stock_quantity);
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    // ── (2) sale-level discount + taxed lines, partial return ────────

    public function test_partial_return_of_a_discounted_taxed_sale_refunds_the_exact_share(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        $charger = $this->product($tenant, ['name' => 'Charger', 'price' => 1000, 'tax_rate' => 10, 'stock_quantity' => 5]);
        $cable = $this->product($tenant, ['name' => 'Cable', 'price' => 500, 'stock_quantity' => 5]); // tax-exempt

        // 2×1000 + 500 = 2500, − 250 cart discount = 2250 taxable,
        // tax = 10% of the chargers' discounted share (2000×0.9) = 180.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'discount' => 250, 'amount_paid' => 2430,
            'items' => [
                ['product_id' => $charger->id, 'quantity' => 2],
                ['product_id' => $cable->id, 'quantity' => 1],
            ],
        ])->assertCreated()->json('data');

        $this->assertSame('2500.00', $sale['subtotal']);
        $this->assertSame('250.00', $sale['discount']);
        $this->assertSame('180.00', $sale['tax']);
        $this->assertSame('2430.00', $sale['total']);

        $chargerItem = collect($sale['items'])->firstWhere('product_id', $charger->id);
        $cableItem = collect($sale['items'])->firstWhere('product_id', $cable->id);

        // One charger back: its discounted share is 1000×0.9 = 900, plus the
        // 10% tax paid on that share = 90 → exactly 990 back, to the rupee.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $chargerItem['id'], 'quantity' => 1]],
        ])->assertCreated()
            ->assertJsonPath('data.refund_total', '990.00')
            ->assertJsonPath('data.refund_tax', '90.00');

        // The exempt cable refunds its discounted 450 with zero tax attached.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $cableItem['id'], 'quantity' => 1]],
        ])->assertCreated()
            ->assertJsonPath('data.refund_total', '450.00')
            ->assertJsonPath('data.refund_tax', '0.00');

        $this->assertSame('partially_refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    // ── (3) exchanges: even swap and cash-topped upgrade ─────────────

    public function test_even_exchange_moves_no_money_and_swaps_stock_exactly(): void
    {
        [$tenant, $owner] = $this->shop();
        $red = $this->product($tenant, ['name' => 'Kettle Red', 'price' => 350, 'stock_quantity' => 5]);
        $blue = $this->product($tenant, ['name' => 'Kettle Blue', 'price' => 350, 'stock_quantity' => 5]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 350,
            'items' => [['product_id' => $red->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertSame(4.0, (float) $red->refresh()->stock_quantity);

        $res = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $blue->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        // Equal value: nothing owed either way, funded purely by the credit.
        $this->assertEquals(0, $res['difference']);
        $this->assertSame('350.00', $res['sale']['total']);
        $this->assertSame('0.00', $res['sale']['change_due']);
        $this->assertSame('other', $res['sale']['payment_method']); // exchange credit, not cash

        $this->assertSame(5.0, (float) $red->refresh()->stock_quantity);  // back on shelf
        $this->assertSame(4.0, (float) $blue->refresh()->stock_quantity); // replacement out
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    public function test_upgrade_exchange_with_cash_topup_keeps_totals_and_stock_exact(): void
    {
        [$tenant, $owner] = $this->shop();
        $basic = $this->product($tenant, ['name' => 'Basic Blender', 'price' => 800, 'stock_quantity' => 4]);
        $pro = $this->product($tenant, ['name' => 'Pro Blender', 'price' => 1200, 'stock_quantity' => 6]);

        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 800,
            'items' => [['product_id' => $basic->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        $res = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/exchange", [
            'return_items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            'items' => [['product_id' => $pro->id, 'quantity' => 1]],       // 1200
            'payments' => [['method' => 'cash', 'amount' => 400]],          // tops up the 800 credit
        ])->assertCreated()->json('data');

        $this->assertEquals(400, $res['difference']);
        $this->assertSame('1200.00', $res['sale']['total']);
        $this->assertSame('1200.00', $res['sale']['amount_paid']); // 800 credit + 400 cash
        $this->assertSame('0.00', $res['sale']['change_due']);
        $this->assertSame('split', $res['sale']['payment_method']);

        $this->assertSame(4.0, (float) $basic->refresh()->stock_quantity); // restocked
        $this->assertSame(5.0, (float) $pro->refresh()->stock_quantity);   // sold
    }

    // ── (4) refunds can never exceed what was actually paid ──────────

    public function test_full_return_of_a_coupon_sale_refunds_exactly_what_was_paid(): void
    {
        [$tenant, $owner] = $this->shop();
        Coupon::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'code' => 'SAVE20', 'type' => 'percent', 'value' => 20, 'is_active' => true,
        ]);
        $mixer = $this->product($tenant, ['name' => 'Mixer', 'price' => 750, 'stock_quantity' => 5]);
        $grinder = $this->product($tenant, ['name' => 'Grinder', 'price' => 500, 'stock_quantity' => 5]);

        // 2×750 + 500 = 2000, coupon −400 → the customer handed over 1600.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'coupon_code' => 'SAVE20',
            'amount_paid' => 1600,
            'items' => [
                ['product_id' => $mixer->id, 'quantity' => 2],
                ['product_id' => $grinder->id, 'quantity' => 1],
            ],
        ])->assertCreated()->json('data');
        $this->assertSame('400.00', $sale['discount']);
        $this->assertSame('1600.00', $sale['total']);

        $mixerItem = collect($sale['items'])->firstWhere('product_id', $mixer->id);
        $grinderItem = collect($sale['items'])->firstWhere('product_id', $grinder->id);

        // Full return of EVERY line refunds the 1600 paid — not the 2000 sticker.
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [
                ['sale_item_id' => $mixerItem['id'], 'quantity' => 2],
                ['sale_item_id' => $grinderItem['id'], 'quantity' => 1],
            ],
        ])->assertCreated()->assertJsonPath('data.refund_total', '1600.00');

        // Everything is back and the till gave out exactly what it took in;
        // a refunded sale takes no further returns (no second dip).
        $this->assertSame(5.0, (float) $mixer->refresh()->stock_quantity);
        $this->assertSame(5.0, (float) $grinder->refresh()->stock_quantity);
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
        $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'items' => [['sale_item_id' => $mixerItem['id'], 'quantity' => 1]],
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_NOT_RETURNABLE');
    }

    public function test_sequential_partial_returns_of_a_discounted_sale_sum_to_the_amount_paid(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        $fan = $this->product($tenant, ['name' => 'Table Fan', 'price' => 500, 'stock_quantity' => 5]);

        // 2×500 = 1000, − 200 discount → 800 paid.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'discount' => 200, 'amount_paid' => 800,
            'items' => [['product_id' => $fan->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');

        // Each unit refunds its discounted 400 — twice over, exactly the 800.
        foreach ([1, 2] as $i) {
            $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
                'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            ])->assertCreated()->assertJsonPath('data.refund_total', '400.00');
        }

        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
        $this->assertSame(5.0, (float) $fan->refresh()->stock_quantity);
    }

    public function test_sequential_returns_never_over_refund_a_rounding_boundary(): void
    {
        [$tenant, $owner] = $this->shop('mart');
        $jar = $this->product($tenant, ['name' => 'Pickle Jar', 'price' => 333, 'stock_quantity' => 5]);

        // 3×333 = 999, − 100 discount → 899 paid. The discount ratio (100/999)
        // makes each unit's discounted share 299.666… — a rounding-boundary case
        // where naive per-return rounding would leak a paisa.
        $sale = $this->actingAsUser($owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash',
            'discount' => 100, 'amount_paid' => 899,
            'items' => [['product_id' => $jar->id, 'quantity' => 3]],
        ])->assertCreated()->json('data');

        $refunded = 0.0;
        foreach ([1, 2, 3] as $i) {
            $ret = $this->actingAsUser($owner)->postJson("/api/v1/sales/{$sale['id']}/returns", [
                'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
            ])->assertCreated()->json('data');
            $refunded += (float) $ret['refund_total'];
        }

        // Cumulative allocation: the three 1-unit refunds sum to EXACTLY the
        // 899.00 paid — the final return absorbs the rounding remainder. Never
        // a paisa more than the customer handed over.
        $this->assertSame(899.00, round($refunded, 2));
        $this->assertSame('refunded', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }
}
