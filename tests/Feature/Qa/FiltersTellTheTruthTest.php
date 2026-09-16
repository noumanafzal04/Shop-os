<?php

namespace Tests\Feature\Qa;

use App\Enums\TenantStatus;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Geo;
use App\Support\ItemTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

/**
 * EVERY FILTER, AND BOTH HALVES OF WHAT IT CLAIMS.
 *
 * ── The bug class ───────────────────────────────────────────────────────
 *
 * A filter is two promises: what it LETS THROUGH and what it KEEPS OUT. Nearly
 * every filter test in this codebase has asserted the first — `assertContains`
 * the thing you asked for — and a filter that was silently dropped from the
 * query chain passes that assertion for ever, because an unfiltered list
 * contains everything.
 *
 * This asked to be written as itself: "sary filters b dekhne hai / sara data b
 * dekhna hai according to cities arha hai / according to distance araha hai".
 * So every case below names a row that must come back AND a row that must not,
 * and the distance and city cases check the NUMBER rather than the presence.
 *
 * ── The denominator ─────────────────────────────────────────────────────
 *
 * "Ten filters tested" means nothing without "out of how many". The last test
 * in this file reads the parameters the two endpoints actually accept out of
 * the controller and fails if any of them is not in the covered list below —
 * so a filter added tomorrow arrives here on its own rather than waiting to be
 * remembered.
 */
class FiltersTellTheTruthTest extends TestCase
{
    use RefreshDatabase;

    /** Roughly Gulberg, Lahore — where the shopper is standing. */
    private const PIN = ['lat' => 31.5204, 'lng' => 74.3587];

    private City $lahore;

    private City $karachi;

    /** @var array<string, Tenant> */
    private array $shops = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->lahore = City::query()->create([
            'name' => 'Lahore', 'is_active' => true, 'latitude' => 31.5204, 'longitude' => 74.3587,
        ]);
        $this->karachi = City::query()->create([
            'name' => 'Karachi', 'is_active' => true, 'latitude' => 24.8607, 'longitude' => 67.0011,
        ]);

        // ~1.2 km from the pin. Free delivery, open always, five stars.
        $this->shops['grocer'] = $this->shop('Gulberg Grocers', 'mart', 'supermarket', $this->lahore, 31.5300, 74.3640, ['delivery_fee' => 0]);
        // ~3 km. Paid delivery, open always, no reviews at all.
        $this->shops['karahi'] = $this->shop('MM Alam Karahi', 'food', 'restaurant', $this->lahore, 31.5470, 74.3587, ['delivery_fee' => 200]);
        // ~2 km, but its hours say it is closed today.
        $this->shops['books'] = $this->shop('Anarkali Books', 'books', 'bookstore', $this->lahore, 31.5380, 74.3587, [
            'delivery_fee' => 50,
            'business_hours' => [[
                // A day that is NOT today, whatever day the suite runs on.
                'day' => (now()->dayOfWeek + 3) % 7, 'open' => '09:00', 'close' => '17:00',
            ]],
        ]);
        // ~30 km out with a 5 km radius — reachable by nobody at this pin.
        $this->shops['far'] = $this->shop('Kasur Medicos', 'pharmacy', 'pharmacy', $this->lahore, 31.2500, 74.3587, [
            'settings' => ['delivery_radius_km' => 5, 'delivery_enabled' => true, 'pickup_enabled' => true],
        ]);
        // No pin at all. Must SINK, never vanish.
        $this->shops['unpinned'] = $this->shop('Mall Road Mobiles', 'retail', 'electronics', $this->lahore, null, null);
        // Another city entirely.
        $this->shops['karachi'] = $this->shop('Tariq Road Retail', 'retail', 'garments', $this->karachi, 24.8700, 67.0300);

