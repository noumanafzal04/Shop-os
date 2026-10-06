<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicketItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A LINE CAN BE CHANGED UNTIL THE KITCHEN HAS IT.
 *
 * A tab had two verbs, add and void, and every tap on a dish added one line of
 * one. Eight naan for a table of six was eight taps, eight rows on the tab and
 * eight rows on the kitchen's docket. "Make that three" could not be said, and
 * neither could "no green chilli": the note column was on the line from the
 * first day and no screen ever wrote to it.
 *
 * `PATCH /restaurant/tickets/{tab}/items/{line}` is the third verb. What is
 * held here is where it stops — at the pass — and that a line reached by
 * stepping costs exactly what the same line costs added in one go.
 */
class ATabLineCanChangeBeforeItIsSentTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $naan;

    private Product $karahi;

    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->naan = $this->dish('Roghni Naan', 70);
        $this->karahi = $this->dish('Chicken Karahi', 1450);
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'seats' => 6, 'is_active' => true,
        ]);
    }

    private function dish(string $name, float $price, array $more = []): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => $name, 'price' => $price, 'track_inventory' => false, 'is_active' => true,
            ...$more,
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Open a tab and put lines on it. @return array{0: string, 1: array<string, string>} tab id, line id by dish name */
    private function tab(array $lines, ?User $as = null): array
    {
        $who = $as ?? $this->owner;
        $tab = $this->as($who)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id, 'guest_count' => 6,
        ])->assertCreated()->json('data');

        $this->as($who)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => array_map(fn ($l) => ['product_id' => $l[0]->id, 'quantity' => $l[1], ...($l[2] ?? [])], $lines),
        ])->assertSuccessful();

        $ids = RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->pluck('id', 'product_name')->all();

        return [$tab['id'], $ids];
    }

    private function change(string $tab, string $line, array $body, ?User $as = null)
    {
        return $this->as($as ?? $this->owner)->patchJson("/api/v1/restaurant/tickets/{$tab}/items/{$line}", $body);
    }

    private function line(string $id): RestaurantTicketItem
    {
        return RestaurantTicketItem::withoutTenancy()->findOrFail($id);
    }

    private function runningTotal(string $tab): float
    {
        return (float) $this->as($this->owner)->getJson("/api/v1/restaurant/tickets/{$tab}")->json('data.running_total');
    }

    // ── more, and fewer ───────────────────────────────────────────────

    public function test_one_more_is_one_line_of_two_and_the_bill_follows(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1], [$this->karahi, 1]]);
        $this->assertEquals(1520, $this->runningTotal($tab));

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 1])->assertOk();

        $naan = $this->line($ids['Roghni Naan']);
        $this->assertEquals(2, (float) $naan->quantity);
        $this->assertEquals(140, (float) $naan->line_total);
        // Still ONE line of naan — which is the whole point.
        $this->assertSame(2, RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab)->count());
        $this->assertEquals(1590, $this->runningTotal($tab));
    }

    public function test_eight_taps_are_eight_steps_and_arrive_at_nine_whatever_each_screen_last_saw(): void
    {
        // The reason the request is a STEP. Each of these says "one more" and
        // none of them says what it thinks the total is, so there is nothing
        // for a slow answer to overwrite.
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);

        for ($i = 0; $i < 8; $i++) {
            $this->change($tab, $ids['Roghni Naan'], ['adjust' => 1])->assertOk();
        }

        $this->assertEquals(9, (float) $this->line($ids['Roghni Naan'])->quantity);
        $this->assertEquals(630, $this->runningTotal($tab));
    }

    public function test_the_kitchen_is_told_eight_naan_once_not_one_naan_eight_times(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);
        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 7])->assertOk();

        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab}/fire", [])->assertSuccessful();

        $card = $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen')->json('data.kots.0');
        $this->assertCount(1, $card['items']);
        $this->assertEquals(8, $card['items'][0]['quantity']);
    }

    public function test_stepping_a_line_down_to_nothing_takes_it_off_the_tab(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 2], [$this->karahi, 1]]);

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => -1])->assertOk();
        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);
        $this->assertNull($this->line($ids['Roghni Naan'])->voided_at);

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => -1])->assertOk();

        // Struck off the way `void` strikes a line off — one kind of removed
        // line, which the bill and the floor already know how to ignore.
        $gone = $this->line($ids['Roghni Naan']);
        $this->assertNotNull($gone->voided_at);
        $this->assertSame('void', $gone->kot_status);
        $this->assertEquals(1450, $this->runningTotal($tab));

        $tile = collect($this->as($this->owner)->getJson('/api/v1/restaurant/floor')->json('data.tables'))->firstWhere('name', 'T1');
        $this->assertEquals(1450, $tile['open_ticket']['to_pay']);
        $this->assertSame(1, $tile['open_ticket']['lines']);
    }

    public function test_a_line_reached_by_stepping_costs_what_it_costs_added_in_one_go(): void
    {
        // A tiered price depends on HOW MANY. Five kababs are cheaper each
        // than four, and a quantity that only multiplied the price it was
        // added at would charge the dearer one for ever.
        $kabab = $this->dish('Seekh Kabab', 620, ['price_tiers' => [['min_qty' => 5, 'price' => 550]]]);

        [$stepped, $ids] = $this->tab([[$kabab, 4]]);
        $this->assertEquals(2480, (float) $this->line($ids['Seekh Kabab'])->line_total);
        $this->change($stepped, $ids['Seekh Kabab'], ['adjust' => 1])->assertOk();

        $atOnce = $this->as($this->owner)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'takeaway',
        ])->assertCreated()->json('data');
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$atOnce['id']}/items", [
            'items' => [['product_id' => $kabab->id, 'quantity' => 5]],
        ])->assertSuccessful();
        $inOneGo = RestaurantTicketItem::withoutTenancy()->where('ticket_id', $atOnce['id'])->sole();

        $line = $this->line($ids['Seekh Kabab']);
        $this->assertEquals(2750, (float) $inOneGo->line_total, 'the fixture has no tier to test');
        $this->assertEquals((float) $inOneGo->line_total, (float) $line->line_total);
        $this->assertEquals((float) $inOneGo->unit_price, (float) $line->unit_price);

        // …and back down the other side of the tier.
        $this->change($stepped, $ids['Seekh Kabab'], ['adjust' => -1])->assertOk();
        $this->assertEquals(2480, (float) $this->line($ids['Seekh Kabab'])->line_total);
    }

    public function test_a_percentage_off_stays_a_percentage_of_the_new_amount(): void
    {
        [$tab, $ids] = $this->tab([[$this->karahi, 1, ['line_discount_pct' => 10]]]);
        $this->assertEquals(1305, (float) $this->line($ids['Chicken Karahi'])->line_total);

        $this->change($tab, $ids['Chicken Karahi'], ['adjust' => 1])->assertOk();

        // Ten percent of 2,900 — not the 145 that was ten percent of one.
        $this->assertEquals(2610, (float) $this->line($ids['Chicken Karahi'])->line_total);
    }

    // ── a note for the kitchen ────────────────────────────────────────

    public function test_a_note_reaches_the_cook_and_can_be_taken_back(): void
    {
        [$tab, $ids] = $this->tab([[$this->karahi, 1]]);

        $this->change($tab, $ids['Chicken Karahi'], ['note' => '  No green chilli  '])->assertOk();
        $this->assertSame('No green chilli', $this->line($ids['Chicken Karahi'])->note);
        // A note alone moves no money.
        $this->assertEquals(1450, $this->runningTotal($tab));

        $this->change($tab, $ids['Chicken Karahi'], ['note' => ''])->assertOk();
        $this->assertNull($this->line($ids['Chicken Karahi'])->note);

        $this->change($tab, $ids['Chicken Karahi'], ['note' => 'Allergy: nuts'])->assertOk();
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab}/fire", [])->assertSuccessful();

        $card = $this->as($this->owner)->getJson('/api/v1/restaurant/kitchen')->json('data.kots.0');
        $this->assertSame('Allergy: nuts', $card['items'][0]['note']);
    }

    // ── where it stops ────────────────────────────────────────────────

    public function test_once_it_is_fired_the_number_on_the_tab_cannot_move(): void
    {
        // The docket is printed. Changing the tab would not change the pan.
        [$tab, $ids] = $this->tab([[$this->naan, 2]]);
        $this->as($this->owner)->postJson("/api/v1/restaurant/tickets/{$tab}/fire", [])->assertSuccessful();

        foreach ([['adjust' => 1], ['adjust' => -2], ['note' => 'too late']] as $body) {
            $this->change($tab, $ids['Roghni Naan'], $body)
                ->assertStatus(409)
                ->assertJsonPath('meta.error_code', 'ITEM_ALREADY_SENT');
        }

        $naan = $this->line($ids['Roghni Naan']);
        $this->assertEquals(2, (float) $naan->quantity);
        $this->assertNull($naan->note);
        $this->assertNull($naan->voided_at);
    }

    public function test_a_paid_line_and_a_removed_line_are_left_alone(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 2], [$this->karahi, 1]]);

        RestaurantTicketItem::withoutTenancy()->whereKey($ids['Roghni Naan'])
            ->update(['sale_id' => '00000000-0000-0000-0000-000000000001']);
        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 1])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ITEM_SETTLED');

        $this->as($this->owner)->deleteJson("/api/v1/restaurant/tickets/{$tab}/items/{$ids['Chicken Karahi']}")->assertSuccessful();
        $this->change($tab, $ids['Chicken Karahi'], ['adjust' => 1])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'ITEM_VOID');

        $this->assertEquals(2, (float) $this->line($ids['Roghni Naan'])->quantity);
    }

    public function test_more_of_a_dish_that_has_since_run_out_is_refused_and_fewer_is_not(): void
    {
        [$tab, $ids] = $this->tab([[$this->karahi, 2]]);
        $this->as($this->owner)->postJson("/api/v1/products/{$this->karahi->id}/sold-out")->assertSuccessful();

        $this->change($tab, $ids['Chicken Karahi'], ['adjust' => 1])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_SOLD_OUT');
        $this->assertEquals(2, (float) $this->line($ids['Chicken Karahi'])->quantity);

        // A table changing its mind has to be able to take it off.
        $this->change($tab, $ids['Chicken Karahi'], ['adjust' => -1])->assertOk();
        $this->assertEquals(1, (float) $this->line($ids['Chicken Karahi'])->quantity);
    }

    public function test_half_a_naan_is_not_a_thing(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 0.5])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'FRACTIONAL_QTY_NOT_ALLOWED');
        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);
    }

    public function test_a_request_has_to_ask_for_something(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);

        $this->change($tab, $ids['Roghni Naan'], [])->assertStatus(422);
        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 0])->assertStatus(422);
        // A target is not a step. `quantity: 4` is the request this endpoint
        // exists not to take.
        $this->change($tab, $ids['Roghni Naan'], ['quantity' => 4])->assertStatus(422);

        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);
    }

    // ── whose tab ─────────────────────────────────────────────────────

    public function test_another_waiters_tab_is_not_yours_to_change(): void
    {
        $floor = [Permissions::SALES_MANAGE, Permissions::CUSTOMERS_MANAGE];
        $imran = User::factory()->tenantStaff($this->shop, $floor)->create(['name' => 'Imran']);
        $sana = User::factory()->tenantStaff($this->shop, $floor)->create(['name' => 'Sana']);

        [$tab, $ids] = $this->tab([[$this->naan, 1]], $imran);

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 1], $sana)
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');
        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 1], $imran)->assertOk();
    }

    public function test_a_line_is_changed_through_its_own_tab_only(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);
        $other = $this->as($this->owner)->postJson('/api/v1/restaurant/tickets', ['order_type' => 'takeaway'])
            ->assertCreated()->json('data');

        $this->change($other['id'], $ids['Roghni Naan'], ['adjust' => 5])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'ITEM_MISMATCH');

        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);
    }

    public function test_another_shop_cannot_reach_the_line_at_all(): void
    {
        [$tab, $ids] = $this->tab([[$this->naan, 1]]);

        $other = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'),
        ]);
        $stranger = User::factory()->shopOwner($other)->create();

        $this->change($tab, $ids['Roghni Naan'], ['adjust' => 5], $stranger)->assertStatus(404);
        $this->assertEquals(1, (float) $this->line($ids['Roghni Naan'])->quantity);
    }
}
