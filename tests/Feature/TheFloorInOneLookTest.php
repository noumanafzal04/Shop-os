<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\City;
use App\Models\DiningTable;
use App\Models\KitchenTicket;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * THE FLOOR, IN ONE LOOK.
 *
 * The floor screen drew a table as "occupied" and nothing else, and drew a
 * takeaway tab not at all — "+ Takeaway" opened one, and stepping back to the
 * floor left no way to reach it again. A table nobody settled last night was
 * "occupied" this morning, the same as one sat five minutes ago.
 *
 * `GET /restaurant/floor` is the screen's one payload. What is held here is
 * that each number on a tile is the number the tab itself would give, and
 * that closing what an earlier service left open keeps `cancel`'s fences.
 */
class TheFloorInOneLookTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $waiter;

    private Product $karahi;

    private Product $naan;

    private DiningTable $t1;

    private DiningTable $t2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Carbon::setTestNow(Carbon::parse('2026-10-06 20:00', 'Asia/Karachi')->utc());

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->waiter = User::factory()
            ->tenantStaff($this->shop, [Permissions::SALES_MANAGE, Permissions::CUSTOMERS_MANAGE])
            ->create(['name' => 'Imran']);

        $this->karahi = $this->dish('Chicken Karahi', 1800);
        $this->naan = $this->dish('Naan', 60);
        $this->t1 = $this->tableNamed('T1');
        $this->t2 = $this->tableNamed('T2');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function dish(string $name, float $price): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    private function tableNamed(string $name): DiningTable
    {
        return DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => $name, 'seats' => 4, 'is_active' => true,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function at(string $local): Carbon
    {
        return Carbon::parse($local, 'Asia/Karachi')->utc();
    }

    /** Open a tab through the API, as somebody, at a moment. */
    private function open(?DiningTable $table, array $lines = [], ?User $as = null, ?string $local = null): array
    {
        $back = now();
        if ($local !== null) {
            Carbon::setTestNow($this->at($local));
        }
        $who = $as ?? $this->owner;

        $tab = $this->as($who)->postJson('/api/v1/restaurant/tickets', array_filter([
            'order_type' => $table === null ? 'takeaway' : 'dine_in',
            'dining_table_id' => $table?->id,
            'guest_count' => 3,
        ]))->assertCreated()->json('data');

        if ($lines !== []) {
            $this->as($who)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
                'items' => array_map(fn ($l) => ['product_id' => $l[0]->id, 'quantity' => $l[1]], $lines),
            ])->assertSuccessful();
        }

        Carbon::setTestNow($back);

        return $tab;
    }

    private function fire(array $tab, ?User $as = null): void
    {
        $this->as($as ?? $this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", [])->assertSuccessful();
    }

    private function floor(?User $as = null): array
    {
        return $this->as($as ?? $this->owner)->getJson('/api/v1/restaurant/floor')->assertOk()->json('data');
    }

    private function tile(string $table): array
    {
        return collect($this->floor()['tables'])->firstWhere('name', $table);
    }

    // ── a tile says what the tab would ────────────────────────────────

    public function test_a_free_table_has_no_tab_and_a_sat_one_says_what_it_has_reached(): void
    {
        $tab = $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 4]]);

        $this->assertNull($this->tile('T2')['open_ticket']);

        $t1 = $this->tile('T1')['open_ticket'];
        $this->assertSame($tab['id'], $t1['id']);
        $this->assertSame(3, $t1['guest_count']);
        $this->assertSame('Owner', $t1['waiter']['name']);
        // 1,800 + 4 × 60.
        $this->assertEquals(2040, $t1['to_pay']);
        $this->assertSame(2, $t1['lines']);
        // Ordered, and not one of them sent.
        $this->assertSame(2, $t1['unsent']);
        $this->assertSame(0, $t1['cooking']);
        $this->assertSame(0, $t1['ready']);
        $this->assertFalse($t1['from_earlier']);

        // And the figure IS the tab's own — one tab, one total.
        $itself = $this->as($this->owner)->getJson("/api/v1/restaurant/tickets/{$tab['id']}")->json('data');
        $this->assertEquals($itself['running_total'], $t1['to_pay']);
    }

    public function test_the_tile_follows_the_food_from_the_pan_to_the_pass(): void
    {
        $tab = $this->open($this->t1, [[$this->karahi, 1]]);
        $this->fire($tab);

        $sent = $this->tile('T1')['open_ticket'];
        $this->assertSame(0, $sent['unsent']);
        $this->assertSame(1, $sent['cooking']);
        $this->assertSame(0, $sent['ready']);

        $kot = KitchenTicket::withoutTenancy()->where('ticket_id', $tab['id'])->sole();
        $this->as($this->owner)->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'ready'])->assertOk();

        // The reason a waiter looks at the floor between orders.
        $this->assertSame(1, $this->tile('T1')['open_ticket']['ready']);
        $this->assertSame(0, $this->tile('T1')['open_ticket']['cooking']);

        $this->as($this->owner)->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'served'])->assertOk();

        $this->assertSame(0, $this->tile('T1')['open_ticket']['ready']);
    }

    public function test_a_voided_line_is_not_on_the_bill_the_tile_shows(): void
    {
        $tab = $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 4]]);
        $naan = RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->where('product_name', 'Naan')->sole();

        $this->as($this->owner)->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$naan->id}", ['reason' => 'changed mind'])
            ->assertSuccessful();

        $this->assertEquals(1800, $this->tile('T1')['open_ticket']['to_pay']);
        $this->assertSame(1, $this->tile('T1')['open_ticket']['lines']);
    }

    public function test_the_tile_shows_what_is_still_owed_once_part_is_paid(): void
    {
        // Four friends, one has paid. The table owes the rest — and can no
        // longer be cancelled, which the floor says before anyone tries.
        $tab = $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 4]]);
        $karahi = RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->where('product_name', 'Chicken Karahi')->sole();
        $karahi->forceFill(['sale_id' => '00000000-0000-0000-0000-000000000001'])->save();

        $t1 = $this->tile('T1')['open_ticket'];
        $this->assertEquals(240, $t1['to_pay']);
        $this->assertTrue($t1['part_paid']);
    }

    public function test_the_floor_does_not_ship_the_menu_with_every_tile(): void
    {
        // A tab model serialised as-is appends its running total, loads every
        // line to add them up, and then sends the lines too.
        $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 4]]);

        $t1 = $this->tile('T1')['open_ticket'];
        $this->assertArrayNotHasKey('items', $t1);
        $this->assertArrayNotHasKey('kitchen_tickets', $t1);
    }

    // ── a takeaway tab has somewhere to be ────────────────────────────

    public function test_a_takeaway_tab_is_on_the_floor_and_a_paid_counter_order_is_not(): void
    {
        $takeaway = $this->open(null, [[$this->karahi, 2]]);

        // Rung at the till: paid, and the kitchen's until it is served.
        RestaurantTicket::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'ticket_number' => 'T-COUNTER',
            'order_type' => 'takeaway', 'status' => 'open', 'from_counter' => true, 'opened_at' => now(),
        ]);

        $rows = $this->floor()['takeaway'];
        $this->assertSame([$takeaway['ticket_number']], array_column($rows, 'ticket_number'));
        $this->assertEquals(3600, $rows[0]['to_pay']);
    }

    public function test_a_settled_takeaway_leaves_the_floor(): void
    {
        $takeaway = $this->open(null, [[$this->karahi, 1]]);
        $this->assertCount(1, $this->floor()['takeaway']);

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$takeaway['id']}/cancel", [])->assertOk();

        $this->assertSame([], $this->floor()['takeaway']);
    }

    // ── what an earlier service left open ─────────────────────────────

    public function test_a_tab_from_last_night_says_so(): void
    {
        $this->open($this->t1, [[$this->karahi, 1]], null, '2026-10-05 22:10');
        $this->open($this->t2, [[$this->karahi, 1]]);

        $this->assertTrue($this->tile('T1')['open_ticket']['from_earlier']);
        $this->assertFalse($this->tile('T2')['open_ticket']['from_earlier']);
    }

    public function test_closing_what_was_left_open_keeps_cancels_fences(): void
    {
        $left = $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 2]], $this->waiter, '2026-10-05 22:10');
        $this->fire($left, $this->waiter);
        $takeaway = $this->open(null, [[$this->naan, 5]], $this->waiter, '2026-10-04 13:00');

        // Part of it was paid for. That one is a decision about money owed.
        $partPaid = $this->open($this->tableNamed('T3'), [[$this->karahi, 1], [$this->naan, 1]], null, '2026-10-05 21:00');
        RestaurantTicketItem::withoutTenancy()->where('ticket_id', $partPaid['id'])->where('product_name', 'Naan')
            ->update(['sale_id' => '00000000-0000-0000-0000-000000000001']);

        // And tonight's table, which no button may reach.
        $tonight = $this->open($this->t2, [[$this->karahi, 1]]);
        $this->fire($tonight);

        $this->as($this->owner)->postJson('/api/v1/restaurant/floor/close-older')
            ->assertOk()
            ->assertJsonPath('data.closed', 2)
            ->assertJsonPath('data.kept', 1);

        // Voided, exactly as `cancel` leaves a tab: the tab, its lines, and
        // its docket off the pass.
        foreach ([$left, $takeaway] as $tab) {
            $this->assertSame('void', RestaurantTicket::withoutTenancy()->find($tab['id'])->status->value);
            $this->assertSame(0, RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->whereNull('voided_at')->count());
        }
        $this->assertSame('void', KitchenTicket::withoutTenancy()->where('ticket_id', $left['id'])->sole()->status);

        // The part-paid one is exactly as it was.
        $this->assertSame('open', RestaurantTicket::withoutTenancy()->find($partPaid['id'])->status->value);
        $this->assertSame(2, RestaurantTicketItem::withoutTenancy()->where('ticket_id', $partPaid['id'])->whereNull('voided_at')->count());

        // And so is tonight's, docket and all.
        $this->assertSame('open', RestaurantTicket::withoutTenancy()->find($tonight['id'])->status->value);
        $this->assertSame('fired', KitchenTicket::withoutTenancy()->where('ticket_id', $tonight['id'])->sole()->status);

        $this->assertNull($this->tile('T1')['open_ticket']);
        $this->assertSame([], $this->floor()['takeaway']);
    }

    public function test_closing_them_is_one_line_on_the_trail_with_what_it_was_worth(): void
    {
        $this->open($this->t1, [[$this->karahi, 1], [$this->naan, 2]], null, '2026-10-05 22:10');   // 1,920
        $this->open(null, [[$this->naan, 5]], null, '2026-10-04 13:00');                            //   300

        $this->as($this->owner)->postJson('/api/v1/restaurant/floor/close-older')->assertOk();

        $row = AuditLog::query()->where('tenant_id', $this->shop->id)->where('event', 'cleared')->sole();
        $this->assertSame(RestaurantTicket::class, $row->auditable_type);
        $this->assertSame(2, $row->new_values['tabs']);
        $this->assertEquals(2220, $row->new_values['unpaid_value']);
        $this->assertSame($this->owner->id, $row->user_id);

        // Nothing left to close writes nothing.
        $this->as($this->owner)->postJson('/api/v1/restaurant/floor/close-older')
            ->assertOk()->assertJsonPath('data.closed', 0);
        $this->assertSame(1, AuditLog::query()->where('tenant_id', $this->shop->id)->where('event', 'cleared')->count());
    }

    public function test_a_waiter_cannot_close_everybody_elses_tabs(): void
    {
        $left = $this->open($this->t1, [[$this->karahi, 1]], null, '2026-10-05 22:10');

        // He can see the floor — it is his job — and cannot sweep it.
        $this->floor($this->waiter);
        $this->as($this->waiter)->postJson('/api/v1/restaurant/floor/close-older')->assertStatus(403);

        $this->assertSame('open', RestaurantTicket::withoutTenancy()->find($left['id'])->status->value);

        // The till's key reaches other people's tables, and so does this.
        $till = User::factory()
            ->tenantStaff($this->shop, [Permissions::SALES_MANAGE, Permissions::TABLES_SERVE_ANY])
            ->create();
        $this->as($till)->postJson('/api/v1/restaurant/floor/close-older')
            ->assertOk()->assertJsonPath('data.closed', 1);
    }

    public function test_another_shops_floor_is_not_in_reach(): void
    {
        $left = $this->open($this->t1, [[$this->karahi, 1]], null, '2026-10-05 22:10');

        $other = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'), 'timezone' => 'Asia/Karachi',
        ]);
        $stranger = User::factory()->shopOwner($other)->create();

        $this->assertSame([], $this->floor($stranger)['tables']);
        $this->as($stranger)->postJson('/api/v1/restaurant/floor/close-older')
            ->assertOk()->assertJsonPath('data.closed', 0);

        $this->assertSame('open', RestaurantTicket::withoutTenancy()->find($left['id'])->status->value);
    }
}
