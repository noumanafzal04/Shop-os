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
use Illuminate\Support\Facades\Storage;
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

        /**
         * A DISK THAT SERVES A REAL ORIGIN.
         *
         * `Storage::fake` rebuilds the disk from its own config, so the `url`
         * has to be set AFTER it and the resolved instance forgotten — set
         * before, it is discarded and `Storage::url()` answers `/storage/…`,
         * which React Native cannot fetch any more than it can a bare path.
         * A test that accepted that would be blind to the failure it exists
         * for. Same trick, and the same reason, as `JoharTownSeederTest`.
         */
        config(['app.url' => 'https://cartze.test']);
        Storage::fake('public');
        config(['filesystems.disks.public.url' => 'https://cartze.test/storage']);
        Storage::forgetDisk('public');

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

    /**
     * EVERY SHOP HAS A PICTURE, and every picture reaches the phone.
     *
     * The seeder set neither `logo_path` nor `cover_path`, so ten shops in a
     * rail were ten coloured letters — the app's fallback, drawn correctly,
     * because there was nothing to draw. Asserted through the marketplace
     * payload rather than off the column, because the column being set is not
     * the thing that failed: a path that never becomes an absolute URL is the
     * same blank card.
     */
    public function test_every_shop_carries_a_cover_the_app_can_actually_load(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $shops = $this->getJson('/api/v1/marketplace/shops?'.http_build_query(self::PIN))
            ->assertOk()
            ->json('data');

        $this->assertCount(10, $shops);

        foreach ($shops as $shop) {
            $this->assertNotNull($shop['cover_url'], "{$shop['business_name']} has no cover");
            $this->assertNotNull($shop['logo_url'], "{$shop['business_name']} has no logo");
            // Absolute, or the phone cannot fetch it — see the note in setUp.
            $this->assertStringStartsWith('https://', $shop['cover_url']);
            $this->assertStringStartsWith('https://', $shop['logo_url']);
        }

        // …and two shops do not share one picture, which is what a single
        // hard-coded placeholder would have looked like from here.
        $this->assertCount(10, array_unique(array_column($shops, 'cover_url')));
    }

    /**
     * And the GOODS have pictures too.
     *
     * The aisle, search and the basket all draw the product rather than the
     * shop, so covers alone leave two thirds of the app grey.
     */
    public function test_every_product_carries_a_picture(): void
    {
        $this->seed(LahoreShopsSeeder::class);

        $total = Product::withoutTenancy()->count();
        $withArt = Product::withoutTenancy()->has('images')->count();

        $this->assertGreaterThan(0, $total);
        $this->assertSame($total, $withArt, 'some products went out with no image');
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

    /**
     * TAP A TILE, GET SHOPS — the whole journey, in the app's own order.
     *
     * "Grocery pe click karo → koi shop nahi aa rahi."
     *
     * The home screen draws its tiles from `business_types` on the home feed
     * and navigates with the `type` it was given; the list screen passes that
     * straight to `/marketplace/shops` with the same pin. Two endpoints, one
     * vocabulary, and nothing in either repo checks they agree — the app's own
     * suite mocks the API, so it agrees with whatever the app believes.
     *
     * Every tile is walked, not the first one. A journey that works for Mart
     * and empties for Pharmacy is the failure that gets reported as "the app is
     * broken" and reproduces on one tap in four.
     */
    public function test_every_home_tile_leads_to_the_shops_it_counted(): void
    {
        $this->seed(LahoreShopsSeeder::class);
        $pin = '&lat='.self::PIN['lat'].'&lng='.self::PIN['lng'];

        $types = $this->getJson('/api/v1/marketplace/home?'.ltrim($pin, '&'))
            ->assertOk()->json('data.business_types');

        foreach ($types as $tile) {
            $shops = $this->getJson("/api/v1/marketplace/shops?business_type={$tile['type']}{$pin}")
                ->assertOk()->json('data');

            $this->assertCount(
                $tile['shops_count'],
                $shops,
                "the {$tile['label']} tile counted {$tile['shops_count']} and its list returned ".count($shops),
            );
        }
    }

    /**
     * A COUNT BESIDE A LINK IS A COUNT OF WHAT THE LINK OPENS.
     *
     * The tile counts came from every visible shop in the city; the list it
     * opens fences by `servesPin` — the city AND each shop's own delivery
     * radius. So a tile read "Mart & Grocery 4" and opened a list of 2, and
     * both numbers were right about different questions.
     *
     * The test above cannot see it, because every seeded shop is inside every
     * radius. This one puts a mart out of reach on purpose: without it, an
     * unfenced count passes everything.
     */
    public function test_a_tile_does_not_count_shops_its_list_will_not_show(): void
    {
        $this->seed(LahoreShopsSeeder::class);
        $pin = '&lat='.self::PIN['lat'].'&lng='.self::PIN['lng'];

        // Same city, 20 km out, and it only delivers 3. The list will not show
        // it to somebody standing in Gulberg — so the tile must not count it.
        Tenant::query()->where('slug', 'gulberg-kiryana')->update([
            'latitude' => 31.7000,
            'longitude' => 74.3587,
            'settings' => json_encode(['delivery_radius_km' => 3, 'delivery_provider' => 'platform']),
        ]);

        $types = collect($this->getJson('/api/v1/marketplace/home?'.ltrim($pin, '&'))
            ->assertOk()->json('data.business_types'));

        $shops = $this->getJson("/api/v1/marketplace/shops?business_type=mart{$pin}")
            ->assertOk()->json('data');

        $this->assertSame(
            count($shops),
            $types->firstWhere('type', 'mart')['shops_count'],
            'the tile counted shops its own list refuses to show',
        );
    }

    /**
     * And the category tiles, which go the same way with a second parameter.
     */
    public function test_a_category_tile_leads_to_its_shops_too(): void
    {
        $this->seed(LahoreShopsSeeder::class);
        $pin = '&lat='.self::PIN['lat'].'&lng='.self::PIN['lng'];

        $trades = $this->getJson('/api/v1/marketplace/categories')->assertOk()->json('data.business_types');

        foreach ($trades as $trade) {
            foreach ($trade['categories'] ?? [] as $cat) {
                if (($cat['shops_count'] ?? 0) === 0) {
                    continue;
                }

                $code = $cat['code'] ?? $cat['category'] ?? $cat['value'] ?? null;
                if ($code === null) {
                    continue;
                }

                $shops = $this->getJson(
                    "/api/v1/marketplace/shops?business_type={$trade['type']}&business_category={$code}{$pin}"
                )->assertOk()->json('data');

                $this->assertCount(
                    $cat['shops_count'],
                    $shops,
                    "{$trade['label']} → {$cat['label']} counted {$cat['shops_count']}, list returned ".count($shops),
                );
            }
        }
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
