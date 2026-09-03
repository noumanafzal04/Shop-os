<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Modules;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * THE SCREENS A SHOP CAN NOW DECLINE.
 *
 * ── The complaint ──────────────────────────────────────────────────────
 *
 * A shopkeeper's, not an engineer's: a small takeaway café is shown Disposals,
 * Bank card offers and a warehouse's worth of screens that link to nothing it
 * does, and the clutter is itself the problem.
 *
 * The cause was that the registry held eleven keys while the menu produced
 * fifty-three screens, so most screens arrived as PASSENGERS on a module
 * somebody else bought. Switch `inventory` on for a chemist and Disposals,
 * Stocktake, Barcode Labels, Suppliers and Purchases came with it, whether or
 * not that chemist had ever disposed of anything.
 *
 * The sharpest case is the kitchen. The pass lived inside `feature:dine_in`, so
 * a café that only does takeaway had to switch on a whole restaurant — tables,
 * running tabs, settle, split-bill, waiter reports — to get a slip to its
 * kitchen.
 *
 * ── What is pinned here ────────────────────────────────────────────────
 *
 * Two directions per module, because one without the other is how a half-gate
 * ships: the door SHUTS when the module is off, and it OPENS when it is on. A
 * test that only proved the first would pass over a switch that does nothing
 * but hide things for ever.
 */
class ModuleSplitTest extends TestCase
{
    use RefreshDatabase;

    /**
     * One probe per module: a GET that the gate is the only thing standing in
     * front of. Reads, so nothing here depends on a fixture existing.
     */
    private const PROBE = [
        'purchasing' => '/api/v1/suppliers',
        'stocktake' => '/api/v1/inventory/counts',
        'disposals' => '/api/v1/inventory/disposals',
        'customers' => '/api/v1/customers',
        'promotions' => '/api/v1/coupons',
        'bank_offers' => '/api/v1/banks',
        'documents' => '/api/v1/sale-documents',
        'kitchen' => '/api/v1/restaurant/kitchen',
    ];

