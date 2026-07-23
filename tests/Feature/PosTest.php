<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\City;
use App\Models\HeldSale;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

class PosTest extends TestCase
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
            'name' => 'Cola 500ml', 'sku' => 'COLA-500', 'barcode' => '8964000123456',
            'price' => 100, 'cost' => 60, 'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── Barcode / SKU lookup ────────────────────────────────────────

    public function test_lookup_by_barcode(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=8964000123456')
            ->assertOk()->assertJsonPath('data.product.name', 'Cola 500ml')->assertJsonPath('data.variant_id', null);
    }

    public function test_lookup_by_sku(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=COLA-500')
            ->assertOk()->assertJsonPath('data.product.id', $this->product->id);
    }

    public function test_lookup_variant_sku_returns_parent_with_variant(): void
    {
        $variant = $this->product->variants()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bottle', 'sku' => 'COLA-BTL', 'price' => 120, 'stock_quantity' => 10,
        ]);
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=COLA-BTL')
            ->assertOk()->assertJsonPath('data.variant_id', $variant->id)
            ->assertJsonPath('data.product.id', $this->product->id);
    }

    public function test_lookup_unknown_code_404s_gracefully(): void
    {
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=NOPE')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    // ── Scale (embedded-weight) barcodes ────────────────────────────

    private function loosePlu(): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Loose Sugar', 'sku' => 'SUG-KG', 'plu_code' => '21', 'sold_by' => 'weight',
            'price' => 180, 'cost' => 150, 'stock_quantity' => 100, 'track_inventory' => true,
        ]);
    }

    private function enableScale(string $mode = 'weight'): void
    {
        $this->tenant->forceFill(['settings' => array_merge($this->tenant->settings ?? [], [
            'scale_barcode_enabled' => true, 'scale_barcode_prefix' => '2', 'scale_barcode_mode' => $mode,
        ])])->save();
    }

    public function test_scale_weight_barcode_resolves_product_and_prefills_weight(): void
    {
        $this->loosePlu();
        $this->enableScale('weight');

        // prefix "2" + item "000021" + value "01500" (1.500 kg) + check "0".
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=2000021015000')
            ->assertOk()
            ->assertJsonPath('data.product.name', 'Loose Sugar')
            ->assertJsonPath('data.scale.mode', 'weight')
            ->assertJsonPath('data.scale.quantity', 1.5);
    }

    public function test_scale_price_barcode_backsolves_weight_from_shop_price(): void
    {
        $this->loosePlu();
        $this->enableScale('price');

        // value "27000" = Rs 270.00; at Rs 180/kg that's 1.5 kg.
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=2000021270000')
            ->assertOk()
            ->assertJsonPath('data.scale.mode', 'price')
            ->assertJsonPath('data.scale.embedded_price', 270)
            ->assertJsonPath('data.scale.quantity', 1.5);
    }

    public function test_scale_barcode_ignored_when_setting_off(): void
    {
        $this->loosePlu();
        // Setting off → the 13-digit code is treated as a normal barcode and
        // doesn't match anything → normal not-found.
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=2000021015000')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'POS_ITEM_NOT_FOUND');
    }

    public function test_scale_barcode_with_unknown_plu_reports_scale_error(): void
    {
        $this->enableScale('weight');
        $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=2999999015000')
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'POS_SCALE_ITEM_NOT_FOUND');
    }

    public function test_scale_weight_sale_prices_from_shop_rate(): void
    {
        $sugar = $this->loosePlu();
        $this->enableScale('weight');

        $scale = $this->actingAsUser($this->owner)->getJson('/api/v1/pos/lookup?code=2000021015000')
            ->json('data.scale');

        // Ring up the weighed line: 1.5 kg × Rs 180 = Rs 270, server-priced.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 300,
            'items' => [['product_id' => $sugar->id, 'quantity' => $scale['quantity']]],
        ])->assertCreated()->json('data');

        $this->assertSame('270.00', $sale['total']);
        $this->assertEquals(98.5, $sugar->fresh()->stock_quantity); // 100 - 1.5
    }

    // ── Price levels (retail / wholesale) ───────────────────────────

    private function wholesaleProduct(): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'sku' => 'RICE-5', 'price' => 100, 'wholesale_price' => 80,
            'stock_quantity' => 50, 'track_inventory' => true,
        ]);
    }

    public function test_wholesale_level_uses_the_wholesale_price(): void
    {
        $p = $this->wholesaleProduct();
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $p->id, 'quantity' => 2, 'price_level' => 'wholesale']],
        ])->assertCreated()->json('data');

        $this->assertSame('80.00', $sale['items'][0]['unit_price']); // wholesale, not 100
        $this->assertSame('160.00', $sale['total']);
    }

    public function test_retail_level_uses_the_normal_price(): void
    {
        $p = $this->wholesaleProduct();
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $p->id, 'quantity' => 1, 'price_level' => 'retail']],
        ])->assertCreated()->json('data');

        $this->assertSame('100.00', $sale['items'][0]['unit_price']);
    }

    public function test_wholesale_falls_back_to_retail_when_no_wholesale_price(): void
    {
        // $this->product (Cola) has no wholesale_price → wholesale = retail 100.
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 200,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'price_level' => 'wholesale']],
        ])->assertCreated()->json('data');

        $this->assertSame('100.00', $sale['items'][0]['unit_price']);
    }

    // ── Shifts ──────────────────────────────────────────────────────

    public function test_open_and_close_shift_reconciles_cash(): void
    {
        $session = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertCreated()->json('data');

        // Two cash sales of 100 (qty 1 each) on this session.
        foreach (range(1, 2) as $i) {
            $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
                'channel' => 'pos', 'cash_session_id' => $session['id'], 'payment_method' => 'cash',
                'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
                'amount_paid' => 100, 'idempotency_key' => "pos-{$i}",
            ])->assertCreated();
        }

        // Expected = 1000 + 200 = 1200; counted 1150 → variance -50 (short).
        $closed = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/close', ['counted_cash' => 1150])
            ->assertOk()->json('data');

        $this->assertSame('closed', $closed['status']);
        $this->assertEquals(1200, $closed['expected_cash']);
        $this->assertEquals(-50, $closed['variance']);
        $this->assertSame(2, $closed['sales_count']);
    }

    public function test_cannot_open_two_shifts(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])->assertCreated();
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 500])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_ALREADY_OPEN');
    }

    public function test_close_without_open_shift_conflicts(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/close', ['counted_cash' => 100])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SHIFT_NOT_OPEN');
    }

    // ── POS sale with tax + session ─────────────────────────────────

    public function test_pos_sale_applies_tax_and_links_session(): void
    {
        // Tax is server-authoritative — computed from the product's own rate.
        Product::withoutTenancy()->whereKey($this->product->id)->update(['tax_rate' => 10]);
        $session = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->json('data');

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $session['id'], 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 2]], // 200
            'discount' => 20, 'amount_paid' => 200,
        ])->assertCreated()->json('data');

        // Taxable base 200 − 20 = 180; tax 10% = 18; total 198.
        $this->assertEquals(198, $sale['total']);
        $this->assertEquals(2, $sale['change_due']); // 200 paid - 198
        $this->assertSame($session['id'], $sale['cash_session_id']);
        $this->assertEquals(48, $this->product->fresh()->stock_quantity); // 50 - 2
    }

    public function test_tax_is_server_authoritative_ignoring_client_and_honouring_exempt(): void
    {
        Product::withoutTenancy()->whereKey($this->product->id)->update(['tax_rate' => 10]); // price 100
        $med = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Exempt Med', 'price' => 50, 'stock_quantity' => 20, 'track_inventory' => true, 'tax_rate' => 0,
        ]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'tax' => 999, // a client-sent tax MUST be ignored
            'items' => [
                ['product_id' => $this->product->id, 'quantity' => 1], // 100 @ 10% → 10 tax
                ['product_id' => $med->id, 'quantity' => 1],           // 50 exempt → 0 tax
            ],
            'amount_paid' => 160,
        ])->assertCreated()->json('data');

        // Subtotal 150, tax only on the taxable line (10), total 160 — not 150 + 999.
        $this->assertEquals(160, $sale['total']);
    }

    // ── Multi-tender / split payment ────────────────────────────────

    public function test_split_payment_records_multiple_tenders(): void
    {
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], // total 100
            'payments' => [
                ['method' => 'cash', 'amount' => 60],
                ['method' => 'card', 'amount' => 40, 'reference' => 'AUTH123'],
            ],
        ])->assertCreated()->json('data');

        $this->assertEquals(100, $sale['total']);
        $this->assertEquals(100, $sale['amount_paid']);
        $this->assertSame('split', $sale['payment_method']);
        $this->assertEquals(0, $sale['change_due']);
        $this->assertCount(2, $sale['payments']);
    }

    public function test_split_payment_below_total_is_rejected(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], // total 100
            'payments' => [['method' => 'cash', 'amount' => 60], ['method' => 'card', 'amount' => 30]], // 90
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    public function test_split_sale_cash_portion_reconciles_at_shift_close(): void
    {
        $session = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 0])->json('data');
        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'cash_session_id' => $session['id'],
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], // total 100
            'payments' => [['method' => 'cash', 'amount' => 60], ['method' => 'card', 'amount' => 40]],
        ])->assertCreated();

        // Only the 60 cash slice belongs in the drawer (the 40 card never hits it).
        $closed = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/close', ['counted_cash' => 60])
            ->assertOk()->json('data');
        $this->assertEquals(60, $closed['cash_sales']);
        $this->assertEquals(60, $closed['expected_cash']);
        $this->assertEquals(0, $closed['variance']);
    }

    public function test_duplicate_idempotency_key_replays_the_same_sale(): void
    {
        $payload = [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 100,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]], // price 100
            'idempotency_key' => 'dup-key-1',
        ];

        $first = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $payload)->assertCreated()->json('data');
        // A repeat with the same key returns the ORIGINAL sale, no second sale.
        $second = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', $payload)->assertCreated()->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertSame($first['invoice_number'], $second['invoice_number']);
        $this->assertEquals(49, $this->product->fresh()->stock_quantity); // decremented ONCE (50→49)
    }

    public function test_pos_sale_applies_modifiers_and_snapshots_them(): void
    {
        // A food item with a paid add-on.
        $pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pizza', 'price' => 1000, 'track_inventory' => false,
        ]);
        $group = $pizza->modifierGroups()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Extras', 'type' => 'addon', 'min_select' => 0, 'max_select' => 3,
        ]);
        $cheese = $group->options()->create(['tenant_id' => $this->tenant->id, 'name' => 'Cheese', 'price_delta' => 150]);

        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $pizza->id, 'quantity' => 2, 'modifier_option_ids' => [$cheese->id]]],
            'amount_paid' => 2300,
        ])->assertCreated()->json('data');

        // (1000 + 150) × 2 = 2300
        $this->assertSame('1150.00', $sale['items'][0]['unit_price']);
        $this->assertEquals(2300, $sale['total']);
        $this->assertSame('Cheese', $sale['items'][0]['modifiers'][0]['name']);
    }

    // ── Held sales ──────────────────────────────────────────────────

    public function test_hold_and_resume_and_delete(): void
    {
        $held = $this->actingAsUser($this->owner)->postJson('/api/v1/pos/held', [
            'label' => 'Counter 1', 'total_estimate' => 300,
            'cart' => ['items' => [['product_id' => $this->product->id, 'quantity' => 3]]],
        ])->assertCreated()->json('data');

        $this->assertCount(1, $this->actingAsUser($this->owner)->getJson('/api/v1/pos/held')->json('data'));

        $this->actingAsUser($this->owner)->deleteJson("/api/v1/pos/held/{$held['id']}")->assertOk();
        $this->assertSame(0, HeldSale::withoutTenancy()->count());
    }

    // ── Authz / isolation ───────────────────────────────────────────

    public function test_staff_without_sales_permission_blocked(): void
    {
        $staff = User::factory()->tenantStaff($this->tenant, ['products.manage'])->create();
        $this->actingAsUser($staff)->getJson('/api/v1/pos/lookup?code=COLA-500')->assertStatus(403);
    }

    // ── Per-line discount ───────────────────────────────────────────

    public function test_line_discount_amount_and_percent_are_applied_server_side(): void
    {
        // 2 × 100 = 200. A Rs 30 line discount → 170.
        $amt = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'line_discount' => 30]],
        ])->assertCreated()->json('data');
        $this->assertSame('30.00', $amt['items'][0]['line_discount']);
        $this->assertSame('170.00', $amt['items'][0]['line_total']);
        $this->assertSame('170.00', $amt['total']);

        // 10% off 200 → 20 discount, 180 line.
        $pct = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'line_discount_pct' => 10]],
        ])->assertCreated()->json('data');
        $this->assertSame('20.00', $pct['items'][0]['line_discount']);
        $this->assertSame('180.00', $pct['items'][0]['line_total']);
    }

    public function test_line_discount_cannot_exceed_the_line(): void
    {
        // A Rs 9999 discount on a 200 line is clamped to 200 (never negative).
        $sale = $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 2, 'line_discount' => 9999]],
        ])->assertCreated()->json('data');
        $this->assertSame('200.00', $sale['items'][0]['line_discount']);
        $this->assertSame('0.00', $sale['items'][0]['line_total']);
    }

    public function test_line_discount_requires_the_discounts_permission(): void
    {
        // Cashier can sell (sales.manage) but not discount (no discounts.apply).
        $cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        $this->actingAsUser($cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'line_discount' => 10]],
        ])->assertStatus(403);

        // …but a plain sale (no line discount) still goes through.
        $this->actingAsUser($cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->product->id, 'quantity' => 1]],
        ])->assertCreated();
    }

    public function test_shifts_are_isolated_per_cashier(): void
    {
        $this->actingAsUser($this->owner)->postJson('/api/v1/pos/session/open', ['opening_float' => 100])->assertCreated();

        $cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        // Cashier has no open shift of their own.
        $this->assertNull($this->actingAsUser($cashier)->getJson('/api/v1/pos/session')->json('data'));
        $this->assertSame(1, CashSession::withoutTenancy()->count());
    }
}
