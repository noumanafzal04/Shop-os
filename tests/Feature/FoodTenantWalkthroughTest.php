<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Product;
use App\Models\RestaurantTicketItem;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * One restaurant, walked the way its owner walks it — the QA pass for `food`.
 *
 * The module suites around this one are thorough and each is right about its
 * own module: FoodServiceTest proves station routing, RestaurantDineInTest
 * proves split settlement, TableOwnershipTest proves a tab belongs to its
 * waiter, RecipeBomTest proves a dish eats its ingredients. Every one of them
 * seeds the rows it needs straight into the database and then exercises one
 * endpoint.
 *
 * That is exactly the gap this file covers. A shopkeeper does not seed rows.
 * They type the stations into Settings, type the menu into the catalog, hire a
 * waiter off a job preset, and then expect the kitchen screen to know that the
 * lassi is made at the bar. Every link in that sentence is a different module
 * writing something a later module reads, and a link that silently does nothing
 * is invisible to a suite that never crosses it — `kitchen_station` was
 * validated by the product form and written by nothing for months, so every
 * dish went to the default station while the routing tests stayed green.
 *
 * So the chains here always start at a form an owner actually fills in and
 * assert at the far end:
 *
 *   settings → catalog → floor → kitchen board   (the bar never gets the karahi)
 *   catalog:variants → floor → pass → bill       (a half portion, billed as one)
 *   floor:takeaway → pass, and NOT the floor      (a bag holds no table)
 *   floor → sales → service report → cashbook    (a split bill, both halves)
 *   module grant → supplier → PO → recipe → tab  (what receiving does to a dish)
 *   dine-in + expenses → one day's books         (gas and rent are real)
 *   staff preset → floor → ownership → report    (whose evening it was)
 *   staff preset → kitchen board → bump          (and no money on that screen)
 *   branch → floor + board (absent)              (documented, not endorsed)
 */
class FoodTenantWalkthroughTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        // 'restaurant' rather than 'food': it is the code an owner picks at
        // signup, and it has to collapse to the food trade on its own.
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
    }

    // ── settings → catalog → floor → kitchen board ──────────────────

    public function test_the_owner_types_in_a_menu_and_the_bar_never_gets_the_karahi(): void
    {
        // Stations are typed into Settings, not seeded. Everything downstream
        // (product form, fire, board tabs) reads this one list, so a settings
        // write that doesn't land takes the whole routing chain with it.
        $this->as($this->owner)->putJson('/api/v1/shop/settings', [
            'kitchen_stations' => ['Kitchen', 'Bar'],
        ])->assertOk()->assertJsonPath('data.kitchen_stations', ['Kitchen', 'Bar']);

        $mains = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Main Course'])
            ->assertCreated()->json('data.id');

        $karahi = $this->dish('Chicken Karahi', 1400, station: 'Kitchen', extra: ['category_id' => $mains]);
        $lassi = $this->dish('Sweet Lassi', 250, station: 'Bar');

        // Read the dish back before anything relies on it. The failure this
        // guards actually happened: the create path named its columns one by
        // one, kitchen_station was not among them, and the field looked like it
        // worked because the second save (a different action) wrote it.
        $this->as($this->owner)->getJson("/api/v1/products/{$lassi['id']}")
            ->assertOk()->assertJsonPath('data.kitchen_station', 'Bar');

        // A chilli level the cook must see and the customer must pay for.
        $groups = $this->as($this->owner)->putJson("/api/v1/products/{$karahi['id']}/modifier-groups", [
            'groups' => [[
                'name' => 'Spice', 'min_select' => 1, 'max_select' => 1,
                'options' => [
                    ['name' => 'Medium', 'price_delta' => 0, 'is_default' => true],
                    ['name' => 'Extra spicy', 'price_delta' => 50],
                ],
            ]],
        ])->assertOk()->json('data.modifier_groups');

        $extraSpicy = collect($groups[0]['options'])->firstWhere('name', 'Extra spicy')['id'];

        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', [
            'name' => 'T1', 'seats' => 4,
        ])->assertCreated()->json('data');

        $tab = $this->openTab($this->owner, $table['id'], guests: 2);

        // No prices are sent — the tab is priced by the server from the menu
        // the owner typed, modifier included.
        $tab = $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [
                ['product_id' => $karahi['id'], 'quantity' => 2, 'modifier_option_ids' => [$extraSpicy], 'note' => 'No onions'],
                ['product_id' => $lassi['id'], 'quantity' => 2],
            ],
        ])->assertOk()->json('data');

        // 2 × (1400 + 50) + 2 × 250. If the modifier delta went missing the
        // shop is giving away the upsell it charged the kitchen for.
        $this->assertEquals(3400, $tab['running_total'], 'The tab was not priced off the menu plus its modifier.');

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        // The board is a different module reading what the floor wrote. Assert
        // on data.kots — the envelope is {kots, stations, server_time} and is
        // never empty, so "not empty" is true of a kitchen that cooked nothing.
        $board = $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data');

        $this->assertCount(2, $board['kots'], 'One fire across two sections did not produce a ticket each.');

        $bar = collect($board['kots'])->firstWhere('station', 'Bar');
        $kitchen = collect($board['kots'])->firstWhere('station', 'Kitchen');

        $this->assertNotNull($bar, 'Nothing reached the bar — the drink was routed by the fallback, not by its station.');
        $this->assertNotNull($kitchen, 'Nothing reached the kitchen.');

        // The whole reason stations exist. A bar handed the karahi ticket
        // cooks nothing and the grill plates a drink late.
        $this->assertSame(['Sweet Lassi'], array_column($bar['items'], 'name'), 'The bar ticket carried food the bar does not make.');
        $this->assertSame(['Chicken Karahi'], array_column($kitchen['items'], 'name'), 'The kitchen ticket carried the drink.');

        // The cook needs the choice and the note, and must never see what the
        // choice was charged for — a price on the pass is a bill on the wrong
        // side of the shop.
        $line = $kitchen['items'][0];
        $this->assertSame('Extra spicy', $line['modifiers'][0]['name'] ?? null, 'The kitchen was not told how spicy to make it.');
        $this->assertArrayNotHasKey('price_delta', $line['modifiers'][0]);
        $this->assertSame('No onions', $line['note']);
        $this->assertStringNotContainsString('1450', json_encode($board));
    }

    // ── catalog:variants → floor → kitchen board ────────────────────

    public function test_a_half_portion_is_billed_as_a_half_and_the_cook_is_told_which_size(): void
    {
        // Half and full plates are how a desi menu is actually written, and the
        // size has to survive two different modules: the bill (a half charged
        // as a full is an argument at the table) and the pass (a cook handed
        // "Karahi ×2" with no size plates two fulls and the shop eats it).
        $karahi = $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Chicken Karahi', 'price' => 1400,
            'variants' => [
                ['name' => 'Half', 'price' => 800],
                ['name' => 'Full', 'price' => 1400],
            ],
        ])->assertCreated()->json('data');

        $half = collect($karahi['variants'])->firstWhere('name', 'Half')['id'];
        $full = collect($karahi['variants'])->firstWhere('name', 'Full')['id'];

        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T7', 'seats' => 2])
            ->assertCreated()->json('data');
        $tab = $this->openTab($this->owner, $table['id'], guests: 2);

        $tab = $this->addItems($this->owner, $tab['id'], [
            ['product_id' => $karahi['id'], 'variant_id' => $half, 'quantity' => 1],
            ['product_id' => $karahi['id'], 'variant_id' => $full, 'quantity' => 1],
        ]);

        // 800 + 1400. Priced off the variant, not off the parent's price.
        $this->assertEquals(2200, $tab['running_total'], 'A half portion was not billed at the half price.');

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        $kots = $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $this->assertCount(1, $kots, 'Two sizes of one dish were split across two tickets.');
        $this->assertSame(
            ['Chicken Karahi (Half)', 'Chicken Karahi (Full)'],
            array_column($kots[0]['items'], 'name'),
            'The pass was not told which size to cook.',
        );

        $sale = $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 2200,
        ])->assertCreated()->json('data.sale');

        $this->assertEquals(2200, $sale['total'], 'The bill and the tab disagreed about the size.');
    }

    // ── takeaway: a tab that occupies no table ──────────────────────

    public function test_a_takeaway_tab_reaches_the_pass_without_taking_a_table_out_of_service(): void
    {
        $burger = $this->dish('Zinger Burger', 600);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T1', 'seats' => 4])
            ->assertCreated()->json('data');

        // No dining_table_id at all — the counter, not the floor.
        $tab = $this->as($this->owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'takeaway', 'customer_name' => 'Adnan',
        ])->assertCreated()->json('data');

        $this->addItems($this->owner, $tab['id'], [['product_id' => $burger['id'], 'quantity' => 2]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        // The pass must be able to tell a bag from a table: "Takeaway" is what
        // the cook reads instead of a table number.
        $kots = $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $this->assertCount(1, $kots, 'A takeaway order never reached the kitchen screen.');
        $this->assertSame('Takeaway', $kots[0]['table_name']);
        $this->assertNull($kots[0]['guest_count']);

        // And the floor is untouched. A takeaway that quietly seats itself at
        // T1 costs the restaurant that table for the whole evening.
        $floor = $this->as($this->owner)->getJson('/api/v1/restaurant/tables')->assertOk()->json('data');
        $t1 = collect($floor)->firstWhere('id', $table['id']);
        $this->assertNull($t1['open_ticket'], 'A takeaway order occupied a dining table.');

        $sale = $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1200,
        ])->assertCreated()->json('data.sale');

        $this->assertEquals(1200, $sale['total']);
        // The order type survives into the books — a shop splitting dine-in
        // from takeaway revenue reads this column, not the table.
        $this->assertSame('takeaway', $sale['order_type']);
        $this->assertNull($sale['table_no']);
    }

    // ── floor → two sales → service report → cashbook ───────────────

    public function test_a_split_bill_lands_as_two_sales_on_one_waiters_evening(): void
    {
        // Two friends paying for their own share is the ordinary case, and the
        // seam it crosses is the expensive one: each share rings its own Sale,
        // and the service report has to find BOTH of them through the tab.
        // Attribute one and the tips paid off that report are wrong.
        $imran = $this->hire('waiter', 'Imran');
        $karahi = $this->dish('Chicken Karahi', 1400);
        $lassi = $this->dish('Sweet Lassi', 250);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T4', 'seats' => 4])
            ->assertCreated()->json('data');

        $tab = $this->openTab($imran, $table['id'], guests: 4);
        $tab = $this->addItems($imran, $tab['id'], [
            ['product_id' => $karahi['id'], 'quantity' => 2],
            ['product_id' => $lassi['id'], 'quantity' => 2],
        ]);

        $this->assertEquals(3300, $tab['running_total']);

        $food = collect($tab['items'])->firstWhere('product_name', 'Chicken Karahi')['id'];
        $drink = collect($tab['items'])->firstWhere('product_name', 'Sweet Lassi')['id'];

        // Share one: the food. The tab must stay OPEN — a bill that closes on
        // the first payer leaves the second half unpayable.
        $first = $this->as($imran)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'item_ids' => [$food], 'payment_method' => 'cash', 'amount_paid' => 2800,
        ])->assertCreated()->json('data');

        $this->assertEquals(2800, $first['sale']['total']);
        $this->assertSame('open', $first['ticket']['status']);

        // Share two: the drinks. Now it closes.
        $second = $this->as($imran)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'item_ids' => [$drink], 'payment_method' => 'card', 'amount_paid' => 500,
        ])->assertCreated()->json('data');

        $this->assertEquals(500, $second['sale']['total']);
        $this->assertSame('closed', $second['ticket']['status']);

        // The far end #1: the service report reaches the sales THROUGH the tab
        // items, so a split bill must count as one table and two sales.
        $rows = $this->as($this->owner)->getJson('/api/v1/restaurant/reports/waiters')
            ->assertOk()->json('data.rows');

        $row = collect($rows)->firstWhere('waiter_name', 'Imran');
        $this->assertNotNull($row, 'The waiter who served the table is missing from the service report.');
        $this->assertSame(1, $row['tables'], 'A split bill was counted as two tables.');
        $this->assertSame(4, $row['covers']);
        $this->assertSame(2, $row['sales_count'], 'Only one half of the split reached the service report.');
        $this->assertEquals(3300, $row['sales_total']);

        // The far end #2: the books. Assert on the figure — the cashbook emits
        // a row per day whether or not the shop opened.
        $today = collect($this->as($this->owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertEquals(3300, $today['sales_revenue'], 'The evening never reached the books.');
    }

    // ── module grant → supplier → PO → recipe → tab ─────────────────

    public function test_a_kitchen_that_buys_its_chicken_must_first_be_given_the_stock_module(): void
    {
        // A restaurant does NOT get the inventory module by default — its
        // dishes are made to order and carry no stock of their own. The moment
        // it wants to count what it buys, an admin has to grant it, and the
        // refusal before that has to be a shut door rather than an empty list:
        // an empty supplier list reads as "you have no suppliers", which is a
        // different and much worse answer than "this shop doesn't do that yet".
        $this->as($this->owner)->getJson('/api/v1/suppliers')->assertForbidden();
        $this->as($this->owner)->getJson('/api/v1/purchase-orders')->assertForbidden();

        $this->grantModule('inventory');

        $chicken = $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Chicken (raw)', 'unit' => 'kg',
            'price' => 0, 'cost' => 700, 'stock_quantity' => 0,
        ])->assertCreated()->json('data');
        $this->assertTrue((bool) $chicken['track_inventory'], 'A raw ingredient came in untracked.');

        // The dish itself: made to order, no stock, but it eats 0.4kg a plate.
        $karahi = $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Chicken Karahi', 'price' => 1400,
            'recipe_items' => [['ingredient_product_id' => $chicken['id'], 'quantity' => 0.4]],
        ])->assertCreated()->json('data');
        $this->assertFalse((bool) $karahi['track_inventory']);

        $supplier = $this->as($this->owner)->postJson('/api/v1/suppliers', [
            'name' => 'Tollinton Poultry', 'phone' => '+923004455667',
        ])->assertCreated()->json('data.id');

        // Both lines on ONE order, because that is how the answer to "does
        // receiving move stock for a restaurant?" is actually visible: the
        // ingredient must move and the made-to-order dish must not.
        $po = $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [
                ['product_id' => $chicken['id'], 'quantity' => 10, 'unit_cost' => 700],
                ['product_id' => $karahi['id'], 'quantity' => 5, 'unit_cost' => 0],
            ],
        ])->assertCreated()->json('data');

        $this->as($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive")->assertOk();

        $this->assertEquals(10, Product::withoutTenancy()->find($chicken['id'])->stock_quantity, 'Receiving a PO did not move the ingredient in.');
        $this->assertEquals(0, Product::withoutTenancy()->find($karahi['id'])->stock_quantity, 'Receiving created stock for a dish that is made to order.');
        $this->assertSame(0, StockMovement::withoutTenancy()->where('product_id', $karahi['id'])->count());

        // Now serve two plates through the floor, not the counter. The recipe
        // deduction hangs off the Sale, and a settled tab has to reach it the
        // same way a till sale does or the walk-in and the dine-in tell
        // different stories about the same chicken.
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T2', 'seats' => 2])
            ->assertCreated()->json('data');
        $tab = $this->openTab($this->owner, $table['id'], guests: 2);
        $this->addItems($this->owner, $tab['id'], [['product_id' => $karahi['id'], 'quantity' => 2]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 2800,
        ])->assertCreated();

        // 10kg − 2 plates × 0.4kg.
        $this->assertEqualsWithDelta(
            9.2,
            (float) Product::withoutTenancy()->find($chicken['id'])->stock_quantity,
            0.001,
            'Settling a tab did not consume the dish\'s ingredients.',
        );
    }

    // ── dine-in + expenses → one day's books ────────────────────────

    public function test_the_gas_cylinder_and_the_rent_land_in_the_same_day_as_the_dinner_service(): void
    {
        // A restaurant's day is takings minus what it spent to cook them, and
        // the two arrive from different modules. The cashbook is where they
        // have to meet; a shop reading only sales thinks it had a good night.
        $karahi = $this->dish('Chicken Karahi', 1400);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T3', 'seats' => 2])
            ->assertCreated()->json('data');

        $tab = $this->openTab($this->owner, $table['id'], guests: 2);
        $this->addItems($this->owner, $tab['id'], [['product_id' => $karahi['id'], 'quantity' => 1]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1400,
        ])->assertCreated();

        $utilities = $this->as($this->owner)->postJson('/api/v1/expense-categories', ['name' => 'Utilities'])
            ->assertCreated()->json('data.id');
        $rent = $this->as($this->owner)->postJson('/api/v1/expense-categories', ['name' => 'Rent'])
            ->assertCreated()->json('data.id');

        $this->as($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $utilities,
            'description' => 'LPG cylinder refill',
            'amount' => 4200,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'cash',
        ])->assertCreated();

        $this->as($this->owner)->postJson('/api/v1/expenses', [
            'expense_category_id' => $rent,
            'description' => 'Shop rent',
            'amount' => 60000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ])->assertCreated();

        $today = collect($this->as($this->owner)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertNotNull($today, 'Today is missing from the cashbook.');
        $this->assertEquals(1400, $today['sales_revenue'], 'The settled tab never reached the books.');
        $this->assertEquals(64200, $today['expenses'], 'What the kitchen spent never reached the books.');
        // The honest answer for one table and a month's rent on the same day.
        $this->assertEquals(-62800, $today['net']);
    }

    // ── staff preset → floor → ownership → report ───────────────────

    public function test_a_waiter_hired_off_the_preset_works_their_own_table_and_only_theirs(): void
    {
        // The person axis, walked the way an owner walks it: pick the job from
        // the preset list, hire, and the new starter must be able to do that
        // job on their first shift without anyone ticking a second box.
        $presets = collect($this->as($this->owner)->getJson('/api/v1/staff/presets')->assertOk()->json('data'));
        $waiterPreset = $presets->firstWhere('code', 'waiter');
        $this->assertNotNull($waiterPreset, 'A restaurant was not offered the Waiter job.');

        $imran = $this->hire('waiter', 'Imran');
        $sana = $this->hire('waiter', 'Sana');
        $cashier = $this->hire('cashier', 'Faisal');

        $karahi = $this->dish('Chicken Karahi', 1400);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T5', 'seats' => 4])
            ->assertCreated()->json('data');

        // Imran does the whole job: seat, ring, send.
        $tab = $this->openTab($imran, $table['id'], guests: 3);
        $this->assertSame($imran->id, $tab['waiter_id'], 'Opening a tab did not make it the opener\'s table.');

        $this->addItems($imran, $tab['id'], [['product_id' => $karahi['id'], 'quantity' => 1]]);
        $this->as($imran)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        $kots = $this->as($imran)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $this->assertCount(1, $kots, 'A waiter fired an order that never reached the kitchen.');

        // Sana may LOOK at the table — a floor where half the tables are blank
        // is worse than one where half are read-only.
        $this->as($sana)->getJson("/api/v1/restaurant/tickets/{$tab['id']}")
            ->assertOk()->assertJsonPath('data.waiter.name', 'Imran');

        // But not write to it. This is what keeps the service report true.
        $this->as($sana)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $karahi['id'], 'quantity' => 1]],
        ])->assertForbidden()->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');

        // The till settles anyone's table — the cashier preset carries
        // tables.serve_any precisely so payment is never blocked by ownership.
        $this->as($cashier)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1400,
        ])->assertCreated();

        // And the evening still belongs to Imran, not to whoever took the
        // money. A restaurant paying tips off this report pays the wrong
        // person the moment settlement decides attribution.
        $rows = collect($this->as($this->owner)->getJson('/api/v1/restaurant/reports/waiters')
            ->assertOk()->json('data.rows'));

        $this->assertCount(1, $rows, 'The cashier who settled the bill was credited with a table.');
        $this->assertSame('Imran', $rows[0]['waiter_name']);
        $this->assertEquals(1400, $rows[0]['sales_total'], 'The table\'s takings were not credited to its waiter.');
    }

    // ── staff preset → kitchen board → bump ─────────────────────────

    public function test_the_kitchen_hire_works_the_board_and_is_shown_no_money(): void
    {
        $bilal = $this->hire('kitchen', 'Bilal');
        $karahi = $this->dish('Chicken Karahi', 1400);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T6', 'seats' => 2])
            ->assertCreated()->json('data');

        $tab = $this->openTab($this->owner, $table['id'], guests: 2);
        $this->addItems($this->owner, $tab['id'], [['product_id' => $karahi['id'], 'quantity' => 1]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        $kots = $this->as($bilal)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $this->assertCount(1, $kots, 'The kitchen hire cannot see the board they were hired to work.');
        $this->assertSame('Chicken Karahi', $kots[0]['items'][0]['name']);

        $kotId = $kots[0]['id'];

        $this->as($bilal)->postJson("/api/v1/restaurant/kitchen/kot/{$kotId}/bump", ['status' => 'ready'])->assertOk();

        // Still on the board, now flagged for the runner to pick up.
        $board = $this->as($bilal)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $this->assertCount(1, $board);
        $this->assertSame('ready', $board[0]['status'], 'A bump did not advance the ticket on the screen.');

        $this->as($bilal)->postJson("/api/v1/restaurant/kitchen/kot/{$kotId}/bump", ['status' => 'served'])->assertOk();

        // Served food leaves the screen, or the queue grows all evening and
        // the cook stops trusting it.
        $this->assertSame([], $this->as($bilal)->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots'));

        // And the floor's own view of that line agrees — the waiter screen
        // reads kot_status per line, not per KOT.
        $this->assertSame(
            'served',
            RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->value('kot_status'),
            'The pass says served and the floor still says fired.',
        );

        // The kitchen preset is a cook, not a manager: the money screens stay
        // shut. A KDS that doubles as a reports terminal is how takings walk.
        $this->as($bilal)->getJson('/api/v1/restaurant/reports/waiters')->assertForbidden();
        $this->as($bilal)->getJson('/api/v1/cashbook?'.http_build_query([
            'from' => now()->toDateString(), 'to' => now()->toDateString(),
        ]))->assertForbidden();

        // The tab is still payable after the food went out — cooking is not
        // settling, and nothing on the kitchen screen may close a bill.
        $sale = $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1400,
        ])->assertCreated()->json('data.sale');

        $this->assertEquals(1400, Sale::withoutTenancy()->findOrFail($sale['id'])->total);
    }

    // ── The second branch: what the floor does NOT know ─────────────

    /**
     * DOCUMENTS CURRENT BEHAVIOUR — this is not the behaviour a two-site
     * restaurant wants, and the test is written to the truth so the suite stays
     * honest rather than green-by-omission.
     *
     * Money is branch-scoped: a sale carries branch_id and the cashbook filters
     * by it. The dine-in floor is not — `dining_tables`, `restaurant_tickets`
     * and `kitchen_tickets` have no branch column at all, so the operating
     * branch cannot filter them even in principle. A shop with a second site
     * therefore has ONE floor and ONE kitchen queue shared between them: the
     * Gulberg pass shows the DHA tickets and both screens fight over the same
     * table numbers.
     *
     * For the single-site restaurant this is invisible and correct, which is
     * why it has survived. What it should be: tables/tabs/KOTs stamped with the
     * branch they belong to and both screens filtered by the operating branch.
     * When that lands, this test is the one that fails and says so.
     */
    public function test_a_second_branch_keeps_its_own_floor_and_its_own_kitchen_queue(): void
    {
        $gulberg = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Gulberg', 'is_default' => false, 'is_active' => true,
        ]);

        $karahi = $this->dish('Chicken Karahi', 1400);
        $table = $this->as($this->owner)->postJson('/api/v1/restaurant/tables', ['name' => 'T9', 'seats' => 2])
            ->assertCreated()->json('data');

        // Opened, rung and fired on the DEFAULT (Main) branch.
        $tab = $this->openTab($this->owner, $table['id'], guests: 2);
        $this->addItems($this->owner, $tab['id'], [['product_id' => $karahi['id'], 'quantity' => 1]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertCreated();

        // Read from the OTHER branch. Both are empty — fixed 2026-08-10, when
        // the three floor tables gained a branch_id. Before that the Gulberg
        // pass showed DHA's fired tickets, cooks worked another kitchen's
        // orders, and two waiters at different addresses fought over "T1".
        $kots = $this->atBranch($this->owner, $gulberg)
            ->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');
        $floor = $this->atBranch($this->owner, $gulberg)
            ->getJson('/api/v1/restaurant/tables')->assertOk()->json('data');

        $this->assertSame([], $kots, "Another site's food is on this kitchen's pass.");
        $this->assertSame([], array_column($floor, 'name'), "Another site's tables are on this floor.");

        // And the site that owns them still has both — a scope that hides
        // everything from everyone would pass the two assertions above.
        $ownKots = $this->as($this->owner)
            ->getJson('/api/v1/restaurant/kitchen')->assertOk()->json('data.kots');

        $this->assertCount(1, $ownKots, 'The branch that fired the course cannot see it.');
        $this->assertSame('Chicken Karahi', $ownKots[0]['items'][0]['name']);
        $this->assertSame(['T9'], array_column(
            $this->as($this->owner)->getJson('/api/v1/restaurant/tables')->assertOk()->json('data'),
            'name',
        ));

        // The money side already knows better, which is the whole contrast:
        // settle on Main and Gulberg's cashbook stays empty.
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1400,
        ])->assertCreated();

        $gulbergToday = collect($this->atBranch($this->owner, $gulberg)
            ->getJson('/api/v1/cashbook?'.http_build_query([
                'from' => now()->toDateString(), 'to' => now()->toDateString(),
            ]))->assertOk()->json('data.days'))->firstWhere('date', now()->toDateString());

        $this->assertEquals(0, $gulbergToday['sales_revenue'], 'A sale rung at Main showed up in the other branch\'s books.');
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /**
     * Sign in. The header flush is not decoration: withHeaders() sticks to the
     * test for every later request, so one branch-scoped read further up a test
     * silently rings the next sale on that branch. That cost an hour and read
     * exactly like an application bug.
     */
    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    /** The same user, working a named branch (the X-Branch-Id the panel sends). */
    private function atBranch(User $user, Branch $branch): static
    {
        return $this->as($user)->withHeaders(['X-Branch-Id' => $branch->id]);
    }

    /** A menu item as a restaurant creates one: through the form, no stock. */
    private function dish(string $name, float $price, ?string $station = null, array $extra = []): array
    {
        return $this->as($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item',
            'name' => $name,
            'price' => $price,
            ...($station !== null ? ['kitchen_station' => $station] : []),
            ...$extra,
        ])->assertCreated()->json('data');
    }

    /** Hire off a job preset — exactly the permissions the panel would post. */
    private function hire(string $preset, string $name): User
    {
        $permissions = StaffPresets::permissionsFor($preset);
        $this->assertNotEmpty($permissions, "There is no {$preset} preset to hire from.");

        $id = $this->as($this->owner)->postJson('/api/v1/staff', [
            'name' => $name,
            'email' => strtolower($name).'@shop.test',
            'password' => 'secret-password',
            'permissions' => $permissions,
        ])->assertCreated()->json('data.id');

        return User::query()->findOrFail($id);
    }

    private function openTab(User $user, ?string $tableId, int $guests): array
    {
        return $this->as($user)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in',
            'dining_table_id' => $tableId,
            'guest_count' => $guests,
        ])->assertCreated()->json('data');
    }

    private function addItems(User $user, string $tabId, array $items): array
    {
        return $this->as($user)->postJson("/api/v1/restaurant/tickets/{$tabId}/items", ['items' => $items])
            ->assertOk()->json('data');
    }

    /** What an admin does when a shop asks for a module it wasn't given. */
    private function grantModule(string $module): void
    {
        $this->shop->forceFill([
            'features' => array_merge($this->shop->features ?? [], [$module => true]),
        ])->save();
        $this->shop->refresh();
    }
}
