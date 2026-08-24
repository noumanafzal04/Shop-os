<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A CANCELLED TAB MUST LEAVE THE PASS.
 *
 * Found by building a browser fixture for the kitchen board and reading what
 * was already on it: NINE dockets, eight of them belonging to tabs that had
 * been VOIDED, two of them fired six days earlier. A cook was being told to
 * cook meals nobody was going to eat or pay for, and nothing would ever take
 * them down.
 *
 * `cancel()` voided the tab and its line items and never touched the KOT rows,
 * and the board filtered on the docket's own status alone — so a docket for a
 * dead tab was indistinguishable from one for a table still waiting.
 */
class CancelledTabLeavesThePassTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $pizza;

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
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pepperoni Pizza', 'price' => 1000, 'track_inventory' => false, 'is_active' => true,
        ]);
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'area' => 'Hall', 'seats' => 4,
        ]);
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Open a tab, put a pizza on it, send it to the kitchen. */
    private function firedTab(): array
    {
        $tab = $this->asOwner()->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 2]],
        ])->assertSuccessful();

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", [])->assertSuccessful();

        return $tab;
    }

    private function board(): array
    {
        return $this->asOwner()->getJson('/api/v1/restaurant/kitchen')
            ->assertOk()->json('data.kots');
    }

    public function test_a_fired_tab_is_on_the_pass(): void
    {
        // The denominator. A board that shows nothing would pass the real
        // assertion below for the wrong reason.
        $this->firedTab();

        $this->assertCount(1, $this->board(), 'a fired docket never reached the pass');
    }

    public function test_cancelling_a_tab_takes_its_docket_off_the_pass(): void
    {
        $tab = $this->firedTab();
        $this->assertCount(1, $this->board());

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", [
            'reason' => 'Party left',
        ])->assertOk();

        $this->assertCount(
            0,
            $this->board(),
            'the tab was cancelled and the kitchen is still being told to cook it',
        );
    }

    public function test_the_docket_itself_says_it_is_void_not_merely_hidden(): void
    {
        // Hiding it on the board alone would leave the row lying about itself,
        // and every other reader of that table — a report, a station printer,
        // a future screen — would still see work outstanding.
        $tab = $this->firedTab();

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", [
            'reason' => 'Party left',
        ])->assertOk();

        $this->assertDatabaseHas('kitchen_tickets', [
            'ticket_id' => $tab['id'],
            'status' => 'void',
        ]);
    }

    public function test_settling_a_tab_also_clears_what_the_kitchen_still_holds(): void
    {
        // The commoner path, and the question the cancel bug raises about it:
        // if a paid-for tab leaves a docket `fired`, the board grows forever
        // with work that has already gone out. Measured rather than assumed.
        $tab = $this->firedTab();
        $this->assertCount(1, $this->board());

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
            'payments' => [['method' => 'cash', 'amount' => 2000]],
        ])->assertSuccessful();

        $this->assertCount(
            0,
            $this->board(),
            'the tab was paid and the kitchen is still holding a docket for it',
        );

        // And the docket's own record is UNTOUCHED. A tab being paid says
        // nothing about whether the kitchen sent the food out; writing
        // `served` on a docket the cook never bumped would put a claim in the
        // kitchen's record that the kitchen never made.
        $this->assertDatabaseHas('kitchen_tickets', [
            'ticket_id' => $tab['id'],
            'status' => 'fired',
        ]);
    }

    public function test_the_owners_dashboard_counts_the_same_work_the_pass_shows(): void
    {
        // The worse half. This counted every un-served docket ever fired, with
        // no filter at all — so `kot_waiting`, the number an owner reads to
        // know what the kitchen owes, grew by one for every tab anybody had
        // ever cancelled and never came back down.
        $tab = $this->firedTab();

        $waiting = fn () => (int) $this->asOwner()->getJson('/api/v1/dashboard')
            ->assertOk()->json('data.floor.kot_waiting');

        $this->assertSame(1, $waiting(), 'a fired docket is not counted as work at all');

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", [
            'reason' => 'Party left',
        ])->assertOk();

        $this->assertSame(
            0,
            $waiting(),
            'the tab was cancelled and the owner is still told the kitchen owes the food',
        );
        $this->assertCount(0, $this->board(), 'the pass and the dashboard disagree');
    }

    public function test_a_docket_already_served_is_left_alone(): void
    {
        // Cancelling a tab cannot un-cook food. A docket the kitchen has
        // already sent out is history, and rewriting history to tidy a board
        // is how a kitchen's own record stops being true.
        $tab = $this->firedTab();

        $kot = $this->board()[0];
        $this->asOwner()->postJson("/api/v1/restaurant/kitchen/kot/{$kot['id']}/bump", ['status' => 'ready'])->assertOk();
        $this->asOwner()->postJson("/api/v1/restaurant/kitchen/kot/{$kot['id']}/bump", ['status' => 'served'])->assertOk();

        $this->asOwner()->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", [
            'reason' => 'Party left',
        ])->assertOk();

        $this->assertDatabaseHas('kitchen_tickets', [
            'ticket_id' => $tab['id'],
            'status' => 'served',
        ]);
    }
}
