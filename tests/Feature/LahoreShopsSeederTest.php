<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Database\Seeders\CitySeeder;
use Database\Seeders\LahoreShopsSeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * TEN SHOPS IN ONE CITY — and every fence they have to clear to be seen.
 *
 * ── Why a seeder gets a test at all ─────────────────────────────────────
 *
 * Because "the app is empty" has been diagnosed as a bug four times and was
 * the data three of them. A shop is invisible to the marketplace if ANY of
 * seven things is wrong — the demo flag, the status, `setup_completed`,
 * `online_shop_enabled`, the `marketplace` MODULE, the city, or the pin — and
 * none of them makes the shop look wrong from the panel. The seeder sets all
 * seven explicitly; this asserts the customer actually sees the result,
 * through the real endpoint rather than by counting rows.
 *
 * It also catches the failure that costs the most time: a seeder that throws
 * halfway leaves a half-built world, and the next person debugs the app.
 */
class LahoreShopsSeederTest extends TestCase
{
    use RefreshDatabase;

    /** Roughly Gulberg — where a tester in Lahore would be standing. */
    private const PIN = ['lat' => 31.5204, 'lng' => 74.3587];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
    }

    public function test_it_builds_ten_shops_in_lahore(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $this->assertSame(10, Tenant::query()->whereNotNull('city_id')->count());
        // Every one of them has an owner who can sign in.
        $this->assertSame(10, User::query()->where('email', 'like', 'lahore%@app.com')->count());
    }

    /** Every shop carries a catalog. An empty shop is the bug being prevented. */
    public function test_every_shop_has_products_in_real_categories(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        foreach (Tenant::query()->get() as $shop) {
            $products = Product::withoutTenancy()->where('tenant_id', $shop->id)->get();

            $this->assertGreaterThanOrEqual(
                10, $products->count(), "{$shop->business_name} has too few products",
            );
            // …and each one is filed somewhere, or the aisle's category filter
            // is a control with nothing behind it.
            $this->assertSame(
                0, $products->whereNull('category_id')->count(),
                "{$shop->business_name} has uncategorised products",
            );
        }
    }

    /**
     * THE ASSERTION THAT MATTERS. Not "are there rows" — "does the app see
     * them", asked through the endpoint the app actually calls, with a pin.
     */
    public function test_a_customer_standing_in_lahore_sees_all_ten(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $shops = $this->getJson('/api/v1/marketplace/shops?lat='.self::PIN['lat'].'&lng='.self::PIN['lng'])
            ->assertOk()->json('data');

        $this->assertCount(10, $shops);
        // And every one of them can be delivered to from where they stand —
        // a listed shop that refuses at checkout is worse than one that is
        // not listed.
        foreach ($shops as $shop) {
            $this->assertTrue($shop['delivers_to_me'], "{$shop['business_name']} does not deliver to the city centre");
        }
    }

    /**
     * The home screen's tiles come from `business_types`, and a tile is only
     * drawn for a trade that has shops. One shop per trade is a home screen
     * with two tiles and a lot of white.
     */
    public function test_the_home_feed_has_enough_trades_to_fill_the_tiles(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $home = $this->getJson('/api/v1/marketplace/home?lat='.self::PIN['lat'].'&lng='.self::PIN['lng'])
            ->assertOk()->json('data');

        // The grid wants seven, and the tile count is a LAYOUT decision — it
        // must not be made by however many trades happen to have a shop here.
        $this->assertGreaterThanOrEqual(7, count($home['business_types']));
        $this->assertGreaterThanOrEqual(8, count($home['nearby']));

        // The ones with shops come first, so the seven that fit are the seven
        // worth opening.
        $counts = array_column($home['business_types'], 'shops_count');
        $this->assertSame($counts, array_reverse(collect($counts)->sort()->values()->all()));
        $this->assertGreaterThan(0, $counts[0]);
    }

    /**
     * ONE TRADE, ONE TILE.
     *
     * `grocery` and `mart` are the same trade with two spellings — the second
     * is a legacy code kept so old rows resolve. The home feed grouped on the
     * raw column, so a city with one of each drew TWO tiles both saying a
     * version of "Mart", with the shops split between them. The categories
     * page has folded them since it was written.
     */
    public function test_a_legacy_type_code_does_not_get_a_tile_of_its_own(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        // One of the marts, re-labelled with the legacy code a real old row
        // would carry.
        Tenant::query()->where('slug', 'gulberg-kiryana')
            ->update(['business_type' => 'grocery']);

        $types = collect($this->getJson('/api/v1/marketplace/home?lat='.self::PIN['lat'].'&lng='.self::PIN['lng'])
            ->assertOk()->json('data.business_types'));

        $this->assertCount(0, $types->where('type', 'grocery'), 'the legacy code drew its own tile');
        // …and its shop is still counted, under the primary code.
        $this->assertSame(2, $types->firstWhere('type', 'mart')['shops_count']);
    }

    /** Products have to be findable, not just present. */
    public function test_the_aisle_and_search_both_return_things(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $aisle = $this->getJson('/api/v1/marketplace/products?lat='.self::PIN['lat'].'&lng='.self::PIN['lng'])
            ->assertOk()->json('data');
        $this->assertNotEmpty($aisle);

        // A name a tester would actually type.
        $found = $this->getJson('/api/v1/marketplace/products?search=karahi&lat='.self::PIN['lat'].'&lng='.self::PIN['lng'])
            ->assertOk()->json('data');
        $this->assertNotEmpty($found, 'searching for a dish that exists found nothing');
    }

    /**
     * The trap that emptied the rider app for a whole evening: shops default to
     * their OWN riders, and with `self` no order is ever offered to the pool.
     */
    public function test_every_shop_uses_the_platform_rider_pool(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        foreach (Tenant::query()->get() as $shop) {
            $this->assertSame(
                'platform', $shop->setting('delivery_provider'),
                "{$shop->business_name} would never offer a job to a rider",
            );
        }
    }

    /**
     * THE ONE THAT MATTERS ON A LIVE DATABASE.
     *
     * This seeder is meant to be run against live on purpose, and
     * `updateOrCreate` keyed on a slug is a REWRITE when the slug already
     * belongs to somebody. "Al-Madina Cash & Carry" is a plausible name for a
     * real shop; taking its row and overwriting the name, pin, hours and
     * settings with a fixture's would be the worst thing in this file.
     */
    public function test_it_refuses_to_overwrite_a_real_shop_wearing_one_of_its_slugs(): void
    {
        $real = Tenant::query()->create([
            'business_name' => "Somebody's Actual Shop",
            'slug' => 'al-madina-cash-carry',
            'email' => 'owner@arealshop.pk',
            'business_type' => 'mart',
            'setup_completed' => true,
        ]);

        $this->seed(LahoreShopsSeeder::class);

        $real->refresh();
        $this->assertSame("Somebody's Actual Shop", $real->business_name);
        $this->assertSame('owner@arealshop.pk', $real->email);
        // Untouched means untouched: no catalog was poured into it either.
        $this->assertSame(0, Product::withoutTenancy()->where('tenant_id', $real->id)->count());

        // …and the other nine still landed. Refusing one must not abort the run.
        $this->assertSame(9, Tenant::query()->where('email', 'like', '%@lahore.test')->count());
    }

    /** Running it twice is something people do. It must not double anything. */
    public function test_running_it_again_changes_nothing(): void
    {
        $this->seed(LahoreShopsSeeder::class);
        $shops = Tenant::query()->count();
        $products = Product::withoutTenancy()->count();

        $this->seed(LahoreShopsSeeder::class);

        $this->assertSame($shops, Tenant::query()->count());
        $this->assertSame($products, Product::withoutTenancy()->count());
    }

    /** No Lahore, no crash — a seeder that throws leaves a half-built world. */
    public function test_it_says_so_rather_than_failing_when_the_city_is_missing(): void
    {
        City::query()->where('name', 'Lahore')->delete();

        $this->seed(LahoreShopsSeeder::class);

        $this->assertSame(0, Tenant::query()->count());
    }
}
