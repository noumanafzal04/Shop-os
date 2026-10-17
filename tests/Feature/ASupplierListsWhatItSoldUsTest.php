<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * THE NEXT ORDER STARTS FROM WHAT THIS SUPPLIER SOLD US BEFORE.
 *
 * The user, 2026-10-17: every new order to the same distributor was built one
 * search at a time. Choosing the supplier now lists each item ever bought from
 * them once — with last time's quantity, cost and date — paged and searchable.
 */
final class ASupplierListsWhatItSoldUsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    /** @var array<string, array<string, mixed>> */
    private array $item = [];

    private string $mills;

    private string $other;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($shop)->create();

        foreach (['Rice 5kg', 'Sugar 1kg', 'Salt', 'Ghee', 'Green Tea', 'Old Oil'] as $name) {
            $this->item[$name] = $this->as()->postJson('/api/v1/products', [
                'name' => $name, 'item_type' => 'physical_product', 'price' => 200, 'cost' => 100, 'track_inventory' => true,
            ])->assertCreated()->json('data');
        }
        $this->item['Kurta'] = $this->as()->postJson('/api/v1/products', [
            'name' => 'Kurta', 'item_type' => 'physical_product', 'price' => 2000, 'cost' => 900, 'track_inventory' => true,
            'variants' => [['name' => 'S', 'price' => 2000, 'stock_quantity' => 0], ['name' => 'M', 'price' => 2000, 'stock_quantity' => 0]],
        ])->assertCreated()->json('data');

        $this->mills = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
        $this->other = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Karachi Traders'])->assertCreated()->json('data.id');

        $this->order($this->mills, '2026-10-01', [
            $this->line('Rice 5kg', 10, 100),
            $this->line('Kurta', 5, 900, size: 'S'),
            $this->line('Green Tea', 2, 300),
            $this->line('Old Oil', 4, 500),
        ]);
        $this->order($this->mills, '2026-10-08', [$this->line('Rice 5kg', 20, 110), $this->line('Sugar 1kg', 5, 50), $this->line('Kurta', 3, 950, size: 'M')]);
        $cancelled = $this->order($this->mills, '2026-10-09', [$this->line('Salt', 3, 20)]);
        $this->as()->postJson("/api/v1/purchase-orders/{$cancelled}/cancel")->assertOk();
        $this->order($this->other, '2026-10-02', [$this->line('Ghee', 6, 700)]);

        // Switched off, and deleted, since: neither can be ordered again.
        Product::withoutTenancy()->whereKey($this->item['Green Tea']['id'])->update(['is_active' => false]);
        Product::withoutTenancy()->findOrFail($this->item['Old Oil']['id'])->delete();
    }

    public function test_it_lists_each_item_once_with_last_time(): void
    {
        $rows = $this->ask($this->mills)->json('data');

        $this->assertSame(['Kurta / M', 'Kurta / S', 'Rice 5kg', 'Sugar 1kg'], array_column($rows, 'name'),
            "a cancelled order's item, another supplier's, or one that cannot be ordered was listed");

        $rice = collect($rows)->firstWhere('name', 'Rice 5kg');
        $this->assertSame(2, $rice['times_ordered']);
        $this->assertEquals(20, $rice['last']['quantity'], 'last time is the newest order');
        $this->assertEquals(110, $rice['last']['unit_cost']);
        $this->assertSame('2026-10-08', $rice['last']['ordered_on']);

        $kurta = collect($rows)->firstWhere('name', 'Kurta / S');
        $this->assertSame(collect($this->item['Kurta']['variants'])->firstWhere('name', 'S')['id'], $kurta['variant_id']);
        $this->assertSame([], $kurta['units'], 'a size takes no packs');
    }

    public function test_it_pages_and_searches_in_the_database(): void
    {
        $first = $this->ask($this->mills, 'per_page=2&page=1');
        $this->assertSame(['Kurta / M', 'Kurta / S'], array_column($first->json('data'), 'name'), 'each size is its own row');
        $this->assertSame(4, $first->json('meta.pagination.total'));
        $this->assertSame(['Rice 5kg', 'Sugar 1kg'], array_column($this->ask($this->mills, 'per_page=2&page=2')->json('data'), 'name'));

        $this->assertSame(['Rice 5kg'], array_column($this->ask($this->mills, 'search=rice')->json('data'), 'name'));
        $this->assertSame(['Kurta / M', 'Kurta / S'], array_column($this->ask($this->mills, 'search=kur')->json('data'), 'name'));
    }

    public function test_two_items_of_one_name_cannot_trade_places_between_pages(): void
    {
        /*
         * Asked of the query, as PagesHoldStillTest does: a small table orders
         * its ties the same way twice, so reading pages would pass with the
         * tiebreak taken out. The page must end on something no two rows share.
         */
        $pages = [];
        DB::listen(function ($query) use (&$pages): void {
            if (preg_match('/ limit \d+ offset \d+$/', $query->sql)) {
                $pages[] = str_replace(['`', '"'], '', $query->sql);
            }
        });

        $this->ask($this->mills, 'per_page=2');

        $this->assertNotSame([], $pages, 'no paged query was seen, so nothing was checked');
        $this->assertMatchesRegularExpression('/order by product_name asc, size_name asc, first_line asc limit 2 offset 0$/', $pages[0]);
    }

    public function test_it_says_what_is_on_the_shelf_now(): void
    {
        $po = $this->order($this->mills, '2026-10-10', [$this->line('Sugar 1kg', 7, 50)]);
        $line = $this->as()->getJson("/api/v1/purchase-orders/{$po}")->json('data.items.0.id');
        $this->as()->postJson("/api/v1/purchase-orders/{$po}/receive", ['items' => [['id' => $line, 'quantity' => 7]]])->assertOk();

        $sugar = collect($this->ask($this->mills)->json('data'))->firstWhere('name', 'Sugar 1kg');
        $this->assertEquals(7, $sugar['in_stock']);
        $this->assertEquals(7, $sugar['last']['quantity']);

        // At one place, that place's shelf: the godown holds none of it.
        $main = Branch::withoutTenancy()->where('tenant_id', $this->owner->tenant_id)->where('is_default', true)->value('id');
        $godown = Branch::withoutTenancy()->create(['tenant_id' => $this->owner->tenant_id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE]);
        $at = fn (string $place) => collect($this->as()->withHeader('X-Branch-Id', $place)
            ->getJson("/api/v1/suppliers/{$this->mills}/products")->assertOk()->json('data'))->firstWhere('name', 'Sugar 1kg')['in_stock'];
        $this->assertEquals(7, $at($main));
        $this->assertEquals(0, $at($godown->id), "another place's stock was read as this one's");
    }

    public function test_another_suppliers_list_is_its_own(): void
    {
        $this->assertSame(['Ghee'], array_column($this->ask($this->other)->json('data'), 'name'));
    }

    private function ask(string $supplier, string $query = ''): TestResponse
    {
        return $this->as()->getJson("/api/v1/suppliers/{$supplier}/products".($query === '' ? '' : "?{$query}"))->assertOk();
    }

    /** @return array<string, mixed> */
    private function line(string $item, float $quantity, float $cost, ?string $size = null): array
    {
        return array_filter([
            'product_id' => $this->item[$item]['id'],
            'variant_id' => $size === null ? null : collect($this->item[$item]['variants'])->firstWhere('name', $size)['id'],
            'quantity' => $quantity,
            'unit_cost' => $cost,
        ], fn ($v) => $v !== null);
    }

    private function order(string $supplier, string $date, array $items): string
    {
        return $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier, 'order_date' => $date, 'status' => 'ordered', 'items' => $items,
        ])->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
