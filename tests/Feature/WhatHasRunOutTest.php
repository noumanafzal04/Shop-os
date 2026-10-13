<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\LowStock;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "4 ITEMS HAVE RUN OUT" — in a shop where one had.
 *
 * Across the top of a clothing shop's dashboard, on a morning its rail held
 * forty kurtas, twenty-six lawn suits and thirteen children's suits. The
 * count read each product's own stock column, and a design sold in sizes
 * keeps its stock on the sizes: its own column is nought, always. So every
 * design counted as sold out, and the one that really was — a waistcoat with
 * no size left — was one voice among four.
 *
 * The low-stock count beside it had been cured of exactly this (`LowStock`);
 * the out-of-stock count kept the fault. A design is out when ALL of it is.
 */
class WhatHasRunOutTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function asOwner(?string $branchId = null): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $as = $this->withToken($token);

        return $branchId === null ? $as : $as->withHeader('X-Branch-Id', $branchId);
    }

    /** @param  array<string, int>|null  $sizes  name → on hand; null for an item with no sizes */
    private function card(string $name, ?array $sizes, int $onHand = 0, bool $tracked = true): array
    {
        return $this->asOwner()->postJson('/api/v1/products', array_filter([
            'name' => $name, 'item_type' => $tracked ? 'physical_product' : 'service', 'price' => 1000,
            // A service is never counted, and may not even be asked whether it is.
            'track_inventory' => $tracked ? true : null,
            'stock_quantity' => $sizes === null && $tracked ? $onHand : null,
            'variants' => $sizes === null ? null : array_map(
                fn (string $size, int $left): array => ['name' => $size, 'price' => 1000, 'stock_quantity' => $left],
                array_keys($sizes), $sizes,
            ),
        ], fn ($v) => $v !== null))->assertCreated()->json('data');
    }

    private function theRail(): void
    {
        $this->card('Cotton Kurta', ['S' => 6, 'M' => 10, 'L' => 8]);      // all there
        $this->card('Lawn Suit', ['Teal' => 12, 'Maroon' => 0]);            // one colour gone — the design still sells
        $this->card('Waistcoat', ['M' => 0, 'L' => 0]);                     // gone
        $this->card('Dupatta', null, 30);                                   // there
        $this->card('Gift Box', null, 0);                                   // gone
        $this->card('Stitching', null, 0, tracked: false);                  // never counted at all
    }

    private function runOutOnTheDashboard(?string $branchId = null): int
    {
        return (int) $this->asOwner($branchId)->getJson('/api/v1/dashboard')->assertOk()->json('data.inventory.out_of_stock');
    }

    public function test_a_design_with_stock_in_its_sizes_has_not_run_out(): void
    {
        $this->card('Cotton Kurta', ['S' => 6, 'M' => 10, 'L' => 8]);

        $this->assertSame(0, $this->runOutOnTheDashboard(), 'a rail of twenty-four kurtas was counted as a kurta that had run out');
    }

    public function test_one_size_gone_is_not_the_design_gone(): void
    {
        $this->card('Lawn Suit', ['Teal' => 12, 'Maroon' => 0]);

        $this->assertSame(0, $this->runOutOnTheDashboard());
    }

    public function test_a_design_with_no_size_left_has_run_out(): void
    {
        $this->card('Waistcoat', ['M' => 0, 'L' => 0]);

        $this->assertSame(1, $this->runOutOnTheDashboard());
    }

    public function test_the_whole_rail_is_counted_as_a_person_would_count_it(): void
    {
        $this->theRail();

        // The waistcoat and the gift box. Not the kurta, not the lawn suit,
        // not the dupatta — and not the stitching, which is not a thing on a shelf.
        $this->assertSame(2, $this->runOutOnTheDashboard());
    }

    public function test_the_rule_names_the_ones_that_have(): void
    {
        $this->theRail();

        $gone = LowStock::soldOut(Product::withoutTenancy()->where('products.tenant_id', $this->shop->id))->orderBy('name')->pluck('name')->all();

        $this->assertSame(['Gift Box', 'Waistcoat'], $gone);
    }

    public function test_a_branch_counts_what_is_on_its_own_shelf(): void
    {
        $this->theRail();
        $main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->sole();
        $outlet = Branch::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'DHA Outlet']);

        // On the main shelf, the same two as the whole shop.
        $this->assertSame(2, $this->runOutOnTheDashboard($main->id));
        // The outlet was opened this morning and holds nothing: all five things
        // that are counted at all are out THERE — sizes and plain alike.
        $this->assertSame(5, $this->runOutOnTheDashboard($outlet->id));
    }

    public function test_selling_the_last_of_every_size_is_what_makes_a_design_run_out(): void
    {
        $kurta = $this->card('Cotton Kurta', ['M' => 1, 'L' => 1]);
        $sell = fn (string $size) => $this->asOwner()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $kurta['id'], 'variant_id' => collect($kurta['variants'])->firstWhere('name', $size)['id'], 'quantity' => 1]],
        ])->assertCreated();

        $sell('M');
        $this->assertSame(0, $this->runOutOnTheDashboard(), 'the Large is still on the rail');

        $sell('L');
        $this->assertSame(1, $this->runOutOnTheDashboard());
    }
}
