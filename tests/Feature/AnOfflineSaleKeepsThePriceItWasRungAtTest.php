<?php

namespace Tests\Feature;

use App\Actions\Sale\CreateSaleAction;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Q10 / B47 — the owner: "jab online hai to updated price jaye gi, agar
 * offline hai to wohi price jaye gi jo save thi".
 *
 * Bilal's till held "QA Price Change" at 1,000. The line went down, the owner
 * changed the price to 1,200, Bilal sold it offline for 1,000 cash and printed
 * the slip. On sync the server re-priced it at 1,200 and refused the sale —
 * the money in the drawer, no sale, no stock out. Now the line keeps the price
 * the till charged, and the owner reads both figures in the offline notes.
 */
class AnOfflineSaleKeepsThePriceItWasRungAtTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $cashier;

    private Product $item;

    private Product $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo('2026-06-15 10:00:00');

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();
        // The price NOW — changed while the till was offline from 1,000.
        $this->item = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'QA Price Change', 'price' => 1200, 'stock_quantity' => 10, 'track_inventory' => true, 'is_active' => true,
        ]);
        $this->other = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Milkpak 1L', 'price' => 100, 'stock_quantity' => 50, 'track_inventory' => true, 'is_active' => true,
        ]);
    }

    private function sync(array $sale, ?array $tillPrices): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->cashier->createToken('t', ['access'])->plainTextToken)->postJson('/api/v1/pos/sync', [
            'operations' => [array_filter([
                'op' => (string) Str::uuid(),
                'at' => now()->subHour()->toIso8601String(),
                'offline_number' => 'OFF-L1-AB-'.str_pad((string) random_int(1, 999999), 6, '0', STR_PAD_LEFT),
                'sale' => $sale + ['channel' => 'pos', 'payment_method' => 'cash'],
                'till_prices' => $tillPrices,
            ], fn ($v) => $v !== null)],
        ]);
    }

    private function line(Product $p, float $price, ?string $variant = null): array
    {
        return ['product_id' => $p->id, 'variant_id' => $variant, 'unit_price' => $price];
    }

    public function test_a_sale_rung_offline_is_recorded_at_the_price_the_till_charged_and_the_change_is_noted(): void
    {
        $result = $this->sync([
            'items' => [['product_id' => $this->item->id, 'quantity' => 1], ['product_id' => $this->other->id, 'quantity' => 2]],
            'amount_paid' => 1200,
        ], [$this->line($this->item, 1000), $this->line($this->other, 100)])->assertOk()->json('data.results.0');

        $this->assertSame('applied', $result['status'], json_encode($result));
        $sale = Sale::withoutTenancy()->with('items')->findOrFail($result['sale_id']);
        $this->assertEquals(1200, (float) $sale->total, 'the slip said 1,000 + 200 and that is what was paid');
        $this->assertEquals([100, 1000], $sale->items->sortBy('product_name')->map(fn ($i) => (float) $i->unit_price)->values()->all());
        $this->assertEquals(9, (float) $this->item->fresh()->stock_quantity, 'the goods left the shop and the shelf must say so');
        $this->assertCount(1, $sale->offline_violations, 'only the line whose price changed is noted');
        $this->assertStringContainsString('QA Price Change at 1,000.00 (the price is now 1,200.00)', $sale->offline_violations[0]);
        $this->assertSame($sale->offline_violations, $result['violations'], 'the till was not told the price had changed');
    }

    public function test_a_price_that_fell_offline_is_kept_too_so_no_change_is_owed_that_was_never_given(): void
    {
        $this->item->forceFill(['price' => 800])->save();

        $result = $this->sync(['items' => [['product_id' => $this->item->id, 'quantity' => 1]], 'amount_paid' => 1000],
            [$this->line($this->item, 1000)])->assertOk()->json('data.results.0');

        $sale = Sale::withoutTenancy()->findOrFail($result['sale_id']);
        $this->assertEquals(1000, (float) $sale->total);
        $this->assertEquals(0, (float) $sale->change_due, 'the till gave no change; the books must not say 200 left the drawer');
        $this->assertStringContainsString('(the price is now 800.00)', $sale->offline_violations[0]);
    }

    public function test_an_unchanged_price_writes_no_note(): void
    {
        $result = $this->sync(['items' => [['product_id' => $this->other->id, 'quantity' => 2]], 'amount_paid' => 200],
            [$this->line($this->other, 100)])->assertOk()->json('data.results.0');

        $this->assertNull(Sale::withoutTenancy()->findOrFail($result['sale_id'])->offline_violations);
    }

    public function test_a_till_price_for_another_item_is_not_taken(): void
    {
        // Out of step with the cart: the till's price names a different product.
        $result = $this->sync(['items' => [['product_id' => $this->item->id, 'quantity' => 1]], 'amount_paid' => 1200],
            [$this->line($this->other, 1)])->assertOk()->json('data.results.0');

        $this->assertEquals(1200, (float) Sale::withoutTenancy()->findOrFail($result['sale_id'])->total);
    }

    public function test_a_pack_is_still_priced_by_the_server(): void
    {
        // The till's engine has no pack prices; a carton keeps the server's.
        $carton = $this->other->units()->create(['tenant_id' => $this->tenant->id, 'name' => 'Carton', 'factor' => 12, 'price' => 1150, 'sort_order' => 0]);

        $result = $this->sync(['items' => [['product_id' => $this->other->id, 'product_unit_id' => $carton->id, 'quantity' => 1]], 'amount_paid' => 1150],
            [$this->line($this->other, 100)])->assertOk()->json('data.results.0');

        $this->assertEquals(1150, (float) Sale::withoutTenancy()->findOrFail($result['sale_id'])->total);
    }

    public function test_a_till_that_sends_no_prices_is_priced_by_the_server_as_before(): void
    {
        $result = $this->sync(['items' => [['product_id' => $this->item->id, 'quantity' => 1]], 'amount_paid' => 1000], null)
            ->assertOk()->json('data.results.0');

        $this->assertSame('failed', $result['status']);
        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    public function test_online_the_price_is_the_shops_whatever_is_sent(): void
    {
        $this->app['auth']->forgetGuards();
        $sale = $this->withToken($this->cashier->createToken('t', ['access'])->plainTextToken)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1200,
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
            'offline_till_prices' => [$this->line($this->item, 1)], 'till_prices' => [$this->line($this->item, 1)], 'trusted_offline' => true,
        ])->assertCreated()->json('data');

        $this->assertEquals(1200, (float) $sale['total'], 'a price arrived through the online door and was taken');
    }

    /**
     * Past the request, straight into the action: a till's price is only ever
     * taken on the sync path (`trusted_offline`). The online door already
     * drops the field; this is the second lock, and the test that fails if
     * the first is ever loosened.
     */
    public function test_a_till_price_that_somehow_arrived_without_the_sync_path_is_ignored(): void
    {
        $this->be($this->cashier);
        app(TenantContext::class)->set($this->tenant);

        $sale = app(CreateSaleAction::class)->execute([
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1200,
            'items' => [['product_id' => $this->item->id, 'quantity' => 1]],
            'offline_till_prices' => [$this->line($this->item, 1)],
        ]);

        $this->assertEquals(1200, (float) $sale->total);
    }
}
