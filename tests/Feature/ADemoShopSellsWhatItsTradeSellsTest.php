<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Database\Seeders\CitySeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A DEMO SHOP SELLS WHAT ITS TRADE SELLS.
 *
 * Found by opening a restaurant demo to look at the dine-in floor: the floor
 * said "No tables yet", and the menu — asked for the shop's dishes — came back
 * empty with five dishes in the shop.
 *
 * `CreateDemoShopAction` wrote its products by hand and gave each
 * `item_type = BusinessTypes::primary($businessType)`: the BUSINESS's type in
 * the ITEM's column. A dish was a `food`, a medicine a `pharmacy`, a haircut a
 * `services` with a hundred in stock. There are five item types and none of
 * those is one — and the column is a string, so nothing said no.
 *
 * `test_every_trade_can_open_one` was green throughout. It asserted that the
 * shop was CREATED, which it was; nothing asked whether what was in it could
 * be found, edited or sold. This file asks.
 */
class ADemoShopSellsWhatItsTradeSellsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
    }

    /** Open a demo the way the landing page does. @return array{0: Tenant, 1: string} */
    private function open(string $trade): array
    {
        $res = $this->postJson('/api/v1/demo', ['business_type' => $trade])->assertCreated();
        $tenant = Tenant::query()->where('is_demo', true)->latest('created_at')->orderByDesc('id')
            ->where('business_name', $res->json('data.demo.shop'))->firstOrFail();

        return [$tenant, (string) $res->json('data.access_token')];
    }

    private function as(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_every_item_in_every_trade_is_a_kind_of_item_that_trade_is_offered(): void
    {
        $shopsThatSell = 0;

        foreach (BusinessTypes::codes() as $trade) {
            [$tenant] = $this->open($trade);
            $offered = BusinessTypes::itemTypesFor($trade);
            $shelf = Product::withoutTenancy()->where('tenant_id', $tenant->id)->get();

            if ($offered === []) {
                // Books only. It sells nothing, so it is stocked with nothing.
                $this->assertCount(0, $shelf, "{$trade} sells no items and was given a shelf of them");

                continue;
            }

            $shopsThatSell++;
            $this->assertGreaterThanOrEqual(5, $shelf->count(), "{$trade} demo has almost nothing to sell");

            foreach ($shelf as $item) {
                $this->assertContains(
                    $item->item_type,
                    ItemTypes::codes(),
                    "{$trade}: “{$item->name}” is typed “{$item->item_type}”, which is not an item type at all",
                );
                $this->assertContains(
                    $item->item_type,
                    $offered,
                    "{$trade}: “{$item->name}” is a {$item->item_type}, which this trade is not offered",
                );
                // The coarse half has to agree with the fine one — that is
                // what decided whether a haircut held stock.
                $this->assertSame(ItemTypes::coarse($item->item_type), $item->type->value, "{$trade}: “{$item->name}”");
            }
        }

        // The denominator: a list of trades that all turned out to sell
        // nothing would pass every assertion above.
        $this->assertGreaterThanOrEqual(6, $shopsThatSell);
    }

    public function test_the_first_thing_on_every_shelf_can_be_rung_at_the_till(): void
    {
        // What a demo is FOR. Each shop is signed into as its own owner and
        // sells the first item it was given, through the same endpoint the
        // till uses.
        foreach (['food', 'mart', 'pharmacy', 'retail', 'services', 'automotive'] as $trade) {
            [$tenant, $token] = $this->open($trade);
            $item = Product::withoutTenancy()->where('tenant_id', $tenant->id)->orderBy('created_at')->orderBy('id')->firstOrFail();

            $this->as($token)->postJson('/api/v1/sales', [
                'channel' => 'walk_in',
                'payment_method' => 'cash',
                'amount_paid' => 100000,
                'items' => [['product_id' => $item->id, 'quantity' => 1]],
            ])->assertCreated();
        }
    }

    public function test_a_salon_does_not_count_haircuts(): void
    {
        [$tenant] = $this->open('services');

        $haircut = Product::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', 'Haircut')->sole();

        $this->assertSame(ItemTypes::SERVICE, $haircut->item_type);
        $this->assertFalse((bool) $haircut->track_inventory, 'a haircut was being counted like a tin of beans');
        $this->assertEquals(0, (float) $haircut->stock_quantity);
    }

    public function test_a_chemists_medicine_has_the_lot_it_is_sold_from(): void
    {
        [$tenant] = $this->open('pharmacy');

        $panadol = Product::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', 'Panadol 500mg')->sole();
        $this->assertSame(ItemTypes::MEDICINE, $panadol->item_type);

        $lot = ProductBatch::withoutTenancy()->where('product_id', $panadol->id)->sole();
        $this->assertEquals(100, (float) $lot->quantity);
        $this->assertNotNull($lot->expiry_date, 'a medicine with no expiry is one the till has to refuse');
        $this->assertTrue($lot->expiry_date->isFuture());
    }

    // ── "Tables, kitchen dockets, dine-in" ────────────────────────────

    public function test_a_restaurant_demo_has_a_floor_and_a_menu_its_own_screens_can_find(): void
    {
        [$tenant, $token] = $this->open('food');

        // The floor screen's own payload — not a count of rows in a table.
        $floor = $this->as($token)->getJson('/api/v1/restaurant/floor')->assertOk()->json('data');
        $this->assertCount(12, $floor['tables']);
        $this->assertSame(['Hall', 'Family', 'Rooftop'], array_values(array_unique(array_column($floor['tables'], 'area'))));

        // And the menu, asked for the way the tab screen asks: dishes.
        $dishes = $this->as($token)->getJson('/api/v1/products?item_type='.ItemTypes::FOOD.'&per_page=100')
            ->assertOk()->json('data');
        $this->assertCount(19, $dishes, 'the shop has a menu its own menu screen cannot find');

        // Every dish is filed under a section, so the tab's category chips
        // have something to filter.
        $this->assertSame([], array_values(array_filter($dishes, fn ($d) => empty($d['category_id']))));
        $this->assertSame(12, DiningTable::withoutTenancy()->where('tenant_id', $tenant->id)->where('is_active', true)->count());
    }

    public function test_an_order_in_the_demo_splits_between_the_grill_and_the_tandoor(): void
    {
        // The minute a visitor came for: seat a table, order, send it.
        [$tenant, $token] = $this->open('food');
        $table = DiningTable::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', 'T1')->sole();
        $dish = fn (string $name) => Product::withoutTenancy()->where('tenant_id', $tenant->id)->where('name', $name)->sole()->id;

        $tab = $this->as($token)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $table->id, 'guest_count' => 4,
        ])->assertCreated()->json('data');

        $this->as($token)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [
                ['product_id' => $dish('Chicken Karahi'), 'quantity' => 1],
                ['product_id' => $dish('Garlic Naan'), 'quantity' => 4],
                ['product_id' => $dish('Mint Margarita'), 'quantity' => 2],
            ],
        ])->assertSuccessful();

        $kots = $this->as($token)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", [])
            ->assertSuccessful()->json('data');

        $stations = array_column($kots, 'station');
        sort($stations);
        $this->assertSame(['Bar', 'Grill', 'Tandoor'], $stations);

        // 1,450 + 4 × 80 + 2 × 320, on the floor's own tile.
        $tile = collect($this->as($token)->getJson('/api/v1/restaurant/floor')->json('data.tables'))->firstWhere('name', 'T1');
        $this->assertEquals(2410, $tile['open_ticket']['to_pay']);
        $this->assertSame(3, $tile['open_ticket']['cooking']);
    }
}
