<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * B16 (the tester, 2026-10-14): on Inventory a design's row read one place
 * while its sizes, and every item without sizes, read the whole shop. One
 * screen, three different "where"s.
 *
 * Every row now carries two figures, each asked one way:
 *   `on_hand`       where the person is looking — the whole shop in the
 *                   owner's all-places view, else that place; the stock
 *                   screens read it, and it agrees with their Out of stock;
 *   `branch_stock`  the place a till here sells from — on an item without
 *                   sizes too, which read the shop-wide total and so offered
 *                   stock held at another place.
 */
class AStockFigureSaysWhereItIsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private Branch $main;

    private Branch $godown;

    /** @var array<string, array<string, mixed>> */
    private array $item = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $shop->id)->where('is_default', true)->firstOrFail();
        $this->godown = Branch::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE]);

        $this->item['Rice'] = $this->make(['name' => 'Rice', 'stock_quantity' => 7]);
        $this->item['Salt'] = $this->make(['name' => 'Salt', 'stock_quantity' => 2]);
        $this->item['Kurta'] = $this->make(['name' => 'Kurta', 'variants' => [
            ['name' => 'S', 'price' => 2000, 'stock_quantity' => 4],
            ['name' => 'M', 'price' => 2000, 'stock_quantity' => 2],
        ]]);

        $inventory = app(InventoryService::class);
        $inventory->adjust(['product_id' => $this->item['Rice']['id'], 'branch_id' => $this->godown->id, 'type' => 'in', 'quantity' => 3]);
        $inventory->adjust([
            'product_id' => $this->item['Kurta']['id'], 'variant_id' => $this->sizeId('M'),
            'branch_id' => $this->godown->id, 'type' => 'in', 'quantity' => 5,
        ]);
    }

    public function test_the_owners_all_places_view_shows_the_whole_shop_while_the_till_sells_from_main(): void
    {
        $rows = $this->list();

        $this->assertEquals(10, $rows['Rice']['on_hand'], 'every place: 7 at Main and 3 in the godown');
        $this->assertEquals(7, $rows['Rice']['branch_stock'], 'the till here sells from Main');
        $this->assertEquals(11, $rows['Kurta']['on_hand'], 'the design is its sizes, every place');
        $this->assertEquals(['S' => 4, 'M' => 7], $this->sizes($rows['Kurta'], 'on_hand'));
        $this->assertEquals(['S' => 4, 'M' => 2], $this->sizes($rows['Kurta'], 'branch_stock'));
    }

    public function test_one_place_is_read_as_that_place_and_agrees_with_its_out_of_stock(): void
    {
        $rows = $this->list($this->godown->id);

        $this->assertEquals(3, $rows['Rice']['on_hand']);
        $this->assertEquals(3, $rows['Rice']['branch_stock']);
        $this->assertEquals(5, $rows['Kurta']['on_hand']);
        $this->assertEquals(['S' => 0, 'M' => 5], $this->sizes($rows['Kurta'], 'on_hand'));
        $this->assertEquals(0, $rows['Salt']['on_hand'], 'none of it is in the godown');

        // The screen's own "Out of stock" asks the same question of the same place.
        $out = collect($this->as()->withHeader('X-Branch-Id', $this->godown->id)
            ->getJson('/api/v1/products?out_of_stock=1&per_page=50')->assertOk()->json('data'))->pluck('name')->all();
        $this->assertSame(['Salt'], $out);

        $atMain = $this->list($this->main->id);
        $this->assertEquals(7, $atMain['Rice']['on_hand']);
        $this->assertEquals(2, $atMain['Salt']['on_hand']);
        $this->assertEquals(6, $atMain['Kurta']['on_hand']);
    }

    /** @return array<string, array<string, mixed>> */
    private function list(?string $place = null): array
    {
        $ask = $this->as();
        if ($place !== null) {
            $ask = $ask->withHeader('X-Branch-Id', $place);
        }

        return collect($ask->getJson('/api/v1/products?per_page=50')->assertOk()->json('data'))->keyBy('name')->all();
    }

    /** @return array<string, float> */
    private function sizes(array $row, string $figure): array
    {
        return collect($row['variants'])->mapWithKeys(fn ($v) => [$v['name'] => (float) $v[$figure]])->all();
    }

    private function sizeId(string $name): string
    {
        return collect($this->item['Kurta']['variants'])->firstWhere('name', $name)['id'];
    }

    /** @return array<string, mixed> */
    private function make(array $over): array
    {
        return $this->as()->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'price' => 200, 'cost' => 100, 'track_inventory' => true, ...$over,
        ])->assertCreated()->json('data');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
