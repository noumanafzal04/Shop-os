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
use App\Services\DashboardService;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\ServiceDay;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * THE PASS SHOWS TONIGHT'S WORK, AND WHAT IS LEFT OVER CAN BE CLEARED.
 *
 *     "bht old data b kitchen main show ho raha"
 *
 * The kitchen board showed every docket nobody had bumped for as long as its
 * tab stayed open — and nothing closes a tab but a person. A counter takeaway
 * the cook never tapped, a table nobody settled: each led the next morning's
 * queue, and the morning after that. The only way to take one down was three
 * taps through Start → Ready → Served, which is also three lies in the timing
 * record.
 *
 * Three things are held here:
 *
 *   THE WINDOW   the board is this service (ServiceDay). A restaurant's day
 *                does not turn at midnight, so the window does not either.
 *   THE COUNT    what is left from before is not hidden — it is counted, and
 *                can be shown on request.
 *   THE CLEAR    one request takes the leftovers (or tonight's whole board)
 *                off, marked `cleared` and never `served`, on the trail once.
 */
class ThePassIsTonightsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $karahi;

    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        // Eight in the evening in Karachi. Fixed, because every case below is
        // about what time it is.
        Carbon::setTestNow(Carbon::parse('2026-10-06 20:00', 'Asia/Karachi')->utc());

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'Asia/Karachi',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->karahi = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Chicken Karahi', 'price' => 1800, 'track_inventory' => false, 'is_active' => true,
        ]);
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'area' => 'Hall', 'seats' => 4, 'is_active' => true,
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Karachi wall-clock → the moment. */
    private function at(string $local): Carbon
    {
        return Carbon::parse($local, 'Asia/Karachi')->utc();
    }

    /** Open a tab, order a karahi, send it. Done THROUGH THE API, at the moment given. */
    private function fired(?string $local = null, ?DiningTable $table = null, string $type = 'dine_in'): array
    {
        $back = now();
        if ($local !== null) {
            Carbon::setTestNow($this->at($local));
        }

        $tab = $this->as($this->owner)->postJson('/api/v1/restaurant/tickets', array_filter([
            'order_type' => $type,
            'dining_table_id' => $type === 'dine_in' ? ($table ?? $this->table)->id : null,
            'guest_count' => 2,
        ]))->assertCreated()->json('data');

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $this->karahi->id, 'quantity' => 1]],
        ])->assertSuccessful();

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", [])->assertSuccessful();

        Carbon::setTestNow($back);

        return $tab;
    }

    private function anotherTable(string $name): DiningTable
    {
        return DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => $name, 'seats' => 4, 'is_active' => true,
        ]);
    }

    private function board(array $query = []): array
    {
        return $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen?'.http_build_query($query))
            ->assertOk()->json('data');
    }

    /** The tab numbers on the board — the thing a cook would read out. */
    private function onTheBoard(array $query = []): array
    {
        return array_column($this->board($query)['kots'], 'ticket_number');
    }

    // ── the window ────────────────────────────────────────────────────

    public function test_tonights_docket_is_on_the_board_and_last_weeks_is_not(): void
    {
        $old = $this->fired('2026-10-01 21:15', $this->anotherTable('T9'));
        $tonight = $this->fired();

        $this->assertSame(
            [$tonight['ticket_number']],
            $this->onTheBoard(),
            'the board is not showing exactly tonight\'s work',
        );

        // …and the old one is not lost. It is counted, with how old it is.
        $older = $this->board()['older'];
        $this->assertSame(1, $older['count']);
        $this->assertSame($this->at('2026-10-01 21:15')->toJSON(), $older['oldest_fired_at']);

        // And it can be looked at, on its own, before anybody clears it.
        $this->assertSame([$old['ticket_number']], $this->onTheBoard(['older' => 1]));
    }

    public function test_a_kitchen_working_past_midnight_keeps_its_board(): void
    {
        // Fired at half past eleven. At one in the morning it is "yesterday"
        // by the calendar and still being cooked by the kitchen.
        $tab = $this->fired('2026-10-06 23:30');

        Carbon::setTestNow($this->at('2026-10-07 01:00'));

        $this->assertSame([$tab['ticket_number']], $this->onTheBoard(), 'midnight wiped a board that was being cooked from');
        $this->assertSame(0, $this->board()['older']['count']);
    }

    public function test_sehri_is_not_cut_in_half_at_five(): void
    {
        // The day turns at five by the shop's clock — and a docket fired at
        // ten to five is ten minutes old when it does.
        $tab = $this->fired('2026-10-07 04:50');

        Carbon::setTestNow($this->at('2026-10-07 05:10'));

        $this->assertSame([$tab['ticket_number']], $this->onTheBoard(), 'the turn of the day took a ten-minute-old docket off the pass');
    }

    public function test_what_last_night_left_is_gone_from_the_board_by_lunch(): void
    {
        // The case midnight-as-the-boundary gets wrong the other way: a docket
        // fired at one in the morning and never bumped is "today's" all of the
        // next day.
        $this->fired('2026-10-07 01:00');

        Carbon::setTestNow($this->at('2026-10-07 12:30'));

        $this->assertSame([], $this->onTheBoard(), 'lunch service opened on last night\'s leftovers');
        $this->assertSame(1, $this->board()['older']['count']);
    }

    public function test_the_window_opens_where_the_rule_says(): void
    {
        // The rule, said once as numbers. Evening: the day turned at five.
        $this->assertSame(
            $this->at('2026-10-06 05:00')->toJSON(),
            ServiceDay::began($this->shop)->toJSON(),
        );

        // Small hours: it turned at five YESTERDAY.
        Carbon::setTestNow($this->at('2026-10-07 02:00'));
        $this->assertSame($this->at('2026-10-06 05:00')->toJSON(), ServiceDay::began($this->shop)->toJSON());

        // Just after the turn: six hours back, not ten minutes.
        Carbon::setTestNow($this->at('2026-10-07 05:10'));
        $this->assertSame($this->at('2026-10-06 23:10')->toJSON(), ServiceDay::began($this->shop)->toJSON());
    }

    // ── the clear ─────────────────────────────────────────────────────

    public function test_clearing_what_was_left_takes_only_that(): void
    {
        $old = $this->fired('2026-10-01 21:15', $this->anotherTable('T9'));
        $older = $this->fired('2026-09-28 14:00', $this->anotherTable('T8'));
        $tonight = $this->fired();

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])
            ->assertOk()
            ->assertJsonPath('data.cleared', 2);

        // Tonight's is untouched and still the cook's.
        $this->assertSame([$tonight['ticket_number']], $this->onTheBoard());
        $this->assertSame(0, $this->board()['older']['count']);
        $this->assertSame([], $this->onTheBoard(['older' => 1]));

        // CLEARED — its own word. Not `served`: nobody said the food went out,
        // and no stage was stamped to say when.
        foreach ([$old, $older] as $tab) {
            $kot = KitchenTicket::withoutTenancy()->where('ticket_id', $tab['id'])->sole();
            $this->assertSame('cleared', $kot->status);
            $this->assertNull($kot->served_at);
            $this->assertNull($kot->ready_at);
            $this->assertSame($this->owner->id, $kot->bumped_by);

            // And the waiter's tab no longer says the kitchen has it.
            $this->assertSame(
                ['cleared'],
                RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->pluck('kot_status')->all(),
            );
        }
        $this->assertSame('fired', KitchenTicket::withoutTenancy()->where('ticket_id', $tonight['id'])->sole()->status);
    }

    public function test_clearing_the_board_at_close_takes_tonight_and_leaves_the_leftovers_alone(): void
    {
        $old = $this->fired('2026-10-01 21:15', $this->anotherTable('T9'));
        $this->fired();
        $this->fired(null, $this->anotherTable('T2'));

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'board'])
            ->assertOk()
            ->assertJsonPath('data.cleared', 2);

        $this->assertSame([], $this->onTheBoard());
        // A different question, answered separately — never swept up in this one.
        $this->assertSame([$old['ticket_number']], $this->onTheBoard(['older' => 1]));
    }

    public function test_one_station_clearing_down_does_not_clear_another(): void
    {
        $grill = $this->fired();
        $bar = $this->fired(null, $this->anotherTable('T2'));
        KitchenTicket::withoutTenancy()->where('ticket_id', $grill['id'])->update(['station' => 'Grill']);
        KitchenTicket::withoutTenancy()->where('ticket_id', $bar['id'])->update(['station' => 'Bar']);

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'board', 'station' => 'Grill'])
            ->assertOk()
            ->assertJsonPath('data.cleared', 1);

        $this->assertSame([$bar['ticket_number']], $this->onTheBoard());
    }

    public function test_a_clear_must_say_what_it_is_clearing(): void
    {
        $this->fired();

        // No scope is not "everything". That is tonight's queue gone on a typo.
        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', [])->assertStatus(422);
        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'everything'])->assertStatus(422);

        $this->assertCount(1, $this->onTheBoard());
    }

    public function test_the_clear_is_one_line_on_the_trail(): void
    {
        $this->fired('2026-10-01 21:15', $this->anotherTable('T9'));
        $this->fired('2026-09-28 14:00', $this->anotherTable('T8'));

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])->assertOk();

        $rows = AuditLog::query()->where('tenant_id', $this->shop->id)->where('event', 'cleared')->get();
        $this->assertCount(1, $rows, 'two tickets cleared in one act is one line, not two and not none');
        $this->assertSame(KitchenTicket::class, $rows[0]->auditable_type);
        $this->assertSame($this->owner->id, $rows[0]->user_id);
        $this->assertSame(2, $rows[0]->new_values['tickets']);

        // And clearing nothing writes nothing.
        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])
            ->assertOk()->assertJsonPath('data.cleared', 0);
        $this->assertSame(1, AuditLog::query()->where('tenant_id', $this->shop->id)->where('event', 'cleared')->count());
    }

    public function test_a_cleared_ticket_cannot_be_tapped_back_to_life(): void
    {
        // A second screen still showing the card, and a cook who taps it.
        $tab = $this->fired();
        $kot = KitchenTicket::withoutTenancy()->where('ticket_id', $tab['id'])->sole();

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'board'])->assertOk();

        $this->as($this->owner)->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'preparing'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'KOT_OFF_THE_BOARD');

        $this->assertSame('cleared', $kot->fresh()->status);
        $this->assertSame([], $this->onTheBoard());
    }

    public function test_the_cook_can_clear_and_somebody_with_neither_key_cannot(): void
    {
        $this->fired('2026-10-01 21:15');

        $stockroom = User::factory()->tenantStaff($this->shop, [Permissions::PRODUCTS_MANAGE])->create();
        $this->as($stockroom)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])->assertStatus(403);
        $this->assertSame(1, $this->board()['older']['count']);

        // The pass's own key. A cook who may bump a ticket may clear the board
        // — it is the same act, counted.
        $cook = User::factory()->tenantStaff($this->shop, [Permissions::KITCHEN_MANAGE])->create();
        $this->as($cook)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])
            ->assertOk()->assertJsonPath('data.cleared', 1);
    }

    // ── a counter order, which closes when its last docket is done ─────

    /** Rung at the till and paid: open only so its dockets stay on the pass. */
    private function counterOrder(array $statuses, ?string $local = null): RestaurantTicket
    {
        $when = $local === null ? now() : $this->at($local);

        $ticket = RestaurantTicket::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'ticket_number' => 'T-'.random_int(1000, 9999),
            'order_type' => 'takeaway', 'status' => 'open', 'from_counter' => true, 'opened_at' => $when,
        ]);

        foreach (array_values($statuses) as $i => $status) {
            KitchenTicket::withoutTenancy()->create([
                'tenant_id' => $this->shop->id, 'ticket_id' => $ticket->id, 'kot_number' => $i + 1,
                'station' => $i === 0 ? 'Grill' : 'Bar', 'status' => $status, 'fired_at' => $when,
            ]);
        }

        return $ticket;
    }

    public function test_clearing_a_counter_orders_last_docket_closes_it(): void
    {
        // Paid days ago and never bumped: open for ever, and one more on the
        // kitchen's backlog for every day nobody noticed.
        $order = $this->counterOrder(['fired'], '2026-10-02 13:00');

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'older'])->assertOk();

        $this->assertSame('closed', $order->fresh()->status->value);
        $this->assertNotNull($order->fresh()->closed_at);
    }

    public function test_a_counter_order_closes_when_one_docket_was_cleared_and_the_other_served(): void
    {
        // "Still cooking" used to mean "anything that is not served". A
        // cleared docket is not served, so this order would have waited on it
        // for ever.
        $order = $this->counterOrder(['cleared', 'ready']);
        $bar = KitchenTicket::withoutTenancy()->where('ticket_id', $order->id)->where('status', 'ready')->sole();

        $this->as($this->owner)->postJson("/api/v1/restaurant/kitchen/kot/{$bar->id}/bump", ['status' => 'served'])->assertOk();

        $this->assertSame('closed', $order->fresh()->status->value);
    }

    public function test_a_counter_order_with_a_docket_still_cooking_stays_open(): void
    {
        // The other side of that rule. Clearing the grill's docket must not
        // close an order the bar has not finished.
        $order = $this->counterOrder(['fired', 'preparing']);

        $this->as($this->owner)->postJson('/api/v1/restaurant/kitchen/clear', ['scope' => 'board', 'station' => 'Grill'])
            ->assertOk()->assertJsonPath('data.cleared', 1);

        $this->assertSame('open', $order->fresh()->status->value);
    }

    // ── the owner's dashboard reads the same pass ─────────────────────

    private function floorBlock(): array
    {
        return app(DashboardService::class)->forTenant($this->shop->fresh())['floor'];
    }

    public function test_the_dashboard_counts_what_the_board_shows(): void
    {
        $this->fired('2026-10-01 21:15', $this->anotherTable('T9'));   // left over
        $this->fired();                                                 // tonight
        $cleared = $this->fired(null, $this->anotherTable('T2'));
        KitchenTicket::withoutTenancy()->where('ticket_id', $cleared['id'])->update(['status' => 'cleared']);

        // One. Not three: a leftover is not on the pass, and a cleared docket
        // has no `served_at` either — "not yet served" would count it for as
        // long as its tab stayed open.
        $this->assertSame(1, $this->floorBlock()['kot_waiting']);
        $this->assertCount(1, $this->onTheBoard());
    }

    public function test_a_paid_counter_order_is_not_a_bill_still_running(): void
    {
        $this->fired();                       // a real tab: one bill running
        $this->counterOrder(['fired']);       // in the drawer already
        $this->counterOrder(['fired']);

        $this->assertSame(1, $this->floorBlock()['open_tabs']);
        // The kitchen still owes all three.
        $this->assertSame(3, $this->floorBlock()['kot_waiting']);
    }
}
