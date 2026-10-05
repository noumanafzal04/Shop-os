<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE PROMOTION ON THE SCREEN IS THE PROMOTION ON THE SALE.
 *
 * The till shows an automatic promotion by asking for a preview. The preview
 * priced the cart itself — shelf price × quantity — and the sale handed the
 * same rule each line's REAL total. Those are the same number for a plain
 * line and for no other kind:
 *
 *     a quantity break     12 at the 10-up price, previewed at the 1-up price
 *     a trade customer     rung at wholesale, previewed at retail
 *     a marked-down line   the markdown simply not there
 *
 * So ten percent off was ten percent of two different figures. The till
 * showed one, the sale gave the other, and the amount due was wrong by the
 * difference — short, which is the reported failure, every time.
 *
 * Each case rings the sale and compares its `promo_discount` to what the
 * preview said for the same cart. The plain line is here too, as the control:
 * it always agreed, which is why nothing looked wrong.
 */
class ThePreviewIsOfThisCartTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Ten off everything', 'is_active' => true,
            'type' => 'percent', 'value' => 10, 'scope' => 'order', 'priority' => 0,
        ]);
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(array $over = []): Product
    {
        return Product::query()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'tax_rate' => 0,
            'track_inventory' => false, 'is_active' => true,
        ], $over));
    }

    /**
     * Ring it, and return what the SALE gave and what each line came to.
     *
     * @param  array<string, mixed>  $line
     * @param  array<string, mixed>  $sale
     * @return array{promo: float, lineTotal: float}
     */
    private function rung(array $line, array $sale = []): array
    {
        $data = $this->asOwner()->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1_000_000,
            'items' => [$line],
        ], $sale))->assertCreated()->json('data');

        return ['promo' => (float) $data['promo_discount'], 'lineTotal' => (float) $data['items'][0]['line_total']];
    }

    /** @param  array<string, mixed>  $item */
    private function previewed(array $item): float
    {
        return (float) $this->asOwner()
            ->postJson('/api/v1/promotions/preview', ['items' => [$item]])
            ->assertOk()->json('data.discount');
    }

    public function test_the_control_a_plain_line_always_agreed(): void
    {
        $rice = $this->product();

        $sale = $this->rung(['product_id' => $rice->id, 'quantity' => 2]);

        $this->assertEqualsWithDelta(200.0, $sale['promo'], 0.001);
        $this->assertEqualsWithDelta(
            $sale['promo'],
            $this->previewed(['product_id' => $rice->id, 'quantity' => 2]),
            0.001,
        );
    }

    public function test_a_quantity_break_is_previewed_at_the_break_price(): void
    {
        $rice = $this->product(['price_tiers' => [['min_qty' => 10, 'price' => 900]]]);

        $sale = $this->rung(['product_id' => $rice->id, 'quantity' => 12]);

        // 12 × 900 = 10,800, and ten percent of THAT.
        $this->assertEqualsWithDelta(10800.0, $sale['lineTotal'], 0.001);
        $this->assertEqualsWithDelta(1080.0, $sale['promo'], 0.001);

        // The old preview, pinned: shelf price, so 1,200. Rs 120 the till
        // took off that the sale never did.
        $this->assertEqualsWithDelta(1200.0, $this->previewed(['product_id' => $rice->id, 'quantity' => 12]), 0.001);

        // Told what the line comes to, it previews the cart being rung.
        $this->assertEqualsWithDelta($sale['promo'], $this->previewed([
            'product_id' => $rice->id, 'quantity' => 12, 'line_total' => $sale['lineTotal'],
        ]), 0.001);
    }

    public function test_a_trade_customer_is_previewed_at_the_trade_price(): void
    {
        $rice = $this->product(['wholesale_price' => 850]);
        $group = CustomerGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Trade', 'is_active' => true,
            'price_level' => 'wholesale', 'discount_percent' => 0,
        ]);
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal Traders',
            'phone' => '03001230001', 'customer_group_id' => $group->id,
        ]);

        $sale = $this->rung(['product_id' => $rice->id, 'quantity' => 4], ['customer_phone' => '03001230001']);

        $this->assertEqualsWithDelta(3400.0, $sale['lineTotal'], 0.001);
        $this->assertEqualsWithDelta(340.0, $sale['promo'], 0.001);
        $this->assertEqualsWithDelta($sale['promo'], $this->previewed([
            'product_id' => $rice->id, 'quantity' => 4, 'line_total' => $sale['lineTotal'],
        ]), 0.001);
    }

    public function test_a_line_already_marked_down_is_previewed_marked_down(): void
    {
        $rice = $this->product();

        $sale = $this->rung(['product_id' => $rice->id, 'quantity' => 3, 'line_discount_pct' => 20]);

        $this->assertEqualsWithDelta(2400.0, $sale['lineTotal'], 0.001);
        $this->assertEqualsWithDelta(240.0, $sale['promo'], 0.001);
        $this->assertEqualsWithDelta($sale['promo'], $this->previewed([
            'product_id' => $rice->id, 'quantity' => 3, 'line_total' => $sale['lineTotal'],
        ]), 0.001);
    }

    public function test_a_spend_threshold_is_judged_on_what_is_being_spent(): void
    {
        // The dangerous version of the same fault: not a smaller discount but
        // one that does not exist. At shelf price the cart clears the
        // threshold; at the price being charged it does not.
        Promotion::query()->forceDelete();
        Promotion::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rs 500 off over 11,000', 'is_active' => true,
            'type' => 'fixed', 'value' => 500, 'scope' => 'order', 'min_spend' => 11000, 'priority' => 0,
        ]);
        $rice = $this->product(['price_tiers' => [['min_qty' => 10, 'price' => 900]]]);

        $sale = $this->rung(['product_id' => $rice->id, 'quantity' => 12]);
        $this->assertEqualsWithDelta(0.0, $sale['promo'], 0.001, 'the sale gave no promotion at all');

        // Shelf price says 12,000 and promises Rs 500 the customer never gets.
        $this->assertEqualsWithDelta(500.0, $this->previewed(['product_id' => $rice->id, 'quantity' => 12]), 0.001);

        // The cart being rung promises nothing — `data` is null.
        $this->asOwner()->postJson('/api/v1/promotions/preview', ['items' => [[
            'product_id' => $rice->id, 'quantity' => 12, 'line_total' => $sale['lineTotal'],
        ]]])->assertOk()->assertJsonPath('data', null);
    }

    public function test_what_the_preview_is_told_never_reaches_a_sale(): void
    {
        // The standing rule: HTTP never supplies a price. A `line_total` on a
        // SALE is not a field — the line is priced by the server regardless.
        $rice = $this->product();

        $data = $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1_000_000,
            'items' => [['product_id' => $rice->id, 'quantity' => 2, 'line_total' => 1]],
        ])->assertCreated()->json('data');

        $this->assertEqualsWithDelta(2000.0, (float) $data['items'][0]['line_total'], 0.001);
    }
}
