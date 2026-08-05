<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * FOOD-business edge cases around dine-in tabs and serving windows:
 * cancelling a whole open tab (state + settle blocked after), split settlement
 * with modifier-priced lines summing exactly to the tab total, per-item
 * inventory behaviour at settlement (tracked vs default food items), and the
 * serving-window fence at the counter / online orders / tab building —
 * including a cross-midnight (22:00–02:00) window.
 */
class FoodEdgeCasesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'online_shop_enabled' => true,
            'business_type' => 'food',
            'features' => BusinessTypes::defaultFeatures('food'), // dine_in on
            'timezone' => 'UTC', // deterministic serving-window clock
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'area' => 'Hall', 'seats' => 4,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function foodItem(array $overrides = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Chicken Biryani', 'price' => 400,
            'track_inventory' => false, 'is_active' => true, 'visible_in_marketplace' => true,
        ], $overrides));
    }

    private function openTab(): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');
    }

    private function addItems(string $ticketId, array $items)
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$ticketId}/items", ['items' => $items]);
    }

    private function settle(string $ticketId, array $payload)
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$ticketId}/settle", $payload);
    }

    // ── (1) Cancelling a whole open tab ──────────────────────────────

    public function test_cancelling_an_open_tab_voids_every_line_and_frees_the_table(): void
    {
        $dish = $this->foodItem();
        $cola = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Cola Can', 'price' => 100, 'track_inventory' => true,
            'stock_quantity' => 10, 'is_active' => true,
        ]);

        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $dish->id, 'quantity' => 1],
            ['product_id' => $cola->id, 'quantity' => 2],
        ])->assertOk();

        // The kitchen has already been fired — guests walk out anyway.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", ['station' => 'Kitchen'])
            ->assertCreated();

        $res = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason_code' => 'wrong_item', 'reason' => 'Guests walked out'])
            ->assertOk()->json('data');

        // Tab is void, every line is void.
        $this->assertSame('void', $res['status']);
        $this->assertCount(2, $res['items']);
        foreach ($res['items'] as $item) {
            $this->assertSame('void', $item['kot_status']);
            $this->assertNotNull($item['voided_at']);
        }

        // No money rang, no stock moved — nothing was ever billed.
        $this->assertSame(0, Sale::withoutTenancy()->count());
        $this->assertSame(10.0, (float) $cola->refresh()->stock_quantity);
        $this->assertSame(0, StockMovement::withoutTenancy()->where('reference_type', 'sale')->count());

        // The table is free again: a fresh tab opens on T1 without conflict.
        $this->openTab();
    }

    public function test_a_cancelled_tab_rejects_settlement_and_new_items(): void
    {
        $dish = $this->foodItem();
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $dish->id, 'quantity' => 2]])->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason_code' => 'wrong_item'])->assertOk();

        // Paying a voided tab must be impossible…
        $this->settle($tab['id'], ['payment_method' => 'cash', 'amount_paid' => 800])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');

        // …as is extending it or cancelling it twice.
        $this->addItems($tab['id'], [['product_id' => $dish->id, 'quantity' => 1]])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');

        $this->assertSame(0, Sale::withoutTenancy()->count());
    }

    public function test_cancel_refuses_once_part_of_the_tab_is_paid(): void
    {
        $karahi = $this->foodItem(['name' => 'Beef Karahi', 'price' => 600]);
        $naan = $this->foodItem(['name' => 'Garlic Naan', 'price' => 400]);

        $tab = $this->openTab();
        $tab = $this->addItems($tab['id'], [
            ['product_id' => $karahi->id, 'quantity' => 1],
            ['product_id' => $naan->id, 'quantity' => 1],
        ])->assertOk()->json('data');
        $karahiLine = collect($tab['items'])->firstWhere('product_id', $karahi->id)['id'];

        // One guest pays their share and leaves.
        $this->settle($tab['id'], [
            'item_ids' => [$karahiLine], 'payment_method' => 'cash', 'amount_paid' => 600,
        ])->assertCreated()->assertJsonPath('data.ticket.status', 'open');

        // Voiding the whole tab now would orphan a real sale — refused.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TICKET_PARTLY_SETTLED');

        // The tab survived intact: exactly the unpaid remainder is still owed.
        $r2 = $this->settle($tab['id'], ['payment_method' => 'cash', 'amount_paid' => 400])
            ->assertCreated()->json('data');
        $this->assertSame('400.00', $r2['sale']['total']);
        $this->assertSame('closed', $r2['ticket']['status']);
        $this->assertSame(2, Sale::withoutTenancy()->count());
    }

    // ── (2) Split settlement with modifier-priced lines ──────────────

    public function test_split_settlement_with_modifier_prices_sums_exactly_to_the_tab_total(): void
    {
        $pizza = $this->foodItem(['name' => 'Pepperoni Pizza', 'price' => 1000]);
        $groups = $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Thin', 'price_delta' => 0],
                    ['name' => 'Stuffed', 'price_delta' => 200],
                ]],
                ['name' => 'Extras', 'type' => 'addon', 'min_select' => 0, 'max_select' => 3, 'options' => [
                    ['name' => 'Cheese', 'price_delta' => 150],
                    ['name' => 'Olives', 'price_delta' => 100],
                ]],
            ],
        ])->assertOk()->json('data.modifier_groups');
        $opt = function (string $group, string $name) use ($groups): string {
            $g = collect($groups)->firstWhere('name', $group);

            return collect($g['options'])->firstWhere('name', $name)['id'];
        };

        $tab = $this->openTab();
        $tab = $this->addItems($tab['id'], [
            // 1000 + 200 + 150 = 1350 × 1
            ['product_id' => $pizza->id, 'quantity' => 1,
                'modifier_option_ids' => [$opt('Crust', 'Stuffed'), $opt('Extras', 'Cheese')]],
            // 1000 + 0 + 100 = 1100 × 2 = 2200
            ['product_id' => $pizza->id, 'quantity' => 2,
                'modifier_option_ids' => [$opt('Crust', 'Thin'), $opt('Extras', 'Olives')]],
        ])->assertOk()->json('data');

        $this->assertEquals(3550, $tab['running_total']);
        $stuffedLine = collect($tab['items'])->firstWhere('unit_price', '1350.00')['id'];

        // Split 1: the stuffed pizza alone — its sale carries the modifier price.
        $r1 = $this->settle($tab['id'], [
            'item_ids' => [$stuffedLine], 'payment_method' => 'cash', 'amount_paid' => 1350,
        ])->assertCreated()->json('data');
        $this->assertSame('1350.00', $r1['sale']['total']);
        $this->assertSame('1350.00', $r1['sale']['items'][0]['unit_price']);
        $this->assertSame('open', $r1['ticket']['status']);

        // Split 2: the remainder.
        $r2 = $this->settle($tab['id'], ['payment_method' => 'card', 'amount_paid' => 2200])
            ->assertCreated()->json('data');
        $this->assertSame('2200.00', $r2['sale']['total']);
        $this->assertSame('closed', $r2['ticket']['status']);

        // The two part-sales reconstruct the tab total to the paisa.
        $sum = bcadd($r1['sale']['total'], $r2['sale']['total'], 2);
        $this->assertSame(number_format((float) $tab['running_total'], 2, '.', ''), $sum);
        $this->assertSame(2, Sale::withoutTenancy()->count());
    }

    // ── (3) Inventory behaviour at settlement ────────────────────────

    public function test_settlement_moves_stock_only_for_tracked_food_items(): void
    {
        // Both created through the API: one opts INTO stock tracking, the
        // other relies on the food_item default (inventory optional → off).
        $tracked = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Frozen Shami Kebab', 'price' => 800,
            'track_inventory' => true, 'stock_quantity' => 10,
        ])->assertCreated()->json('data');
        $untracked = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'food_item', 'name' => 'Fresh Biryani', 'price' => 400,
        ])->assertCreated()->json('data');

        $this->assertTrue((bool) Product::withoutTenancy()->find($tracked['id'])->track_inventory);
        $this->assertFalse((bool) Product::withoutTenancy()->find($untracked['id'])->track_inventory);

        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $tracked['id'], 'quantity' => 2],
            ['product_id' => $untracked['id'], 'quantity' => 3],
        ])->assertOk();

        $this->settle($tab['id'], ['payment_method' => 'cash', 'amount_paid' => 2800])
            ->assertCreated()->assertJsonPath('data.sale.total', '2800.00');

        // Tracked kebab: 10 → 8 through the audited path.
        $this->assertSame(8.0, (float) Product::withoutTenancy()->find($tracked['id'])->stock_quantity);
        $saleMoves = StockMovement::withoutTenancy()->where('reference_type', 'sale')->get();
        $this->assertCount(1, $saleMoves);
        $this->assertSame($tracked['id'], $saleMoves->first()->product_id);

        // Default food item: no stock row was touched.
        $untrackedStockBefore = (float) $untracked['stock_quantity'];
        $this->assertSame($untrackedStockBefore, (float) Product::withoutTenancy()->find($untracked['id'])->stock_quantity);
    }

    // ── (4) Serving-window fences ────────────────────────────────────

    public function test_serving_window_gates_the_pos_counter(): void
    {
        // Served two hours from now — the counter must refuse it right now.
        $halwa = $this->foodItem([
            'name' => 'Halwa Puri', 'price' => 350,
            'available_from' => now()->addHours(2)->format('H:i'),
            'available_until' => now()->addHours(4)->format('H:i'),
        ]);

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 350,
            'items' => [['product_id' => $halwa->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_NOT_AVAILABLE_NOW');

        // Widen the window to span now — the same sale rings through.
        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$halwa->id}", [
            'available_from' => now()->subHour()->format('H:i'),
            'available_until' => now()->addHour()->format('H:i'),
        ])->assertOk();

        $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 350,
            'items' => [['product_id' => $halwa->id, 'quantity' => 1]],
        ])->assertCreated()->assertJsonPath('data.total', '350.00');
    }

    public function test_serving_window_gates_online_orders_and_tab_additions(): void
    {
        $halwa = $this->foodItem([
            'name' => 'Halwa Puri', 'price' => 350,
            'available_from' => now()->addHours(2)->format('H:i'),
            'available_until' => now()->addHours(4)->format('H:i'),
        ]);
        $customer = User::factory()->create();

        // Out of window: online checkout and the dine-in tab both refuse.
        $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $halwa->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_NOT_AVAILABLE_NOW');

        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $halwa->id, 'quantity' => 1]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_NOT_AVAILABLE_NOW');

        // Inside the window the same order goes through at the menu price.
        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$halwa->id}", [
            'available_from' => now()->subHour()->format('H:i'),
            'available_until' => now()->addHour()->format('H:i'),
        ])->assertOk();

        $order = $this->actingAsUser($customer)->postJson('/api/v1/customer/orders', [
            'shop_slug' => $this->shop->slug, 'fulfillment_type' => 'pickup',
            'items' => [['product_id' => $halwa->id, 'quantity' => 2]],
        ])->assertCreated()->json('data');
        $this->assertEquals(700, $order['subtotal']);
    }

    public function test_cross_midnight_serving_window_wraps_correctly(): void
    {
        $burger = $this->foodItem(['name' => 'Midnight Burger', 'price' => 500]);

        // The API accepts an inverted pair — that IS the cross-midnight shape.
        $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$burger->id}", [
            'available_from' => '22:00', 'available_until' => '02:00',
        ])->assertOk();

        $ring = fn () => $this->actingAsUser($this->owner)->postJson('/api/v1/sales', [
            'channel' => 'walk_in', 'payment_method' => 'cash', 'amount_paid' => 500,
            'items' => [['product_id' => $burger->id, 'quantity' => 1]],
        ]);
        $midnight = Carbon::now('UTC')->startOfDay()->addDay(); // tonight's midnight

        // 23:30 — inside the window, before the wrap.
        $this->travelTo($midnight->copy()->subMinutes(30));
        $ring()->assertCreated();

        // 01:30 — inside the window, after the wrap.
        $this->travelTo($midnight->copy()->addHour()->addMinutes(30));
        $ring()->assertCreated();

        // 12:00 next day — clearly outside.
        $this->travelTo($midnight->copy()->addHours(12));
        $ring()->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_NOT_AVAILABLE_NOW');

        $this->travelBack();
    }
}
