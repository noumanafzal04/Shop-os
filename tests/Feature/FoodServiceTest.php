<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\City;
use App\Models\DiningTable;
use App\Models\KitchenTicket;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The food service loop — everything between "send to kitchen" and the plate
 * reaching the table.
 *
 * Dine-in could already take an order and take the money; what it could not do
 * was RUN a service. A KOT was written and nothing advanced it, so:
 *   - one fire went to one printer, and the bar got the biryani ticket;
 *   - no screen showed the queue and nobody could say "ready";
 *   - a party could not change table and two tabs could not become one bill;
 *   - the evening's covers belonged to whoever opened the tab, not who served;
 *   - a tip had nowhere to go that wasn't revenue.
 *
 * What this suite pins down is the money-shaped half of that: routing that puts
 * food in front of the right section, a bump that only ever moves forward, a
 * merge that cannot launder a paid line onto another bill, and a tip that lands
 * in the drawer without ever inflating the shop's takings.
 */
class FoodServiceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $waiter;

    private Product $biryani;   // Kitchen

    private Product $lassi;     // Bar

    private Product $chips;     // no station set

    private DiningTable $t1;

    private DiningTable $t2;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'UTC',
            'settings' => ['kitchen_stations' => ['Kitchen', 'Bar']],
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->waiter = User::factory()
            ->tenantStaff($this->shop, ['sales.manage'])->create(['name' => 'Imran']);

        $this->biryani = $this->product('Chicken Biryani', 800, 'Kitchen');
        $this->lassi = $this->product('Sweet Lassi', 200, 'Bar');
        $this->chips = $this->product('Fries', 300, null);

        $this->t1 = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'seats' => 4, 'is_active' => true,
        ]);
        $this->t2 = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T2', 'seats' => 2, 'is_active' => true,
        ]);
    }

    private function product(string $name, float $price, ?string $station): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'cost' => $price / 2,
            'track_inventory' => false, 'is_active' => true,
            'kitchen_station' => $station,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function openTab(?DiningTable $table = null, array $overrides = []): array
    {
        return $this->actingAsUser($this->owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in',
            'dining_table_id' => ($table ?? $this->t1)->id,
            'guest_count' => 2,
            ...$overrides,
        ])->assertCreated()->json('data');
    }

    private function addItems(string $tabId, array $items): array
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tabId}/items", ['items' => $items])
            ->assertOk()->json('data');
    }

    private function fire(string $tabId, array $body = []): array
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tabId}/fire", $body)
            ->assertCreated()->json('data');
    }

    // ── Station routing ─────────────────────────────────────────────

    public function test_one_fire_splits_into_a_kitchen_ticket_per_station(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $this->biryani->id, 'quantity' => 2],
            ['product_id' => $this->lassi->id, 'quantity' => 2],
        ]);

        $kots = $this->fire($tab['id']);

        $this->assertCount(2, $kots);
        $stations = array_column($kots, 'station');
        $this->assertContains('Kitchen', $stations);
        $this->assertContains('Bar', $stations);

        // The bar's ticket must not carry the biryani.
        $bar = collect($kots)->firstWhere('station', 'Bar');
        $this->assertCount(1, $bar['items']);
        $this->assertSame('Sweet Lassi', $bar['items'][0]['product_name']);
    }

    /** An item nobody assigned a station still has to be cooked by someone. */
    public function test_an_unrouted_item_falls_back_to_the_first_station(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->chips->id, 'quantity' => 1]]);

        $kots = $this->fire($tab['id']);

        $this->assertCount(1, $kots);
        $this->assertSame('Kitchen', $kots[0]['station']);
    }

    /** A shop that never configured stations must behave exactly as before. */
    public function test_a_shop_with_no_stations_still_fires_one_ticket(): void
    {
        $this->shop->update(['settings' => ['kitchen_stations' => []]]);
        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $this->biryani->id, 'quantity' => 1],
            ['product_id' => $this->lassi->id, 'quantity' => 1],
        ]);

        $kots = $this->fire($tab['id']);

        $this->assertCount(1, $kots);
        $this->assertNull($kots[0]['station']);
    }

    public function test_kot_numbers_stay_a_gap_free_per_tab_sequence_across_a_split_fire(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $this->biryani->id, 'quantity' => 1],
            ['product_id' => $this->lassi->id, 'quantity' => 1],
        ]);
        $first = $this->fire($tab['id']);
        $this->assertEqualsCanonicalizing([1, 2], array_column($first, 'kot_number'));

        $this->addItems($tab['id'], [['product_id' => $this->chips->id, 'quantity' => 1]]);
        $second = $this->fire($tab['id']);
        $this->assertSame([3], array_column($second, 'kot_number'));
    }

    // ── The kitchen board ───────────────────────────────────────────

    public function test_the_board_shows_what_is_waiting_and_never_shows_money(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 2]]);
        $this->fire($tab['id']);

        $board = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/kitchen')
            ->assertOk()->json('data');

        $this->assertCount(1, $board['kots']);
        $row = $board['kots'][0];
        $this->assertSame('T1', $row['table_name']);
        $this->assertSame('fired', $row['status']);
        $this->assertSame('Chicken Biryani', $row['items'][0]['name']);
        $this->assertContains('Kitchen', $board['stations']);

        // A cook decides nothing from a price, and a total on the kitchen wall
        // is a bill left on the wrong side of the shop.
        //
        // Asserted on the SHAPE rather than by searching the payload for the
        // price. `assertStringNotContainsString('800', $json)` was the previous
        // spelling and it failed at random: the board carries `server_time` and
        // hex UUIDs, and `…58.080026Z` contains "800". Now that deploys gate on
        // this suite, a flake of that kind blocks a release for no reason.
        $this->assertSame(['name', 'quantity', 'modifiers', 'note'], array_keys($row['items'][0]));
        $this->assertNoMoneyKeys($board);
    }

    /**
     * No key anywhere in the payload is a money field. Catches a price arriving
     * under a name this test never thought to look for, which a fixed list of
     * forbidden keys cannot.
     */
    private function assertNoMoneyKeys(mixed $node, string $path = 'board'): void
    {
        if (! is_array($node)) {
            return;
        }

        foreach ($node as $key => $value) {
            if (is_string($key)) {
                $this->assertDoesNotMatchRegularExpression(
                    '/price|total|amount|cost|discount|tax/i',
                    $key,
                    "The kitchen board exposes money at {$path}.{$key}.",
                );
            }

            $this->assertNoMoneyKeys($value, $path.'.'.$key);
        }
    }

    public function test_a_board_can_be_filtered_to_one_station(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [
            ['product_id' => $this->biryani->id, 'quantity' => 1],
            ['product_id' => $this->lassi->id, 'quantity' => 1],
        ]);
        $this->fire($tab['id']);

        $bar = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/kitchen?station=Bar')
            ->assertOk()->json('data');

        $this->assertCount(1, $bar['kots']);
        $this->assertSame('Bar', $bar['kots'][0]['station']);
        // The tabs must survive picking one of them.
        $this->assertContains('Kitchen', $bar['stations']);
    }

    public function test_bumping_advances_the_ticket_and_stamps_the_time(): void
    {
        $kot = $this->firedKot();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'preparing'])
            ->assertOk()->assertJsonPath('data.status', 'preparing');

        $this->assertNotNull($kot->fresh()->preparing_at);
    }

    /** A double tap on a busy screen is the same fact arriving twice. */
    public function test_re_bumping_the_same_status_succeeds_and_changes_nothing(): void
    {
        $kot = $this->firedKot();
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'ready'])->assertOk();
        $stampedAt = $kot->fresh()->ready_at;

        $this->travel(60)->seconds();
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'ready'])->assertOk();

        $this->assertEquals($stampedAt, $kot->fresh()->ready_at);
    }

    /** Un-readying food already on the pass is worse than refusing the tap. */
    public function test_a_ticket_cannot_be_bumped_backwards(): void
    {
        $kot = $this->firedKot();
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'ready'])->assertOk();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'preparing'])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'KOT_ALREADY_ADVANCED');
    }

    /** A kitchen that bumps once must not leave the timing report full of holes. */
    public function test_skipping_straight_to_served_backfills_the_stages(): void
    {
        $kot = $this->firedKot();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'served'])->assertOk();

        $fresh = $kot->fresh();
        $this->assertNotNull($fresh->preparing_at);
        $this->assertNotNull($fresh->ready_at);
        $this->assertNotNull($fresh->served_at);
    }

    public function test_a_served_ticket_leaves_the_board_and_marks_its_lines_served(): void
    {
        $kot = $this->firedKot();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/kitchen/kot/{$kot->id}/bump", ['status' => 'served'])->assertOk();

        $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/kitchen')
            ->assertOk()->assertJsonCount(0, 'data.kots');

        $this->assertSame('served', $kot->items()->first()->kot_status);
    }

    // ── The floor moves ─────────────────────────────────────────────

    public function test_a_party_can_change_table(): void
    {
        $tab = $this->openTab();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/move", ['dining_table_id' => $this->t2->id])
            ->assertOk()->assertJsonPath('data.dining_table_id', $this->t2->id);
    }

    public function test_a_table_that_already_has_a_tab_cannot_take_another(): void
    {
        $first = $this->openTab($this->t1);
        $second = $this->openTab($this->t2);
        $this->assertNotSame($first['id'], $second['id']);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$second['id']}/move", ['dining_table_id' => $this->t1->id])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'TABLE_OCCUPIED');
    }

    /** Correcting the cover count must not silently un-seat the party. */
    public function test_editing_the_guest_count_alone_keeps_the_table(): void
    {
        $tab = $this->openTab();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/move", ['guest_count' => 5])
            ->assertOk()
            ->assertJsonPath('data.dining_table_id', $this->t1->id)
            ->assertJsonPath('data.guest_count', 5);
    }

    public function test_two_tabs_merge_into_one_bill(): void
    {
        $keep = $this->openTab($this->t1);
        $fold = $this->openTab($this->t2);
        $this->addItems($keep['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);
        $this->addItems($fold['id'], [['product_id' => $this->lassi->id, 'quantity' => 2]]);
        $this->fire($fold['id']);

        $merged = $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$keep['id']}/merge", ['source_ticket_id' => $fold['id']])
            ->assertOk()->json('data');

        $this->assertCount(2, $merged['items']);
        // 800 + (200 × 2)
        $this->assertEquals(1200, $merged['running_total']);

        // The absorbed tab is closed with a pointer, never deleted — an evening
        // with a hole in it cannot be reconciled.
        $source = RestaurantTicket::withoutTenancy()->findOrFail($fold['id']);
        $this->assertSame('closed', $source->status->value);
        $this->assertSame($keep['id'], $source->merged_into_id);

        // The food already fired follows the bill that now owns it, renumbered
        // so it can't collide with the survivor's own sequence.
        $this->assertSame(1, KitchenTicket::withoutTenancy()->where('ticket_id', $keep['id'])->count());
    }

    public function test_a_part_paid_tab_cannot_be_merged_away(): void
    {
        $keep = $this->openTab($this->t1);
        $fold = $this->openTab($this->t2);
        $this->addItems($fold['id'], [['product_id' => $this->lassi->id, 'quantity' => 1]]);

        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$fold['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated();

        // That tab closed on settlement, so the merge is refused — either way
        // a paid line never moves onto someone else's bill.
        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$keep['id']}/merge", ['source_ticket_id' => $fold['id']])
            ->assertStatus(409);
    }

    public function test_a_tab_cannot_be_merged_into_itself(): void
    {
        $tab = $this->openTab();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/merge", ['source_ticket_id' => $tab['id']])
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CANNOT_MERGE_SELF');
    }

    // ── Waiter attribution ──────────────────────────────────────────

    public function test_the_opener_is_the_waiter_until_someone_says_otherwise(): void
    {
        $tab = $this->actingAsUser($this->waiter)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->t1->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');

        $this->assertSame($this->waiter->id, $tab['waiter_id']);
    }

    public function test_a_table_can_be_handed_to_another_waiter(): void
    {
        $tab = $this->openTab();

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/waiter", ['waiter_id' => $this->waiter->id])
            ->assertOk()->assertJsonPath('data.waiter_id', $this->waiter->id);
    }

    public function test_the_service_report_attributes_covers_and_takings_to_the_waiter(): void
    {
        $tab = $this->actingAsUser($this->waiter)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->t1->id, 'guest_count' => 4,
        ])->assertCreated()->json('data');
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1000, 'tip_amount' => 50,
        ])->assertCreated();

        $rows = $this->actingAsUser($this->owner)->getJson('/api/v1/restaurant/reports/waiters')
            ->assertOk()->json('data.rows');

        $imran = collect($rows)->firstWhere('waiter_name', 'Imran');
        $this->assertSame(1, $imran['tables']);
        $this->assertSame(4, $imran['covers']);
        $this->assertEquals(800, $imran['sales_total']);
        $this->assertEquals(50, $imran['tips_total']);
    }

    public function test_the_service_report_needs_the_reports_permission(): void
    {
        $this->actingAsUser($this->waiter)->getJson('/api/v1/restaurant/reports/waiters')->assertForbidden();
    }

    // ── Tips ────────────────────────────────────────────────────────

    /** A tip is money on top of the bill. It must never become revenue. */
    public function test_a_tip_never_inflates_the_total(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);

        $result = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 900, 'tip_amount' => 100,
        ])->assertCreated()->json('data');

        $sale = Sale::withoutTenancy()->findOrFail($result['sale']['id']);
        $this->assertEquals(800, $sale->total);
        $this->assertEquals(100, $sale->tip_amount);
        // Paid 900 for an 800 bill plus a 100 tip — nothing left to hand back.
        $this->assertEquals(0, $sale->change_due);
    }

    /** Change is what's left after the bill AND the tip. */
    public function test_change_is_computed_after_the_tip(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);

        $result = $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 1000, 'tip_amount' => 100,
        ])->assertCreated()->json('data');

        $this->assertEquals(100, Sale::withoutTenancy()->findOrFail($result['sale']['id'])->change_due);
    }

    public function test_paying_the_bill_but_not_the_tip_is_refused(): void
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);

        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 800, 'tip_amount' => 100,
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'PAYMENT_INSUFFICIENT');
    }

    /**
     * The tip is physically in the drawer, so the count has to expect it — but
     * the shop needs to know how much of the till belongs to staff.
     */
    public function test_a_cash_tip_is_expected_in_the_drawer_and_reported_separately(): void
    {
        $session = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/pos/session/open', ['opening_float' => 1000])
            ->assertCreated()->json('data');

        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);
        $this->actingAsUser($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payment_method' => 'cash', 'amount_paid' => 900, 'tip_amount' => 100,
            'cash_session_id' => $session['id'],
        ])->assertCreated();

        $math = DrawerMath::for(CashSession::withoutTenancy()->findOrFail($session['id']));

        $this->assertEquals(100, $math['tips']);
        // 1000 float + 900 taken in cash (800 bill + 100 tip), nothing handed back.
        $this->assertEquals(1900, $math['expected_cash']);
    }

    /** Helper: a tab with one fired Kitchen ticket on it. */
    private function firedKot(): KitchenTicket
    {
        $tab = $this->openTab();
        $this->addItems($tab['id'], [['product_id' => $this->biryani->id, 'quantity' => 1]]);
        $kots = $this->fire($tab['id']);

        return KitchenTicket::withoutTenancy()->findOrFail($kots[0]['id']);
    }
}
