<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A tab belongs to the waiter serving it.
 *
 * Until now the dine-in floor had exactly one gate — `sales.manage` — and
 * behind it every waiter could open, work, settle and cancel every table in the
 * building. The floor plan showed which tables were taken and said nothing
 * about by whom.
 *
 * The reason that matters is not privacy; it is money. `GET
 * /restaurant/reports/waiters` is what a restaurant pays tips and commission
 * off, and it attributes each tab's takings to its waiter. If anybody can
 * settle anybody's bill, that report says nothing about who earned it — and the
 * error is invisible, because a settled tab looks identical either way.
 *
 * The rule, and its three deliberate edges:
 *
 *   READS STAY OPEN. A waiter running a colleague's food needs to see the tab.
 *   A floor where half the tables are blank is worse than one where half are
 *   read-only, and hiding a bill prevents no mistake.
 *
 *   AN UNCLAIMED TAB IS EVERYONE'S. A tab with no waiter — a counter takeaway,
 *   a tab from before the column existed — must not become an orphan only an
 *   owner can settle.
 *
 *   OPENING IS ALWAYS ALLOWED. You cannot trespass on a table nobody is
 *   serving; opening it is what makes it yours.
 */
class TableOwnershipTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private User $imran;    // waiter — own tables only

    private User $sana;     // waiter — own tables only

    private User $till;     // cashier — tables.serve_any

    private Product $pizza;

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
        ]);

        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);

        $floor = [Permissions::SALES_MANAGE, Permissions::CUSTOMERS_MANAGE];
        $this->imran = User::factory()->tenantStaff($this->shop, $floor)->create(['name' => 'Imran']);
        $this->sana = User::factory()->tenantStaff($this->shop, $floor)->create(['name' => 'Sana']);
        $this->till = User::factory()
            ->tenantStaff($this->shop, [...$floor, Permissions::TABLES_SERVE_ANY])
            ->create(['name' => 'Bilal']);

        $this->pizza = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Pizza', 'price' => 1000, 'cost' => 400,
            'track_inventory' => false, 'is_active' => true,
        ]);

        $this->t1 = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T1', 'seats' => 4, 'is_active' => true,
        ]);
        $this->t2 = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T2', 'seats' => 2, 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** Open a tab AS someone, so the opener becomes its waiter. */
    private function openTabAs(User $user, ?DiningTable $table = null, array $overrides = []): array
    {
        return $this->actingAsUser($user)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in',
            'dining_table_id' => ($table ?? $this->t1)->id,
            'guest_count' => 2,
            ...$overrides,
        ])->assertCreated()->json('data');
    }

    private function addItemsAs(User $user, string $tabId)
    {
        return $this->actingAsUser($user)->postJson("/api/v1/restaurant/tickets/{$tabId}/items", [
            'items' => [['product_id' => $this->pizza->id, 'quantity' => 1]],
        ]);
    }

    // ── The tab is the waiter's ─────────────────────────────────────

    public function test_opening_a_tab_makes_it_yours(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->assertSame($this->imran->id, $tab['waiter_id']);
        $this->addItemsAs($this->imran, $tab['id'])->assertOk();
    }

    public function test_a_waiter_cannot_add_to_another_waiters_tab(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->addItemsAs($this->sana, $tab['id'])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');
    }

    /** The message names the waiter, because "forbidden" tells a floor nothing. */
    public function test_the_refusal_says_whose_table_it_is(): void
    {
        $tab = $this->openTabAs($this->imran);

        $message = $this->addItemsAs($this->sana, $tab['id'])->json('message');

        $this->assertStringContainsString('Imran', $message);
    }

    public function test_a_waiter_cannot_fire_void_cancel_or_move_another_waiters_tab(): void
    {
        $tab = $this->openTabAs($this->imran);
        $this->addItemsAs($this->imran, $tab['id'])->assertOk();

        $item = $this->actingAsUser($this->imran)
            ->getJson("/api/v1/restaurant/tickets/{$tab['id']}")->json('data.items.0.id');

        $sana = $this->actingAsUser($this->sana);
        $sana->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire")->assertForbidden();
        $sana->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$item}")->assertForbidden();
        $sana->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel")->assertForbidden();
        $sana->postJson("/api/v1/restaurant/tickets/{$tab['id']}/move", [
            'dining_table_id' => $this->t2->id,
        ])->assertForbidden();
    }

    public function test_a_waiter_cannot_settle_another_waiters_tab(): void
    {
        $tab = $this->openTabAs($this->imran);
        $this->addItemsAs($this->imran, $tab['id'])->assertOk();

        $this->actingAsUser($this->sana)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
                'payment_method' => 'cash', 'amount_paid' => 1000,
            ])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');
    }

    /**
     * The one that would otherwise launder an evening: fold Imran's table into
     * your own and his takings become yours on the report.
     */
    public function test_a_waiter_cannot_merge_another_waiters_tab_into_their_own(): void
    {
        $mine = $this->openTabAs($this->sana, $this->t2);
        $theirs = $this->openTabAs($this->imran, $this->t1);

        $this->actingAsUser($this->sana)
            ->postJson("/api/v1/restaurant/tickets/{$mine['id']}/merge", [
                'source_ticket_id' => $theirs['id'],
            ])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');
    }

    // ── Hand-over ───────────────────────────────────────────────────

    public function test_you_may_give_your_own_table_away(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->actingAsUser($this->imran)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/waiter", ['waiter_id' => $this->sana->id])
            ->assertOk();

        // And it really moved: Imran is now the one locked out.
        $this->addItemsAs($this->imran, $tab['id'])->assertForbidden();
        $this->addItemsAs($this->sana, $tab['id'])->assertOk();
    }

    /**
     * Without this, hand-over is the way around every other check: take the
     * table, then do as you like with it.
     */
    public function test_you_may_not_take_someone_elses_table(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->actingAsUser($this->sana)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/waiter", ['waiter_id' => $this->sana->id])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');
    }

    // ── Who is exempt ───────────────────────────────────────────────

    public function test_the_till_settles_anyones_table(): void
    {
        $tab = $this->openTabAs($this->imran);
        $this->addItemsAs($this->imran, $tab['id'])->assertOk();

        $this->actingAsUser($this->till)
            ->postJson("/api/v1/restaurant/tickets/{$tab['id']}/settle", [
                'payment_method' => 'cash', 'amount_paid' => 1000,
            ])
            ->assertCreated();
    }

    public function test_an_owner_holds_it_implicitly(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->addItemsAs($this->owner, $tab['id'])->assertOk();
    }

    /** Takeaway rung at the counter, or a tab from before the column existed. */
    public function test_an_unclaimed_tab_belongs_to_everyone(): void
    {
        $tab = $this->openTabAs($this->imran);
        RestaurantTicket::withoutTenancy()->whereKey($tab['id'])->update(['waiter_id' => null]);

        $this->addItemsAs($this->sana, $tab['id'])->assertOk();
    }

    // ── What stays visible ──────────────────────────────────────────

    /**
     * Reads are open on purpose. A waiter carrying a colleague's food needs to
     * see the tab, and a locked screen prevents no mistake it could make.
     */
    public function test_a_waiter_can_still_read_another_waiters_tab(): void
    {
        $tab = $this->openTabAs($this->imran);

        $this->actingAsUser($this->sana)
            ->getJson("/api/v1/restaurant/tickets/{$tab['id']}")
            ->assertOk()
            ->assertJsonPath('data.waiter.name', 'Imran');
    }

    /** The floor has to say whose table it is, or the rule is a mystery. */
    public function test_the_floor_names_the_waiter_holding_each_table(): void
    {
        $this->openTabAs($this->imran, $this->t1);

        $tables = $this->actingAsUser($this->sana)
            ->getJson('/api/v1/restaurant/tables')->assertOk()->json('data');

        $t1 = collect($tables)->firstWhere('name', 'T1');
        $this->assertSame('Imran', $t1['open_ticket']['waiter']['name']);

        $t2 = collect($tables)->firstWhere('name', 'T2');
        $this->assertNull($t2['open_ticket']);
    }

    /**
     * Reading the floor was behind `settings.manage`, which no preset grants —
     * so the Waiter preset produced someone who could not load the one screen
     * they work all night. Reading is floor work; LAYING OUT the floor is not.
     */
    public function test_a_waiter_reads_the_floor_but_cannot_rearrange_it(): void
    {
        $waiter = $this->actingAsUser($this->imran);

        $waiter->getJson('/api/v1/restaurant/tables')->assertOk();
        $waiter->getJson("/api/v1/restaurant/tables/{$this->t1->id}")->assertOk();

        $waiter->postJson('/api/v1/restaurant/tables', ['name' => 'T3'])->assertForbidden();
        $waiter->deleteJson("/api/v1/restaurant/tables/{$this->t2->id}")->assertForbidden();
        $waiter->postJson('/api/v1/restaurant/tables/reorder', [
            'order' => [$this->t2->id, $this->t1->id],
        ])->assertForbidden();
    }

    // ── The presets that carry it ───────────────────────────────────

    /**
     * The upgrade promise: nobody who could work the whole floor last night
     * finds half of it locked this morning. `RefreshDatabase` migrates an empty
     * database, so the backfill loop never runs in any other test — it is run
     * here by hand against staff that already exist.
     */
    public function test_the_upgrade_leaves_existing_staff_able_to_work_any_table(): void
    {
        // Imran and Sana are staff created before the permission existed.
        foreach ([$this->imran, $this->sana] as $staff) {
            $staff->forceFill(['permissions' => [Permissions::SALES_MANAGE]])->save();
        }
        $stockKeeper = User::factory()
            ->tenantStaff($this->shop, [Permissions::INVENTORY_MANAGE])->create();

        $this->runBackfill();

        $this->assertTrue($this->imran->fresh()->hasPermission(Permissions::TABLES_SERVE_ANY));
        $this->assertTrue($this->sana->fresh()->hasPermission(Permissions::TABLES_SERVE_ANY));

        // …but it is not sprayed over people who never worked a floor.
        $this->assertFalse($stockKeeper->fresh()->hasPermission(Permissions::TABLES_SERVE_ANY));
    }

    public function test_the_backfill_is_repeatable_and_reversible(): void
    {
        $this->imran->forceFill(['permissions' => [Permissions::SALES_MANAGE]])->save();

        $this->runBackfill();
        $this->runBackfill();

        $held = $this->imran->fresh()->permissions;
        $this->assertSame(1, count(array_keys($held, Permissions::TABLES_SERVE_ANY)));

        $this->runBackfill(down: true);
        $this->assertSame([Permissions::SALES_MANAGE], array_values($this->imran->fresh()->permissions));
    }

    private function runBackfill(bool $down = false): void
    {
        $migration = require database_path(
            'migrations/2026_08_07_000002_grant_serve_any_table_to_existing_staff.php',
        );

        $down ? $migration->down() : $migration->up();
    }

    public function test_the_waiter_preset_withholds_it_and_the_till_presets_grant_it(): void
    {
        $this->assertNotContains(Permissions::TABLES_SERVE_ANY, StaffPresets::permissionsFor('waiter'));
        $this->assertNotContains(Permissions::TABLES_SERVE_ANY, StaffPresets::permissionsFor('kitchen'));

        foreach (['cashier', 'shift_supervisor', 'manager'] as $code) {
            $this->assertContains(Permissions::TABLES_SERVE_ANY, StaffPresets::permissionsFor($code), $code);
        }
    }
}
