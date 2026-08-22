<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchPrice;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Multi-branch Phase 4c: a per-branch price override sets what THAT branch
 * charges (effective = override ?? tenant base). It's server-authoritative —
 * the sale price comes from the override, not client input — and clearing it
 * returns the branch to the catalog price.
 */
class BranchPricingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $other;

    private Product $widget;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->other = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $this->widget = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'name' => 'Widget',
            'sku' => 'W-1', 'price' => 100, 'cost' => 60, 'track_inventory' => true, 'stock_quantity' => 100,
        ]);
        foreach ([$this->main, $this->other] as $b) {
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $this->tenant->id, 'branch_id' => $b->id,
                'product_id' => $this->widget->id, 'variant_id' => null, 'quantity' => 50,
            ]);
        }
    }

    private function login(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function sale(Branch $b): array
    {
        return $this->login($this->owner)->withHeaders(['X-Branch-Id' => $b->id])->postJson('/api/v1/sales', [
            'channel' => 'walk_in',
            'items' => [['product_id' => $this->widget->id, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated()->json('data');
    }

    public function test_override_sets_the_price_at_that_branch_only(): void
    {
        // Gulberg charges 120 for the widget; Main keeps the catalog 100.
        $this->login($this->owner)->putJson("/api/v1/products/{$this->widget->id}/branch-prices", [
            'prices' => [['branch_id' => $this->other->id, 'price' => 120]],
        ])->assertOk()
            ->assertJsonPath('data.base_price', '100.00');

        $gulberg = $this->sale($this->other);
        $this->assertSame('120.00', $gulberg['items'][0]['unit_price']);
        $this->assertSame('120.00', $gulberg['total']);

        $main = $this->sale($this->main);
        $this->assertSame('100.00', $main['items'][0]['unit_price']);
    }

    public function test_a_client_supplied_price_cannot_override_the_branch_price(): void
    {
        BranchPrice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->other->id,
            'product_id' => $this->widget->id, 'variant_id' => null, 'price' => 120,
        ]);

        // A spoofed unit_price is ignored (StoreSaleRequest strips it) — the
        // branch override still decides the charge.
        $sale = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->postJson('/api/v1/sales', [
                'channel' => 'walk_in',
                'items' => [['product_id' => $this->widget->id, 'quantity' => 1, 'unit_price' => 1]],
                'payment_method' => 'cash', 'amount_paid' => 1000,
            ])->assertCreated()->json('data');

        $this->assertSame('120.00', $sale['items'][0]['unit_price']);
    }

    public function test_clearing_an_override_returns_to_the_catalog_price(): void
    {
        BranchPrice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->other->id,
            'product_id' => $this->widget->id, 'variant_id' => null, 'price' => 120,
        ]);

        $this->login($this->owner)->putJson("/api/v1/products/{$this->widget->id}/branch-prices", [
            'prices' => [['branch_id' => $this->other->id, 'price' => null]],
        ])->assertOk();

        $this->assertDatabaseMissing('branch_prices', [
            'branch_id' => $this->other->id, 'product_id' => $this->widget->id, 'variant_id' => null,
        ]);

        $sale = $this->sale($this->other);
        $this->assertSame('100.00', $sale['items'][0]['unit_price']);
    }

    public function test_product_list_shows_the_operating_branch_price(): void
    {
        BranchPrice::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->other->id,
            'product_id' => $this->widget->id, 'variant_id' => null, 'price' => 120,
        ]);

        $row = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/products')->assertOk()->json('data.0');

        $this->assertSame('120.00', $row['branch_price']);
    }

    /**
     * A SIZE'S STOCK IS THIS BRANCH'S STOCK.
     *
     * `product_variants.stock_quantity` is the shop-wide rollup, and it was the
     * only variant stock figure the online product list carried. A till standing
     * in Gulberg reading it is being told about a rail in Main — so the size
     * picker would offer a size this branch does not have, and refuse one it
     * does.
     *
     * The offline projection has always answered per branch, which made this
     * worse than merely wrong: the same size read online and offline gave two
     * different numbers, and a shop cannot tell which of its own screens to
     * believe.
     *
     * `branch_stock` is additive. The rollup stays exactly where it was, because
     * the catalog and inventory screens legitimately want the shop-wide figure.
     */
    public function test_product_list_shows_each_size_stock_at_the_operating_branch(): void
    {
        $large = ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->widget->id,
            'name' => 'Large', 'price' => 140, 'stock_quantity' => 60,
        ]);

        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id,
            'product_id' => $this->widget->id, 'variant_id' => $large->id, 'quantity' => 55,
        ]);
        BranchStock::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->other->id,
            'product_id' => $this->widget->id, 'variant_id' => $large->id, 'quantity' => 5,
        ]);

        $variant = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/products')->assertOk()->json('data.0.variants.0');

        $this->assertEquals(5, $variant['branch_stock'], 'the till was told about another branch\'s rail');
        // And the shop-wide figure is still there for the screens that want it.
        $this->assertEquals(60, $variant['stock_quantity']);
    }

    /** A size with no row at this branch has none of it, not all of it. */
    public function test_a_size_never_stocked_here_reads_zero_not_the_rollup(): void
    {
        ProductVariant::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'product_id' => $this->widget->id,
            'name' => 'Small', 'price' => 90, 'stock_quantity' => 40,
        ]);

        $variant = $this->login($this->owner)->withHeaders(['X-Branch-Id' => $this->other->id])
            ->getJson('/api/v1/products')->assertOk()->json('data.0.variants.0');

        $this->assertEquals(0, $variant['branch_stock']);
    }
}
