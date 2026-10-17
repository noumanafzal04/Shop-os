<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A STOCK HISTORY READS LIKE ONE SHELF, NEWEST FIRST, AND SAYS WHO.
 *
 * The user (2026-10-16): "ye b dekho uski entries already theek hain". Each
 * line's "after" is one place's running balance; a history that mixed the
 * godown into the shop's read 429, 275, 428, 273. Two lines written in one
 * second came out oldest first, so balances read backwards. And the stock
 * screen's new "Sold out" tile has to open the rows it counts.
 */
class AStockHistoryReadsLikeOneShelfTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $godown;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Bilal']);
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->godown = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE,
            'is_default' => false, 'is_active' => true, 'fills_orders' => false,
        ]);
    }

    private function as(?Branch $at = null): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->withToken($token);
        // No header is the owner's whole-shop view.
        $this->defaultHeaders = array_diff_key($this->defaultHeaders, ['X-Branch-Id' => true]);

        return $at ? $this->withHeader('X-Branch-Id', $at->id) : $this;
    }

    private function item(string $name, float $stock = 0): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 100, 'cost' => 80, 'track_inventory' => true, 'stock_quantity' => $stock,
        ]);
    }

    private function moved(Product $p, ?string $at, float $change, float $after, string $reason, string $when): void
    {
        StockMovement::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $at, 'product_id' => $p->id, 'variant_id' => null,
            'type' => $change >= 0 ? 'in' : 'out', 'quantity_change' => $change, 'quantity_after' => $after,
            'reason' => $reason, 'created_by' => $this->owner->id, 'created_at' => Carbon::parse($when),
        ]);
    }

    /** @return list<string> */
    private function history(Product $p, ?Branch $at = null): array
    {
        return collect($this->as($at)->getJson("/api/v1/inventory/movements?product_id={$p->id}")->assertOk()->json('data'))
            ->map(fn (array $m): string => $m['reason'].' → '.(float) $m['quantity_after'])
            ->all();
    }

    public function test_a_place_shows_its_own_lines_and_the_whole_shop_shows_all(): void
    {
        $rice = $this->item('Rice');
        // Written before places existed: no place, which is Main's.
        $this->moved($rice, null, 10, 10, 'Opening stock', '2026-10-01 09:00:00');
        $this->moved($rice, $this->godown->id, 300, 300, 'PO-1 received', '2026-10-02 09:00:00');
        $this->moved($rice, $this->main->id, -2, 8, 'Sale INV-1', '2026-10-03 09:00:00');
        $this->moved($rice, $this->godown->id, -5, 295, 'Sent to Main', '2026-10-04 09:00:00');

        $this->assertSame(['Sent to Main → 295', 'PO-1 received → 300'], $this->history($rice, $this->godown),
            "the godown's history carried the shop's lines, so its balances jumped");
        $this->assertSame(['Sale INV-1 → 8', 'Opening stock → 10'], $this->history($rice, $this->main),
            'Main lost the lines written before places existed');
        $this->assertCount(4, $this->history($rice), 'the whole-shop view lost lines');
    }

    public function test_two_lines_in_one_second_read_newest_first(): void
    {
        $tea = $this->item('Tea');
        $second = '2026-10-05 12:00:00';
        // One sale with the item on two lines: written in this order.
        foreach ([[-1, 9, 'Sale INV-7 line 1'], [-1, 8, 'Sale INV-7 line 2'], [-1, 7, 'Sale INV-7 line 3']] as [$c, $a, $r]) {
            $this->moved($tea, $this->main->id, $c, $a, $r, $second);
        }

        $this->assertSame(
            ['Sale INV-7 line 3 → 7', 'Sale INV-7 line 2 → 8', 'Sale INV-7 line 1 → 9'],
            $this->history($tea, $this->main),
            'lines written in one second came out oldest first — the balances read backwards',
        );
    }

    public function test_each_line_says_who_made_it(): void
    {
        $sugar = $this->item('Sugar');
        $this->moved($sugar, $this->main->id, 5, 5, 'Counted in', '2026-10-06 10:00:00');

        $line = $this->as($this->main)->getJson("/api/v1/inventory/movements?product_id={$sugar->id}")->assertOk()->json('data.0');

        $this->assertSame('Bilal', $line['creator']['name'] ?? null);
    }

    public function test_out_of_stock_opens_the_items_with_none_at_the_place_looked_at(): void
    {
        $gone = $this->item('Gone everywhere', 0);
        $here = $this->item('Plenty', 12);
        $onlyGodown = $this->item('Only in the godown', 4);
        $kurta = $this->item('Kurta');
        foreach ([['S', 0], ['M', 3]] as [$size, $qty]) {
            $v = ProductVariant::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'product_id' => $kurta->id, 'name' => $size, 'price' => 100, 'stock_quantity' => $qty]);
            BranchStock::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'branch_id' => $this->main->id, 'product_id' => $kurta->id, 'variant_id' => $v->id, 'quantity' => $qty]);
        }
        foreach ([[$gone, $this->main, 0], [$here, $this->main, 12], [$onlyGodown, $this->main, 0], [$onlyGodown, $this->godown, 4]] as [$p, $b, $q]) {
            BranchStock::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'branch_id' => $b->id, 'product_id' => $p->id, 'variant_id' => null, 'quantity' => $q]);
        }

        $names = fn (?Branch $at) => collect($this->as($at)->getJson('/api/v1/products?type=product&out_of_stock=1')->assertOk()->json('data'))
            ->pluck('name')->sort()->values()->all();

        // A kurta with one size gone is a gap on the rail, not sold out.
        $this->assertSame(['Gone everywhere', 'Only in the godown'], $names($this->main));
        $this->assertSame(['Gone everywhere'], $names(null), 'the whole shop counted the godown stock as gone');
        $this->assertCount(4, $this->as($this->main)->getJson('/api/v1/products?type=product')->json('data'), 'the plain list was filtered');
    }

    public function test_the_stock_list_holds_what_is_counted_and_says_how_many_are_not(): void
    {
        // The user, 2026-10-17: "out of stock kafi hain lkn 1 count q show kr
        // raha". The tile counted the counted items; the list below drew every
        // item and called each made-to-order dish's nought "Out of stock".
        $this->item('Mutton', 0);
        $this->item('Rice', 9);
        foreach (['Chicken Samosa', 'Spring Rolls'] as $dish) {
            Product::withoutTenancy()->create([
                'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
                'name' => $dish, 'price' => 100, 'track_inventory' => false, 'stock_quantity' => 0,
            ]);
        }

        $names = fn (string $q) => collect($this->as()->getJson('/api/v1/products?type=product'.$q)->assertOk()->json('data'))
            ->pluck('name')->sort()->values()->all();

        $this->assertSame(['Mutton', 'Rice'], $names('&track_inventory=1'), 'a dish made to order was on the stock list');
        $this->assertSame(['Chicken Samosa', 'Spring Rolls'], $names('&track_inventory=0'));
        $this->assertSame(['Mutton'], $names('&track_inventory=1&out_of_stock=1'));
        $this->assertCount(4, $names(''), 'a list that did not ask was filtered');
    }
}
