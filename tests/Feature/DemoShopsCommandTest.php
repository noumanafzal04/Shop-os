<?php

namespace Tests\Feature;

use App\Console\Commands\DemoShops\CafeMenu;
use App\Console\Commands\DemoShops\MartShelves;
use App\Console\Commands\DemoShops\TradeLists;
use App\Console\Commands\SeedDemoShops;
use App\Enums\UserRole;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\CitySeeder;
use Database\Seeders\PlanSeeder;
use Database\Seeders\SuperAdminSeeder;
use Faker\Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PHPUnit\Framework\Attributes\Group;
use ReflectionMethod;
use Tests\TestCase;

/**
 * The shops that are handed to somebody.
 *
 * `demo:shops` is run on a server, by hand, and then a login is given to a
 * stranger. So what is held here is what that stranger meets: goods with names
 * a shopkeeper recognises, a restaurant with a floor and a kitchen in use, a
 * login that works — and a command that can be run on a live box without
 * needing a development package or taking anything that is not its own.
 */
class DemoShopsCommandTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed([CitySeeder::class, PlanSeeder::class]);
    }

    // ── what is on the shelves ────────────────────────────────────────

    public function test_the_restaurant_has_a_menu_of_more_than_five_hundred_dishes_each_named_once(): void
    {
        $dishes = [];
        foreach (CafeMenu::sections() as $section => $list) {
            $this->assertNotEmpty($list, "the {$section} section is empty");
            $this->assertArrayHasKey($section, CafeMenu::STATIONS, "nobody cooks the {$section} section");
            foreach ($list as $dish => $price) {
                $this->assertGreaterThan(0, $price, "{$dish} is free");
                $dishes[] = $dish;
            }
        }

        $this->assertGreaterThan(500, count($dishes));
        $this->assertSame(count($dishes), count(array_unique($dishes)), 'a dish is on the menu twice');
    }

    public function test_every_other_shop_sells_things_with_names_and_no_two_alike(): void
    {
        $shops = [
            'the mart' => MartShelves::lines(),
            'the chemist' => TradeLists::pharmacy(),
            'the clothing shop' => TradeLists::clothing(),
            'the workshop' => TradeLists::workshop(),
            'the forecourt shop' => TradeLists::forecourtShop(),
            'the repair centre' => TradeLists::repairCentre(),
            'the gadget store' => TradeLists::gadgetStore(),
        ];

        foreach ($shops as $which => $lines) {
            $names = array_column($lines, 'name');
            $this->assertGreaterThan(50, count($lines), "{$which} is nearly empty");
            $this->assertSame(count($names), count(array_unique($names)), "{$which} carries one thing twice");
            foreach ($lines as $line) {
                $this->assertGreaterThan(0, $line['price'], "{$line['name']} is free");
                $this->assertNotSame('', trim($line['category']));
                // The load test's own way of telling six thousand lines apart.
                $this->assertDoesNotMatchRegularExpression('/#\d+$/', $line['name']);
            }
        }

        $this->assertGreaterThan(500, count($shops['the mart']));
        // What is weighed is said to be, and only in the aisles that weigh.
        $weighed = array_filter($shops['the mart'], fn (array $l) => $l['by_weight']);
        $this->assertNotEmpty($weighed);
        foreach ($weighed as $line) {
            $this->assertContains($line['category'], MartShelves::WEIGHED);
        }
    }

    // ── it runs where it will be run ──────────────────────────────────

    public function test_it_makes_its_rows_by_hand_because_a_server_has_no_faker(): void
    {
        // A factory needs Faker; `composer install --no-dev` does not install
        // it. The builder this command borrows uses factories, so the two
        // places a row is made are the two it must answer for itself.
        foreach (['newTenant', 'newUser'] as $method) {
            $this->assertSame(
                SeedDemoShops::class,
                (new ReflectionMethod(SeedDemoShops::class, $method))->getDeclaringClass()->getName(),
                "{$method}() is the load test's, which makes its rows with a factory",
            );
        }

        $source = (string) file_get_contents((string) (new \ReflectionClass(SeedDemoShops::class))->getFileName());
        $code = (string) preg_replace('~/\*.*?\*/|//[^\n]*~s', '', $source);
        $this->assertStringNotContainsString('factory(', $code);
        $this->assertStringNotContainsString('fake(', $code);
    }

    public function test_the_books_only_office_is_built_and_its_owner_can_sign_in(): void
    {
        $this->artisan('demo:shops', ['--only' => 'shop9', '--sales' => 4])->assertSuccessful();

        $tenant = Tenant::query()->where('slug', 'jtdemo-accounts')->firstOrFail();
        $this->assertSame('Malik & Co. Accounts', $tenant->business_name);
        $this->assertSame('finance', $tenant->business_type);
        $this->assertFalse((bool) $tenant->online_shop_enabled);
        $this->assertSame('#0F766E', $tenant->settings['theme_primary'] ?? null);

        $owner = User::query()->where('email', 'shop9@johartown.demo')->firstOrFail();
        $this->assertSame(UserRole::ShopOwner, $owner->role);
        $this->assertSame($tenant->id, $owner->tenant_id);

        $this->postJson('/api/v1/auth/login', ['identifier' => 'shop9@johartown.demo', 'password' => 'password'])
            ->assertOk();

        // An office keeps books: that is what it was given.
        $this->assertGreaterThan(0, DB::table('expenses')->where('tenant_id', $tenant->id)->count());

        // On a plan, paid month by month, and paid up — the platform's side
        // of the demo is a screen too.
        $this->assertSame('basic', $tenant->plan?->code);
        $this->assertTrue($tenant->subscription_ends_at->isFuture(), 'the demo shop has lapsed');
        $payments = DB::table('subscription_payments')->where('tenant_id', $tenant->id)->orderBy('period_start')->get();
        $this->assertGreaterThanOrEqual(2, $payments->count());
        foreach ($payments as $payment) {
            $this->assertEquals((float) $tenant->plan->price, (float) $payment->amount);
            $this->assertLessThanOrEqual(now()->toDateTimeString(), $payment->paid_at, 'a payment is dated in the future');
        }
        // Each period starts where the last one ended: no gap, no overlap.
        foreach ($payments->skip(1)->values() as $i => $payment) {
            $this->assertSame($payments[$i]->period_end, $payment->period_start);
        }
    }

    /**
     * Stands in for a server installed with `composer install --no-dev`.
     *
     * `fake()` and every factory's `$this->faker` take their generator from the
     * container; one that throws when it is asked for is the nearest this
     * process can come to Faker not being installed at all.
     */
    private function withoutFaker(): void
    {
        $refuse = fn () => throw new \RuntimeException('Faker was asked for — a --no-dev server does not have it.');

        $this->app->bind(Generator::class, $refuse);
        $this->app->bind(Generator::class.':'.config('app.faker_locale', 'en_US'), $refuse);
    }

    public function test_the_restaurant_is_a_restaurant_in_use_and_is_not_on_the_public_marketplace(): void
    {
        $this->withoutFaker();
        $this->artisan('demo:shops', ['--only' => 'shop1', '--sales' => 6])->assertSuccessful();

        $tenant = Tenant::query()->where('slug', 'jtdemo-cafe')->firstOrFail();
        $mine = fn (string $table) => DB::table($table)->where('tenant_id', $tenant->id);

        // The menu, under its own names and on its own sections.
        $this->assertGreaterThan(500, $mine('products')->count());
        $this->assertSame(0, $mine('products')->where('name', 'like', '%#%')->count(), 'a dish still carries the load test\'s number');
        $karahi = $mine('products')->where('name', 'Chicken Karahi (Half)')->first();
        $this->assertNotNull($karahi);
        $this->assertSame('food_item', $karahi->item_type);
        $this->assertSame('Hot Kitchen', $karahi->kitchen_station);
        $this->assertSame('Karahi & Handi', DB::table('categories')->where('id', $karahi->category_id)->value('name'));
        $this->assertEqualsCanonicalizing(
            array_values(array_unique(CafeMenu::STATIONS)),
            $tenant->settings['kitchen_stations'] ?? [],
        );
        // A latte is not asked how spicy it should be.
        $latte = $mine('products')->where('name', 'Latte (Regular)')->value('id');
        $this->assertSame(['Extras'], DB::table('modifier_groups')->where('product_id', $latte)->pluck('name')->all());

        // A floor with people at it, and a kitchen that has been sent orders.
        $this->assertGreaterThan(0, $mine('dining_tables')->count());
        $this->assertGreaterThan(0, $mine('kitchen_tickets')->count(), 'nothing was ever fired to the kitchen');
        $this->assertGreaterThan(0, $mine('sales')->count());
        $this->assertGreaterThan(0, $mine('orders')->count(), 'nobody ever ordered online');

        // On terms of its own — a plan on no price list — and paid at them.
        $this->assertTrue((bool) $tenant->plan?->is_custom);
        $this->assertSame('Johar Café & Grill — custom', $tenant->plan->name);
        $this->assertTrue($tenant->subscription_ends_at->isFuture());
        $this->assertSame([6500.0], $mine('subscription_payments')->distinct()->pluck('amount')->map(fn ($a) => (float) $a)->all());

        // …with that order book, and still not somewhere a stranger can order from.
        $this->assertFalse((bool) $tenant->online_shop_enabled);
        $this->assertSame(0, Tenant::query()->marketplaceVisible()->where('id', $tenant->id)->count());

        $this->postJson('/api/v1/auth/login', ['identifier' => 'shop1@johartown.demo', 'password' => 'password'])->assertOk();
    }

    /**
     * All nine, small. A builder that still runs for the restaurant says
     * nothing about the forecourt, and the day one of them stops building is
     * the day somebody is about to be handed its login.
     *
     * NOT IN THE EVERYDAY RUN. It takes a hundred seconds — two-thirds of what
     * the whole suite took before it — so it is in a group `phpunit.xml`
     * leaves out, and it is run on purpose:
     *
     *     php artisan test --group=every-demo-shop
     *
     * before `demo:shops` is run on a server after the builder or a catalogue
     * has changed. The restaurant and the office above are built every time.
     */
    #[Group('every-demo-shop')]
    public function test_every_trade_builds_and_each_has_its_own_login(): void
    {
        $this->artisan('demo:shops', ['--sales' => 3])->assertSuccessful();

        $shops = Tenant::query()->where('slug', 'like', 'jtdemo-%')->get()->keyBy('business_type');
        $this->assertEqualsCanonicalizing(
            ['food', 'mart', 'pharmacy', 'retail', 'services', 'automotive', 'petroleum', 'online', 'finance'],
            $shops->keys()->all(),
        );

        foreach (range(1, 9) as $n) {
            $owner = User::query()->where('email', "shop{$n}@johartown.demo")->first();
            $this->assertNotNull($owner, "shop{$n} has no owner to sign in as");
            $this->assertTrue(Hash::check('password', $owner->password));
            $this->assertSame(UserRole::ShopOwner, $owner->role);
        }

        // Each sells its own trade's goods — and a shop with stock has stock.
        $count = fn (string $type, string $table) => DB::table($table)->where('tenant_id', $shops[$type]->id)->count();
        $this->assertGreaterThan(500, $count('mart', 'products'));
        $this->assertGreaterThan(200, $count('pharmacy', 'products'));
        $this->assertGreaterThan(0, $count('pharmacy', 'product_batches'), 'a chemist with no batches has no expiry dates');
        $this->assertGreaterThan(0, $count('retail', 'product_variants'), 'a clothing shop with no sizes');
        $this->assertGreaterThan(0, $count('petroleum', 'fuel_tanks'), 'a filling station with no tank');
        $this->assertSame(0, $count('finance', 'products'));
        // An online-only shop has no till, and so nothing rung up at one: every
        // sale on its books is an order that was delivered.
        $this->assertGreaterThan(0, $count('online', 'orders'));
        $this->assertSame(
            [],
            DB::table('sales')->where('tenant_id', $shops['online']->id)->where('channel', '!=', 'online')->distinct()->pluck('channel')->all(),
            'a shop with no till has sales that came from one',
        );

        // Three on the ladder's first three rungs, three on terms of their own.
        $plans = $shops->map(fn (Tenant $t) => $t->plan);
        $this->assertEqualsCanonicalizing(['basic', 'premium', 'pro'], $plans->where('is_custom', false)->pluck('code')->unique()->values()->all());
        $this->assertSame(3, $plans->where('is_custom', true)->count());
        // The one that pays by the year has paid once, and is not in arrears.
        $yearly = $shops['petroleum'];
        $this->assertSame(12, $yearly->plan->billing_period_months);
        $this->assertSame(1, DB::table('subscription_payments')->where('tenant_id', $yearly->id)->count());
        foreach ($shops as $shop) {
            $this->assertTrue($shop->subscription_ends_at->isFuture(), "{$shop->business_name} has lapsed");
        }

        // What each is allowed matches what it was given.
        foreach ($shops as $shop) {
            $this->assertGreaterThanOrEqual(
                DB::table('branches')->where('tenant_id', $shop->id)->count(),
                (int) ($shop->limits['branches'] ?? 0),
                "{$shop->business_name} has more branches than it is allowed",
            );
        }
    }

    public function test_a_shop_that_is_already_there_is_left_alone_until_fresh_is_asked_for(): void
    {
        $this->artisan('demo:shops', ['--only' => 'finance', '--sales' => 4])->assertSuccessful();
        $first = Tenant::query()->where('slug', 'jtdemo-accounts')->firstOrFail();

        // Somebody has been in and renamed it. A second run is not a reset.
        $first->forceFill(['business_name' => 'Renamed By Its Visitor'])->save();
        $this->artisan('demo:shops', ['--only' => 'finance', '--sales' => 4])
            ->expectsOutputToContain('already there')
            ->assertSuccessful();
        $this->assertSame('Renamed By Its Visitor', Tenant::query()->where('slug', 'jtdemo-accounts')->value('business_name'));
        $this->assertSame(1, User::query()->where('email', 'shop9@johartown.demo')->count());

        // …and --fresh is.
        $this->artisan('demo:shops', ['--only' => 'finance', '--sales' => 4, '--fresh' => true])->assertSuccessful();
        $again = Tenant::query()->where('slug', 'jtdemo-accounts')->firstOrFail();
        $this->assertNotSame($first->id, $again->id);
        $this->assertSame('Malik & Co. Accounts', $again->business_name);
        $this->assertSame(1, Tenant::withTrashed()->where('slug', 'jtdemo-accounts')->count());
        // Paid for once over, not twice: the rebuilt shop's history is its own.
        $this->assertSame(
            DB::table('subscription_payments')->where('tenant_id', $again->id)->count(),
            DB::table('subscription_payments')->count(),
        );
        $this->assertSame(1, User::withTrashed()->where('email', 'shop9@johartown.demo')->count());
    }

    public function test_fresh_takes_nothing_that_is_not_one_of_these_shops(): void
    {
        $other = Tenant::factory()->create(['slug' => 'demo-mart', 'business_name' => 'Somebody Else']);
        $theirs = User::factory()->shopOwner($other)->create(['email' => 'shop99@johartown.demo.example']);

        $this->artisan('demo:shops', ['--only' => 'finance', '--sales' => 4])->assertSuccessful();
        $this->artisan('demo:shops', ['--only' => 'finance', '--sales' => 4, '--fresh' => true])->assertSuccessful();

        $this->assertNotNull(Tenant::query()->find($other->id));
        $this->assertNotNull(User::query()->find($theirs->id));
    }

    public function test_an_unknown_shop_is_refused_and_builds_nothing(): void
    {
        $this->artisan('demo:shops', ['--only' => 'bakery'])
            ->expectsOutputToContain('No such shop')
            ->assertFailed();

        $this->assertSame(0, Tenant::query()->where('slug', 'like', 'jtdemo-%')->count());
    }

    // ── the second administrator ──────────────────────────────────────

    public function test_the_platform_account_is_made_once_and_a_changed_password_is_never_put_back(): void
    {
        $this->seed(SuperAdminSeeder::class);

        $admin = User::query()->where('email', 'admin@trueserve.app')->firstOrFail();
        $this->assertSame(UserRole::SuperAdmin, $admin->role);
        $this->assertNull($admin->tenant_id);
        $this->assertTrue(Hash::check('Admin@123', $admin->password));
        $this->postJson('/api/v1/auth/login', ['identifier' => 'admin@trueserve.app', 'password' => 'Admin@123'])->assertOk();

        // Changed, as it must be on a live server — and then somebody seeds again.
        $admin->forceFill(['password' => 'a-password-somebody-chose'])->save();
        $this->seed(SuperAdminSeeder::class);

        $admin->refresh();
        $this->assertTrue(Hash::check('a-password-somebody-chose', $admin->password), 'seeding put the known password back');
        $this->assertSame(1, User::query()->where('email', 'admin@trueserve.app')->count());
    }
}
