<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Dine-in restaurant depth: floor tables, running tabs, kitchen tickets (KOT),
 * settlement + split-by-item. The tab re-prices server-authoritatively through
 * the same sale engine as the counter, so stock + tax stay correct.
 */
class RestaurantDineInTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $pizza;   // food, no stock

    private Product $water;   // physical, stock-tracked

    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'), // dine_in on
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pepperoni Pizza', 'price' => 1000, 'cost' => 400,
            'track_inventory' => false, 'is_active' => true,
        ]);
        $this->water = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Water Bottle', 'price' => 100, 'cost' => 40,
            'track_inventory' => true, 'stock_quantity' => 10, 'is_active' => true,
        ]);
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

    private function openTab(array $overrides = []): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/restaurant/tickets', array_merge([
            'order_type' => 'dine_in',
            'dining_table_id' => $this->table->id,
            'guest_count' => 2,
        ], $overrides))->assertCreated()->json('data');
    }

    private function addItems(string $ticketId, array $items): array
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$ticketId}/items", ['items' => $items])
            ->assertOk()->json('data');
    }

    private function syncPizzaMenu(): array
    {
        return $this->actingAsUser($this->owner)->putJson("/api/v1/products/{$this->pizza->id}/modifier-groups", [
            'groups' => [
                ['name' => 'Crust', 'type' => 'modifier', 'min_select' => 1, 'max_select' => 1, 'options' => [
                    ['name' => 'Thin', 'price_delta' => 0],
                    ['name' => 'Stuffed', 'price_delta' => 200],
                ]],
            ],
        ])->assertOk()->json('data.modifier_groups');
    }

    // ── Tables + opening ──────────────────────────────────────────────

    public function test_table_crud_and_occupancy(): void
    {
        // Create a second table via the API.
        $this->actingAsUser($this->owner)->postJson('/api/v1/restaurant/tables', [
            'name' => 'T2', 'area' => 'Patio', 'seats' => 2,
        ])->assertCreated();

        $tables = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/tables')
            ->assertOk()->json('data');
        $this->assertCount(2, $tables);

        // Opening a tab makes T1 occupied.
        $this->openTab();
        $tables = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/tables')->json('data');
        $t1 = collect($tables)->firstWhere('name', 'T1');
        $this->assertNotNull($t1['open_ticket']);

        // A busy table can't be deleted.
        $this->actingAsUser($this->owner)->deleteJson("/api/v1/restaurant/tables/{$this->table->id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TABLE_OCCUPIED');
    }

    public function test_second_tab_on_same_table_is_rejected(): void
    {
        $this->openTab();
        $this->actingAsUser($this->owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id,
        ])->assertStatus(409)->assertJsonPath('meta.error_code', 'TABLE_OCCUPIED');
    }

    // ── Building the tab ──────────────────────────────────────────────

    public function test_add_items_builds_running_total_with_modifiers(): void
    {
        $groups = $this->syncPizzaMenu();
        $stuffed = collect($groups[0]['options'])->firstWhere('name', 'Stuffed')['id'];

        $tab = $this->openTab();
        $tab = $this->addItems($tab['id'], [
            ['product_id' => $this->pizza->id, 'quantity' => 2, 'modifier_option_ids' => [$stuffed]],
            ['product_id' => $this->water->id, 'quantity' => 1],
        ]);

        // Pizza (1000 + 200 stuffed) × 2 = 2400, + water 100 = 2500.
        $this->assertEquals(2500, $tab['running_total']);
        $this->assertCount(2, $tab['items']);
        $pizzaLine = collect($tab['items'])->firstWhere('product_id', $this->pizza->id);
        $this->assertSame('1200.00', $pizzaLine['unit_price']);
        $this->assertSame('pending', $pizzaLine['kot_status']);
    }

    // ── Kitchen tickets (KOT) ─────────────────────────────────────────

    public function test_fire_kitchen_ticket_batches_pending_items(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->pizza->id, 'quantity' => 1]]);

        $kot = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", ['station' => 'Kitchen'])
            ->assertCreated()->json('data');
        $this->assertSame(1, $kot['kot_number']);
        $this->assertCount(1, $kot['items']);

        // Nothing new to fire → rejected.
        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'NOTHING_TO_FIRE');

        // Add another line → the next fire is KOT #2 with only the new item.
        $this->addItems($tab['id'], [['product_id' => $this->water->id, 'quantity' => 1]]);
        $kot2 = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")
            ->assertCreated()->json('data');
        $this->assertSame(2, $kot2['kot_number']);
        $this->assertCount(1, $kot2['items']);

        // KOT print renders (kitchen-facing HTML).
        $this->actingAsUser($this->owner)
            ->get("/api/v1/restaurant/tickets/{$tab['id']}/kot/{$kot['id']}")
            ->assertOk()->assertSee('KITCHEN')->assertSee('Pepperoni Pizza');
    }

    // ── Settlement ────────────────────────────────────────────────────

    public function test_full_settlement_rings_a_sale_closes_tab_and_frees_table(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $this->pizza->id, 'quantity' => 2],  // 2000
            ['product_id' => $this->water->id, 'quantity' => 1],  // 100
        ]);

        $res = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 2100,
        ])->assertCreated()->json('data');

        $this->assertSame('2100.00', $res['sale']['total']);
        $this->assertSame('dine_in', $res['sale']['order_type']);
        $this->assertSame('T1', $res['sale']['table_no']);
        $this->assertSame('closed', $res['ticket']['status']);

        // Stock-tracked water decremented through the audited path; pizza didn't.
        $this->assertEquals(9, Product::withoutTenancy()->find($this->water->id)->stock_quantity);
        $this->assertSame(1, StockMovement::withoutTenancy()->where('reference_type', 'sale')->count());

        // The table is free again (no open tab).
        $tables = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/tables')->json('data');
        $this->assertNull(collect($tables)->firstWhere('name', 'T1')['open_ticket']);
    }

    public function test_split_by_item_creates_a_sale_per_split_and_closes_when_done(): void
    {
        $tab = $this->openTab();
        $tab = $this->addItems($tab['id'], [
            ['product_id' => $this->pizza->id, 'quantity' => 2],  // 2000
            ['product_id' => $this->water->id, 'quantity' => 1],  // 100
        ]);
        $pizzaItemId = collect($tab['items'])->firstWhere('product_id', $this->pizza->id)['id'];

        // Split 1: just the pizza.
        $r1 = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'item_ids' => [$pizzaItemId], 'payment_method' => 'cash', 'amount_paid' => 2000,
        ])->assertCreated()->json('data');
        $this->assertSame('2000.00', $r1['sale']['total']);
        $this->assertSame('open', $r1['ticket']['status']); // rest still owed

        // Split 2: the remainder (water).
        $r2 = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'card', 'amount_paid' => 100,
        ])->assertCreated()->json('data');
        $this->assertSame('100.00', $r2['sale']['total']);
        $this->assertSame('closed', $r2['ticket']['status']);

        $this->assertSame(2, Sale::withoutTenancy()->count());
        // A split tab keeps linkage per-item, not one sale on the ticket.
        $this->assertNull(RestaurantTicket::withoutTenancy()->find($tab['id'])->sale_id);
    }

    public function test_voided_item_is_excluded_from_the_bill(): void
    {
        $tab = $this->openTab();
        $tab = $this->addItems($tab['id'], [
            ['product_id' => $this->pizza->id, 'quantity' => 1],  // 1000
            ['product_id' => $this->water->id, 'quantity' => 1],  // 100
        ]);
        $waterItemId = collect($tab['items'])->firstWhere('product_id', $this->water->id)['id'];

        $this->actingAsUser($this->owner)
            ->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$waterItemId}", ['reason' => 'Wrong item'])
            ->assertOk();

        $res = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated()->json('data');

        // Only the pizza was billed; the voided water didn't move stock.
        $this->assertSame('1000.00', $res['sale']['total']);
        $this->assertEquals(10, Product::withoutTenancy()->find($this->water->id)->stock_quantity);
    }

    public function test_serving_window_does_not_block_settlement(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->pizza->id, 'quantity' => 1]]);

        // Pizza now becomes out-of-window (served only in a future slot). Adding
        // it now would be blocked — but paying an already-ordered tab must not.
        $this->pizza->forceFill([
            'available_from' => now()->addHours(3)->format('H:i'),
            'available_until' => now()->addHours(5)->format('H:i'),
        ])->save();

        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated()->assertJsonPath('data.sale.total', '1000.00');
    }

    // ── Gating ────────────────────────────────────────────────────────

    public function test_dine_in_routes_require_the_module(): void
    {
        $this->shop->forceFill(['features' => array_merge($this->shop->features, ['dine_in' => false])])->save();

        $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/tickets')
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }
}