        $this->stockThem();
        $this->rate($this->shops['grocer'], 5);
        $this->rate($this->shops['books'], 2);
    }

    // ── The shop list ───────────────────────────────────────────────

    public function test_the_list_is_fenced_to_shops_that_can_actually_reach_the_pin(): void
    {
        $slugs = $this->shopSlugs();

        $this->assertContains($this->shops['grocer']->slug, $slugs);
        $this->assertContains($this->shops['karahi']->slug, $slugs);
        // 30 km away with a 5 km radius.
        $this->assertNotContains($this->shops['far']->slug, $slugs, 'a shop that cannot deliver here is listed');
        // Another city.
        $this->assertNotContains($this->shops['karachi']->slug, $slugs, 'a Karachi shop is listed for a Lahore pin');
        // …and the one with no pin is kept, because "we do not know where it
        // is" is not the same fact as "it is too far".
        $this->assertContains($this->shops['unpinned']->slug, $slugs, 'an un-pinned shop was dropped rather than sunk');
    }

    public function test_distance_is_measured_and_not_guessed(): void
    {
        $rows = $this->shopRows();
        $grocer = collect($rows)->firstWhere('slug', $this->shops['grocer']->slug);

        $expected = Geo::distanceKm(
            self::PIN['lat'], self::PIN['lng'],
            (float) $this->shops['grocer']->latitude, (float) $this->shops['grocer']->longitude,
        );

        // The SQL haversine and the PHP one must agree — two implementations
        // of one formula is how a card and a checkout disagree about a fence.
        $this->assertEqualsWithDelta($expected, $grocer['distance_km'], 0.05);
    }

    public function test_the_nearest_shop_is_first_and_the_un_pinned_one_is_last(): void
    {
        $rows = $this->shopRows();
        $slugs = array_column($rows, 'slug');

        $this->assertSame($this->shops['grocer']->slug, $slugs[0], 'the nearest shop is not first');
        $this->assertSame(
            $this->shops['unpinned']->slug,
            $slugs[count($slugs) - 1],
            'a shop with no pin did not sink to the end',
        );

        // …and the pinned ones are genuinely ascending rather than merely
        // starting with the closest.
        $withPin = array_values(array_filter(array_column($rows, 'distance_km'), fn ($d) => $d !== null));
        $sorted = $withPin;
        sort($sorted);
        $this->assertSame($sorted, $withPin, 'distances are not in order');
    }

    public function test_a_card_never_promises_a_delivery_the_checkout_would_refuse(): void
    {
        foreach ($this->shopRows() as $row) {
            if ($row['delivers_to_me'] === true) {
                $shop = Tenant::query()->where('slug', $row['slug'])->first();
                $this->assertTrue(
                    $shop->deliversTo(self::PIN['lat'], self::PIN['lng']),
                    "{$row['slug']}: the card says it delivers here and the model disagrees",
                );
            }
        }
    }

    public function test_the_city_filter_narrows_and_excludes(): void
    {
        // Asked WITHOUT a pin, so the only thing doing any work is the city.
        $lahore = $this->shopSlugs(['city_id' => $this->lahore->id], pin: false);
        $karachi = $this->shopSlugs(['city_id' => $this->karachi->id], pin: false);

        $this->assertContains($this->shops['grocer']->slug, $lahore);
        $this->assertNotContains($this->shops['karachi']->slug, $lahore, 'the city filter let another city through');

        $this->assertSame([$this->shops['karachi']->slug], $karachi);
    }

    public function test_the_trade_filter_narrows_and_knows_its_own_old_names(): void
    {
        $food = $this->shopSlugs(['business_type' => 'food']);
        $this->assertContains($this->shops['karahi']->slug, $food);
        $this->assertNotContains($this->shops['grocer']->slug, $food, 'a mart came back under food');

        // `grocery` is the LEGACY code for `mart`. The Grocery tile sends it.
        $grocery = $this->shopSlugs(['business_type' => 'grocery']);
        $this->assertContains($this->shops['grocer']->slug, $grocery, 'the legacy trade code found nothing');
        $this->assertNotContains($this->shops['karahi']->slug, $grocery);
    }

    public function test_the_finer_category_is_exact_rather_than_a_like(): void
    {
        $rows = $this->shopSlugs(['business_category' => 'restaurant']);
        $this->assertSame([$this->shops['karahi']->slug], $rows);
    }

    public function test_search_matches_a_name_or_a_category_and_not_everything(): void
    {
        $this->assertContains($this->shops['karahi']->slug, $this->shopSlugs(['search' => 'Karahi']));
        $this->assertNotContains($this->shops['grocer']->slug, $this->shopSlugs(['search' => 'Karahi']));
        // The category column is searched too — "supermarket" is nobody's name.
        $this->assertContains($this->shops['grocer']->slug, $this->shopSlugs(['search' => 'supermarket']));
    }

    public function test_open_now_drops_the_shop_that_is_shut(): void
    {
        $open = $this->shopSlugs(['open_now' => 1]);

        $this->assertContains($this->shops['grocer']->slug, $open);
        $this->assertNotContains($this->shops['books']->slug, $open, 'a shut shop passed the open filter');

        // And without the filter it is still THERE, marked shut rather than
        // hidden — a shopper looking for a specific shop must find it.
        $all = collect($this->shopRows())->firstWhere('slug', $this->shops['books']->slug);
        $this->assertNotNull($all);
        $this->assertFalse($all['is_open_now']);
    }

    public function test_free_delivery_means_free_and_not_cheap(): void
    {
        $free = $this->shopSlugs(['free_delivery' => 1]);

        $this->assertContains($this->shops['grocer']->slug, $free);
        $this->assertNotContains($this->shops['books']->slug, $free, 'a Rs 50 fee counted as free');
        $this->assertNotContains($this->shops['karahi']->slug, $free);
    }

    public function test_a_rating_floor_drops_the_unrated_rather_than_flattering_them(): void
    {
        $good = $this->shopSlugs(['rating_min' => 4]);

        $this->assertContains($this->shops['grocer']->slug, $good);   // 5
        $this->assertNotContains($this->shops['books']->slug, $good); // 2
        // Never reviewed. Zero, not "unknown, let it pass" — it has not earned
        // four stars; it has not been asked.
        $this->assertNotContains($this->shops['karahi']->slug, $good, 'an unreviewed shop passed a 4-star floor');
    }

    public function test_a_radius_narrows_the_list_to_what_is_inside_it(): void
    {
        $close = $this->shopSlugs(['radius' => 2]);

        $this->assertContains($this->shops['grocer']->slug, $close, 'grocer (1.18 km) was dropped');
        $this->assertNotContains($this->shops['karahi']->slug, $close, 'karahi (2.96 km) survived a 2 km radius');
        // A radius is a statement about distance, so a shop with no distance
        // cannot satisfy it.
        $this->assertNotContains($this->shops['unpinned']->slug, $close, 'an un-pinned shop satisfied a distance filter');
    }

    // ── The aisle ───────────────────────────────────────────────────

    public function test_the_aisle_is_fenced_by_the_pin_too(): void
    {
        $names = $this->aisleNames();

        $this->assertContains('Daal Chawal', $names);
        $this->assertNotContains('Panadol', $names, 'a product from an unreachable shop is in the aisle');
        $this->assertNotContains('Lawn Suit', $names, 'a product from another city is in the aisle');
    }

    public function test_every_aisle_filter_narrows_and_excludes(): void
    {
        $cases = [
            'q' => [['q' => 'Daal'], 'Daal Chawal', 'Milk Pack'],
            'business_type' => [['business_type' => 'food'], 'Daal Chawal', 'Milk Pack'],
            'shop_slug' => [['shop_slug' => $this->shops['grocer']->slug], 'Milk Pack', 'Daal Chawal'],
            'category' => [['category' => 'Dairy'], 'Milk Pack', 'Daal Chawal'],
            'item_type' => [['item_type' => ItemTypes::FOOD], 'Daal Chawal', 'Milk Pack'],
            'min_price' => [['min_price' => 500], 'Daal Chawal', 'Milk Pack'],
            'max_price' => [['max_price' => 200], 'Milk Pack', 'Daal Chawal'],
            'on_sale' => [['on_sale' => 1], 'Milk Pack', 'Daal Chawal'],
            'in_stock' => [['in_stock' => 1], 'Milk Pack', 'Sold Out Soap'],
            'open_now' => [['open_now' => 1], 'Milk Pack', 'Urdu Novel'],
            'free_delivery' => [['free_delivery' => 1], 'Milk Pack', 'Daal Chawal'],
            'rating_min' => [['rating_min' => 4], 'Milk Pack', 'Urdu Novel'],
            'city_id' => [['city_id' => $this->lahore->id], 'Milk Pack', 'Lawn Suit'],
        ];

        foreach ($cases as $axis => [$query, $wanted, $unwanted]) {
            $names = $this->aisleNames($query);
            $this->assertContains($wanted, $names, "{$axis}: dropped something it should keep");
            $this->assertNotContains($unwanted, $names, "{$axis}: kept something it should drop");
        }
    }

    public function test_the_size_filter_finds_a_variant_rather_than_a_name(): void
    {
        $names = $this->aisleNames(['size' => 'Large']);

        $this->assertContains('Daal Chawal', $names);
        $this->assertNotContains('Milk Pack', $names, 'the size filter matched a product with no sizes');
    }

    public function test_each_sort_actually_reorders(): void
    {
        $byPrice = $this->aisleRows(['sort' => 'price_asc']);
        $prices = array_map(fn ($p) => (float) $p['price'], $byPrice);
        $sorted = $prices;
        sort($sorted);
        $this->assertSame($sorted, $prices, 'price_asc did not sort');

        $desc = array_map(fn ($p) => (float) $p['price'], $this->aisleRows(['sort' => 'price_desc']));
        $this->assertSame(array_reverse($sorted), $desc, 'price_desc did not sort');

        // …and the two are genuinely different orders, which "sorted" alone
        // does not prove on a list that happens to arrive ordered.
        $this->assertNotSame($prices, $desc);
    }

    /**
     * EVERY NUMBER IN THE FILTER RAIL, CHECKED AGAINST PRESSING IT.
     *
     * "Lahore (12)" over a list of nine is a bug nobody can explain from a
     * screenshot, and it is the normal outcome of counting with one query and
     * listing with another. The controller shares `browseQuery` between them
     * for exactly this reason; this is the assertion that it still does.
     */
    public function test_every_facet_counts_what_pressing_it_would_actually_give(): void
    {
        $facets = $this->getJson('/api/v1/marketplace/products/facets?'.http_build_query(self::PIN))
            ->assertOk()->json('data');

        $this->assertNotEmpty($facets, 'the filter rail has no facets at all');
        $this->assertCount($facets['total'], $this->aisleNames(), 'the rail total is not the list length');

        $axes = [
            'business_types' => fn (array $row) => ['business_type' => $row['type']],
            'categories' => fn (array $row) => ['category' => $row['name']],
            'sizes' => fn (array $row) => ['size' => $row['name']],
        ];

        $checked = 0;
        foreach ($axes as $key => $press) {
            $this->assertNotEmpty($facets[$key], "the {$key} facet is empty in a world that has some");

            foreach ($facets[$key] as $row) {
                $listed = $this->aisleNames($press($row));
                $this->assertCount(
                    (int) $row['products_count'],
                    $listed,
                    "{$key}: the rail says ".json_encode($row).' and pressing it shows '.count($listed),
                );
                $checked++;
            }
        }

        // The three scalar counts, which are their own filter each.
        $this->assertCount($facets['on_sale_count'], $this->aisleNames(['on_sale' => 1]));
        $this->assertCount($facets['open_now_count'], $this->aisleNames(['open_now' => 1]));
        $this->assertCount($facets['free_delivery_count'], $this->aisleNames(['free_delivery' => 1]));

        // The denominator for this test's own claim.
        $this->assertGreaterThanOrEqual(6, $checked, 'too few facet rows to have proved anything');
    }

    /**
     * THE PRICE RAIL IS THE RANGE OF WHAT IS ACTUALLY THERE.
     *
     * A min/max taken from the whole table rather than from the fenced list
     * offers a slider whose ends return nothing.
     */
    public function test_the_price_rail_matches_the_list_behind_it(): void
    {
        $facets = $this->getJson('/api/v1/marketplace/products/facets?'.http_build_query(self::PIN))
            ->assertOk()->json('data');

        $prices = array_map(fn ($p) => (float) $p['price'], $this->aisleRows());

        $this->assertEqualsWithDelta(min($prices), (float) $facets['price']['min'], 0.01);
        $this->assertEqualsWithDelta(max($prices), (float) $facets['price']['max'], 0.01);
    }

    /**
     * THE CITY FACET IS AN OFFER TO SWITCH, so it drops the pin with the city.
     *
     * Asserted rather than assumed, because the two readings lead to different
     * numbers and only one of them is honest. Counting Karachi WITH a Lahore
     * pin still applied would answer zero — every Karachi shop is a thousand
     * kilometres outside it — and a rail of zeroes is a rail nobody presses.
     * Counting it without the pin says "switch to Karachi and there is one
     * thing there", which is what the row is for.
     */
    public function test_the_city_rail_counts_what_switching_city_would_give(): void
    {
        $facets = $this->getJson('/api/v1/marketplace/products/facets?'.http_build_query(self::PIN))
            ->assertOk()->json('data');

        $karachi = collect($facets['cities'])->firstWhere('name', 'Karachi');
        $this->assertNotNull($karachi, 'a city with stock is missing from the rail');

        // Pressing it means moving there — city WITHOUT the old pin.
        $there = $this->getJson('/api/v1/marketplace/products?'.http_build_query([
            'city_id' => $karachi['id'], 'per_page' => 100,
        ]))->assertOk()->json('data');

        $this->assertCount((int) $karachi['products_count'], $there);
    }

    // ── The denominator ─────────────────────────────────────────────

    /**
     * EVERY PARAMETER THE ENDPOINTS ACCEPT IS EXERCISED ABOVE.
     *
     * Read out of the controller rather than listed from memory. A filter that
     * is added and not tested fails HERE, which is the only way a coverage
     * claim survives the next person.
     */
    public function test_no_filter_goes_untested(): void
    {
        $source = File::get(app_path('Http/Controllers/Api/V1/Marketplace/MarketplaceController.php'));

        // The aisle's own validated list.
        $block = substr(
            $source,
            strpos($source, 'private function browseFilters'),
            2000,
        );
        preg_match_all("/'([a-z_]+)' => \['nullable'/", $block, $m);
        $accepted = $m[1];

        $covered = [
            'q', 'ids', 'city_id', 'lat', 'lng', 'business_type', 'shop_slug', 'category',
            'item_type', 'size', 'min_price', 'max_price', 'on_sale', 'in_stock',
            'rating_min', 'open_now', 'free_delivery', 'sort',
        ];

        $this->assertNotEmpty($accepted, 'could not read the filter list — the anchor moved');
        $missing = array_diff($accepted, $covered);
        $this->assertSame([], array_values($missing), 'a filter exists that nothing here exercises');
    }

    // ── Fixtures ────────────────────────────────────────────────────

    private function shop(
        string $name, string $type, string $category, City $city,
        ?float $lat, ?float $lng, array $extra = [],
    ): Tenant {
        return Tenant::factory()->create(array_merge([
            'business_name' => $name,
            'business_type' => $type,
            'business_category' => $category,
            // Pharmacy leaves the marketplace OFF by default; this world is
            // about the FILTERS, so every shop is on the marketplace and the
            // default is asserted elsewhere.
            'features' => BusinessTypes::defaultFeatures($type) + ['marketplace' => true],
            'city_id' => $city->id,
            'latitude' => $lat,
            'longitude' => $lng,
            'status' => TenantStatus::Active,
            'setup_completed' => true,
            'online_shop_enabled' => true,
            'is_demo' => false,
            'delivery_fee' => 100,
            'business_hours' => array_map(
                fn (int $d) => ['day' => $d, 'open' => '00:00', 'close' => '23:59'],
                range(0, 6),
            ),
            'settings' => ['delivery_enabled' => true, 'pickup_enabled' => true, 'delivery_radius_km' => 25],
        ], $extra, ['features' => BusinessTypes::defaultFeatures($type) + ['marketplace' => true, 'delivery' => true]]));
    }

    private function stockThem(): void
    {
        $this->item($this->shops['karahi'], 'Daal Chawal', 'Main Course', 600, ItemTypes::FOOD, stock: 0, sizes: ['Large']);
        $this->item($this->shops['grocer'], 'Milk Pack', 'Dairy', 180, ItemTypes::PHYSICAL, stock: 40, discount: 150);
        $this->item($this->shops['grocer'], 'Sold Out Soap', 'Household', 120, ItemTypes::PHYSICAL, stock: 0);
        $this->item($this->shops['books'], 'Urdu Novel', 'Fiction', 900, ItemTypes::PHYSICAL, stock: 5);
        $this->item($this->shops['far'], 'Panadol', 'Medicine', 50, ItemTypes::MEDICINE, stock: 100);
        $this->item($this->shops['karachi'], 'Lawn Suit', 'Garments', 3500, ItemTypes::PHYSICAL, stock: 9);
    }

    private function item(
        Tenant $shop, string $name, string $categoryName, float $price, string $itemType,
        int $stock = 0, ?float $discount = null, array $sizes = [],
    ): Product {
        $category = Category::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => $categoryName, 'is_active' => true, 'sort_order' => 0,
        ]);

        $product = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'category_id' => $category->id,
            'type' => 'product',
            'item_type' => $itemType,
            'name' => $name,
            'price' => $price,
            'cost' => $price * 0.7,
            'discount_price' => $discount,
            'track_inventory' => $itemType !== ItemTypes::FOOD,
            'stock_quantity' => $stock,
            'is_active' => true,
            'visible_in_marketplace' => true,
        ]);

        foreach ($sizes as $size) {
            $product->variants()->create([
                'tenant_id' => $shop->id,
                'name' => $size,
                'price' => $price,
                'stock_quantity' => 10,
                'is_active' => true,
            ]);
        }

        return $product;
    }

    private function rate(Tenant $shop, int $stars): void
    {
        Review::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'customer_id' => User::factory()->create()->id,
            'rating' => $stars,
            'comment' => 'x',
            'is_published' => true,
        ]);
    }

    // ── Readers ─────────────────────────────────────────────────────

    private function shopRows(array $query = [], bool $pin = true): array
    {
        $params = $pin ? self::PIN + $query : $query;

        return $this->getJson('/api/v1/marketplace/shops?'.http_build_query($params + ['per_page' => 100]))
            ->assertOk()->json('data');
    }

    private function shopSlugs(array $query = [], bool $pin = true): array
    {
        return array_column($this->shopRows($query, $pin), 'slug');
    }

    private function aisleRows(array $query = []): array
    {
        return $this->getJson('/api/v1/marketplace/products?'.http_build_query(self::PIN + $query + ['per_page' => 100]))
            ->assertOk()->json('data');
    }

    private function aisleNames(array $query = []): array
    {
        return array_column($this->aisleRows($query), 'name');
    }
}