    /** What each probe needs switched on BESIDE the module it is testing. */
    private const NEEDS = [
        'purchasing' => ['products', 'inventory'],
        'stocktake' => ['products', 'inventory'],
        'disposals' => ['products', 'inventory'],
        'customers' => ['pos', 'products'],
        'promotions' => ['pos', 'products'],
        'bank_offers' => ['pos', 'products', 'promotions'],
        'documents' => ['pos'],
        'kitchen' => ['products'],
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    /** @param array<string, bool> $modules */
    private function shopWith(array $modules): User
    {
        $tenant = Tenant::factory()->create([
            'business_type' => 'retail',
            'setup_completed' => true,
            'features' => Modules::normalize($modules),
        ]);

        return User::factory()->shopOwner($tenant)->create();
    }

    private function asOwner(User $owner): static
    {
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public static function modules(): array
    {
        return array_map(fn (string $key): array => [$key], array_keys(self::PROBE));
    }

    #[DataProvider('modules')]
    public function test_a_module_that_is_on_opens_its_screen(string $key): void
    {
        $on = array_fill_keys([...self::NEEDS[$key], $key], true);

        $this->asOwner($this->shopWith($on))
            ->getJson(self::PROBE[$key])
            ->assertSuccessful();
    }

    #[DataProvider('modules')]
    public function test_a_module_that_is_off_shuts_its_screen_even_for_the_owner(string $key): void
    {
        // Everything the screen needs EXCEPT the module itself. So the only
        // thing standing between the owner and the page is the switch — a
        // fixture missing a dependency would 403 for the wrong reason and the
        // test would pass while proving nothing.
        $owner = $this->shopWith(array_fill_keys(self::NEEDS[$key], true));

        $this->asOwner($owner)
            ->getJson(self::PROBE[$key])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    #[DataProvider('modules')]
    public function test_a_module_standing_on_nothing_is_not_enabled_however_the_map_was_written(string $key): void
    {
        // `applyModules` normalizes, but `features` is a JSON column and a
        // seeder, a factory or a console data fix can write straight to it.
        // Before the split that cost nothing — a dependant module had no route
        // of its own. Now it would open a stock screen for a shop that keeps no
        // stock, so the chain is walked at the gate rather than trusted.
        if ((Modules::all()[$key]['depends'] ?? []) === []) {
            // `customers` and `promotions` stand on nothing, so a map holding
            // only that key is not impossible — it is a shop that bought one
            // thing. Nothing to prove here.
            $this->markTestSkipped('this module stands on nothing');
        }

        $tenant = Tenant::factory()->create([
            'business_type' => 'retail',
            'setup_completed' => true,
            // Deliberately impossible: the module on, its dependencies off.
            'features' => [$key => true],
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $this->assertFalse($tenant->featureEnabled($key));
        $this->asOwner($owner)->getJson(self::PROBE[$key])->assertForbidden();
    }

    // ── The café this was all for ───────────────────────────────────

    public function test_a_takeaway_cafe_gets_the_pass_without_the_restaurant(): void
    {
        // The whole point. A slip to the kitchen used to cost a floor of
        // tables, running tabs, settle, split-bill and a waiter report.
        $owner = $this->shopWith(['products' => true, 'pos' => true, 'kitchen' => true]);

        $this->asOwner($owner)->getJson('/api/v1/restaurant/kitchen')->assertSuccessful();
        $this->asOwner($owner)->getJson('/api/v1/restaurant/tables')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');
    }

    public function test_a_room_that_seats_people_always_has_a_pass_to_fire_at(): void
    {
        // The other direction, and why `dine_in` depends on `kitchen`: a Fire
        // button whose ticket landed nowhere would be a floor with no kitchen.
        $map = Modules::normalize(['products' => true, 'pos' => true, 'dine_in' => true, 'kitchen' => false]);

        $this->assertFalse($map['dine_in'], 'a dine-in room was allowed to exist with no pass to fire at');

        $both = Modules::normalize(['products' => true, 'dine_in' => true, 'kitchen' => true]);
        $this->assertTrue($both['dine_in']);
        $this->assertTrue($both['kitchen']);
    }

    public function test_a_takeaway_cafe_is_offered_none_of_the_back_office(): void
    {
        $owner = $this->shopWith(['products' => true, 'pos' => true, 'kitchen' => true, 'expenses' => true]);

        foreach (['purchasing', 'stocktake', 'disposals', 'customers', 'promotions', 'bank_offers', 'documents'] as $key) {
            $this->asOwner($owner)->getJson(self::PROBE[$key])
                ->assertForbidden();
        }

        // And it still has everything it DOES use.
        $this->asOwner($owner)->getJson('/api/v1/expenses')->assertSuccessful();
    }

    // ── What each trade starts with ─────────────────────────────────

    public function test_every_trade_starts_with_a_map_that_settles(): void
    {
        // A proposed map that normalize() has to correct is a proposal that
        // lies to the admin: the create screen would show a module ticked and
        // the server would store it off.
        foreach (BusinessTypes::codes() as $code) {
            $proposed = BusinessTypes::defaultFeatures($code);
            $settled = Modules::normalize($proposed);

            foreach (Modules::keys() as $key) {
                $this->assertSame(
                    (bool) ($proposed[$key] ?? false),
                    $settled[$key],
                    "{$code} proposes {$key} in a state normalize() does not agree with",
                );
            }
        }
    }

    public function test_a_cafe_starts_with_the_pass_and_not_with_the_extras(): void
    {
        $food = Modules::defaultsFor('food');

        $this->assertTrue($food['kitchen'], 'a food shop was not given a kitchen pass');
        $this->assertFalse($food['disposals']);
        $this->assertFalse($food['stocktake']);
        $this->assertFalse($food['bank_offers']);
    }

    public function test_a_grocery_starts_with_the_stock_tools_it_actually_uses(): void
    {
        $mart = Modules::defaultsFor('mart');

        foreach (['purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions'] as $key) {
            $this->assertTrue($mart[$key], "a mart was not given {$key}");
        }

        // The one screen a shopkeeper pointed at. Nobody starts with it.
        $this->assertFalse($mart['bank_offers']);
    }

    public function test_no_trade_starts_with_bank_card_offers(): void
    {
        // A discount a BANK funds on its own cards is a mid-sized-retailer
        // arrangement, and it is the screen that started this whole change.
        foreach (BusinessTypes::codes() as $code) {
            $this->assertFalse(
                Modules::defaultsFor($code)['bank_offers'],
                "{$code} starts with bank card offers",
            );
        }
    }

    public function test_a_books_only_office_starts_with_none_of_them(): void
    {
        $finance = Modules::defaultsFor('finance');

        foreach (['purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'bank_offers', 'documents', 'kitchen'] as $key) {
            $this->assertFalse($finance[$key], "a books-only office was given {$key}");
        }

        $this->assertTrue($finance['expenses'], 'the one module it does need');
    }

    // ── The promise the migration exists to keep ────────────────────

    /**
     * NO LIVE SHOP LOSES A SCREEN ON THE MORNING OF THE DEPLOY.
     *
     * A new key defaulting to false would take Purchases away from every shop
     * using it, with no admin having decided anything. So each is backfilled
     * from whatever was letting that screen through yesterday — the parent
     * module, exactly as the sidebar read it.
     *
     * Driven by RUNNING the migration over a map written the old way, rather
     * than by trusting the code to say what it does.
     */
    public function test_a_shop_that_predates_the_split_keeps_every_screen_it_had(): void
    {
        // A mart as it was written before any of these keys existed.
        $before = [
            'products' => true, 'services' => false, 'pos' => true,
            'inventory' => true, 'expenses' => true, 'images' => true,
            'marketplace' => true, 'delivery' => true, 'reservations' => false,
            'dine_in' => false, 'fuel' => false,
        ];

        $shop = Tenant::factory()->create([
            'business_type' => 'mart',
            'setup_completed' => true,
            'features' => $before,
        ]);

        $this->runTheSplit();
        $shop->refresh();

        // Everything inventory used to carry, still carried.
        foreach (['purchasing', 'stocktake', 'disposals', 'labels'] as $key) {
            $this->assertTrue($shop->featureEnabled($key), "the shop lost {$key}, which it had yesterday");
        }
        // Everything a shop that could sell used to carry.
        foreach (['customers', 'promotions', 'bank_offers', 'documents'] as $key) {
            $this->assertTrue($shop->featureEnabled($key), "the shop lost {$key}, which it had yesterday");
        }
        // And nothing it did NOT have.
        $this->assertFalse($shop->featureEnabled('kitchen'), 'a mart with no dine-in was handed a kitchen pass');
        $this->assertFalse($shop->featureEnabled('fuel'));
    }

    public function test_a_shop_with_no_stock_is_not_handed_the_stock_tools(): void
    {
        // The other direction. A backfill that granted everything to everybody
        // would keep every screen and change nothing at all — the migration has
        // to read what each shop actually had.
        $cafe = Tenant::factory()->create([
            'business_type' => 'food',
            'setup_completed' => true,
            'features' => ['products' => true, 'pos' => true, 'expenses' => true, 'inventory' => false, 'dine_in' => true],
        ]);

        $this->runTheSplit();
        $cafe->refresh();

        foreach (['purchasing', 'stocktake', 'disposals', 'labels'] as $key) {
            $this->assertFalse($cafe->featureEnabled($key), "a shop that keeps no stock was handed {$key}");
        }

        // It had a dine-in room, so it had a pass, so it keeps one.
        $this->assertTrue($cafe->featureEnabled('kitchen'));
        // And it could sell, so it keeps the Customers folder it was shown.
        $this->assertTrue($cafe->featureEnabled('customers'));
    }

    public function test_the_backfill_does_not_overwrite_an_admin_who_got_there_first(): void
    {
        // A tenant created between the code deploy and the migration already
        // has an admin's answer on it. `??=` keeps it; a plain assignment would
        // silently switch a module back on that somebody had just switched off.
        $shop = Tenant::factory()->create([
            'business_type' => 'mart',
            'setup_completed' => true,
            'features' => [
                'products' => true, 'pos' => true, 'inventory' => true,
                // The admin looked at this shop and said no.
                'disposals' => false,
            ],
        ]);

        $this->runTheSplit();
        $shop->refresh();

        $this->assertFalse($shop->featureEnabled('disposals'), 'the migration overruled an admin');
        $this->assertTrue($shop->featureEnabled('stocktake'), 'and it still filled the ones nobody had answered');
    }

    /** Run the split migration itself, against whatever is in the database. */
    private function runTheSplit(): void
    {
        $migration = require database_path(
            'migrations/2026_09_03_000001_split_passenger_screens_into_their_own_modules.php',
        );

        $migration->up();
    }

    // ── What the shop itself is told ────────────────────────────────

    public function test_a_shop_can_read_what_it_has_and_what_it_has_not(): void
    {
        // "Why can I not see Purchases" had nowhere to look, and a screen that
        // has simply vanished reads as a broken product.
        $owner = $this->shopWith(['products' => true, 'pos' => true, 'inventory' => true]);

        $rows = collect($this->asOwner($owner)->getJson('/api/v1/shop/modules')->assertOk()->json('data'));

        $this->assertCount(count(Modules::keys()), $rows, 'the shop was shown some of the registry, not all of it');

        $inventory = $rows->firstWhere('key', 'inventory');
        $this->assertTrue($inventory['enabled']);
        $this->assertNotSame('', trim($inventory['description']), 'a module with no words is a row nobody can act on');

        // The OFF ones are listed too. That is the half that answers the
        // question — it is not missing, it is available and not switched on.
        $this->assertFalse($rows->firstWhere('key', 'purchasing')['enabled']);
    }

    public function test_the_shop_is_told_what_the_gat_e_says_and_not_what_the_column_says(): void
    {
        // A hand-written map can hold a module standing on nothing. The screen
        // must agree with the door: showing `purchasing` as on beside a
        // Purchases link that 403s is worse than not showing it at all.
        $tenant = Tenant::factory()->create([
            'business_type' => 'retail',
            'setup_completed' => true,
            'features' => ['purchasing' => true],
        ]);
        $owner = User::factory()->shopOwner($tenant)->create();

        $rows = collect($this->asOwner($owner)->getJson('/api/v1/shop/modules')->assertOk()->json('data'));

        $this->assertFalse($rows->firstWhere('key', 'purchasing')['enabled']);
    }

    public function test_a_cashier_may_read_it_too(): void
    {
        // Behind no permission beyond being in the shop: a cashier asks "where
        // did Purchases go" as often as an owner does, and being unable to see
        // the answer is what turns it into a support call.
        $owner = $this->shopWith(['products' => true, 'pos' => true]);
        $cashier = User::factory()->tenantStaff($owner->tenant, ['sales.manage'])->create();

        $this->asOwner($cashier)->getJson('/api/v1/shop/modules')->assertOk();
    }

    // ── The registry itself ─────────────────────────────────────────

    public function test_every_module_belongs_to_a_section_the_admin_screen_can_render(): void
    {
        foreach (Modules::all() as $key => $meta) {
            $this->assertNotSame('', trim($meta['label']), "{$key} has no label");
            $this->assertNotSame('', trim($meta['description']), "{$key} has no description");
            $this->assertContains($meta['group'], Modules::groups(), "{$key} is in no section");
        }
    }

    public function test_the_registry_and_the_business_type_list_hold_the_same_modules(): void
    {
        // Two lists of one rule. `BusinessTypes::FEATURES` is what a tenant
        // factory fills and what `defaultFeatures` starts from; `Modules::all`
        // is what the admin screen renders and what the gate reads. A key in
        // one and not the other is a module that can be granted and never
        // shown, or shown and never granted.
        $registry = Modules::keys();
        $types = BusinessTypes::FEATURES;
        sort($registry);
        sort($types);

        $this->assertSame(
            $registry,
            $types,
            'App\Support\Modules and BusinessTypes::FEATURES disagree about what a module is',
        );
    }

    public function test_every_dependency_names_a_module_that_exists(): void
    {
        // A typo here is a module that can never be switched on: normalize()
        // would see a dependency that is missing, read it as off, and switch
        // the module straight back off every time.
        foreach (Modules::all() as $key => $meta) {
            foreach ($meta['depends'] as $needs) {
                $this->assertArrayHasKey($needs, Modules::all(), "{$key} depends on {$needs}, which is not a module");
            }
        }
    }
}
