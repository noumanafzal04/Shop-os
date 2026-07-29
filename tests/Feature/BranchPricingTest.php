<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchPrice;
use App\Models\BranchStock;
use App\Models\Product;
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
}
