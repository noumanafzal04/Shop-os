<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchSoldOut;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE AISLE — everything on sale anywhere, not one shop at a time.
 *
 * The marketplace could only ask "what does this shop sell", so the storefront
 * was a directory of shops with the catalog hidden a click inside each one. A
 * customer does not shop for a shop.
 *
 * The invariant these tests exist for is the one a filter rail gets wrong: the
 * COUNT BESIDE AN OPTION MUST BE THE NUMBER OF ROWS CLICKING IT PRODUCES.
 * "Lahore (12)" over a list of nine is a bug nobody can explain, and it is what
 * happens the moment the facet query and the listing query are written twice.
 */
class TheAisleTest extends TestCase
{
    use RefreshDatabase;

    private City $karachi;

    private City $lahore;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->karachi = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->lahore = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
    }

    private function shop(array $overrides = []): Tenant
    {
        $tenant = Tenant::factory()->create(array_merge([
            'online_shop_enabled' => true,
            'setup_completed' => true,
            'city_id' => $this->karachi->id,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ], $overrides));

        Branch::withoutTenancy()->create([
            'tenant_id' => $tenant->id, 'name' => 'Main', 'code' => 'BR01', 'is_default' => true, 'is_active' => true,
        ]);

        return $tenant;
    }

    private function item(Tenant $shop, string $name, array $overrides = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $shop->id, 'type' => 'product', 'name' => $name,
            'price' => 1000, 'stock_quantity' => 5, 'visible_in_marketplace' => true,
        ], $overrides));
    }

    /** @return list<string> */
    private function names(array $query = []): array
    {
        return collect($this->getJson('/api/v1/marketplace/products?'.http_build_query($query))->assertOk()->json('data'))
            ->pluck('name')->sort()->values()->all();
    }

    // ── What may appear at all ──────────────────────────────────────

    public function test_the_aisle_holds_products_from_every_shop_not_one(): void
    {
        $a = $this->shop(['business_name' => 'Shop A']);
        $b = $this->shop(['business_name' => 'Shop B', 'city_id' => $this->lahore->id]);

        $this->item($a, 'Kettle');
        $this->item($b, 'Toaster');

        $this->assertSame(['Kettle', 'Toaster'], $this->names());
    }

    public function test_a_row_names_the_shop_that_sells_it(): void
    {
        $shop = $this->shop(['business_name' => 'Corner Store']);
        $this->item($shop, 'Kettle');

        $row = $this->getJson('/api/v1/marketplace/products')->json('data.0');

        $this->assertSame('Corner Store', $row['shop']['business_name']);
        $this->assertSame($shop->slug, $row['shop']['slug']);
        $this->assertSame('Karachi', $row['shop']['city']['name']);
    }

    public function test_a_demo_shops_catalog_never_appears_beside_a_real_one(): void
    {
        $real = $this->shop(['business_name' => 'Real Shop']);
        // A demo shop is a real tenant row handed to a stranger for a day.
        $demo = $this->shop(['business_name' => 'Demo Shop', 'is_demo' => true, 'demo_expires_at' => now()->addDay()]);

        $this->item($real, 'Real Kettle');
        $this->item($demo, 'Demo Kettle');

        $this->assertSame(['Real Kettle'], $this->names());
    }

    public function test_hidden_and_inactive_products_stay_out(): void
    {
        $shop = $this->shop();
        $this->item($shop, 'On Sale');
        $this->item($shop, 'Not Listed', ['visible_in_marketplace' => false]);
        $this->item($shop, 'Retired', ['is_active' => false]);

        $this->assertSame(['On Sale'], $this->names());
    }

    // ── The filters ─────────────────────────────────────────────────

    public function test_every_filter_narrows_the_aisle(): void
    {
        $karachiShop = $this->shop(['business_name' => 'Karachi Retail']);
        $lahoreShop = $this->shop(['business_name' => 'Lahore Grocer', 'city_id' => $this->lahore->id, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart')]);

        $drinks = Category::withoutTenancy()->create(['tenant_id' => $karachiShop->id, 'name' => 'Drinks']);

        $this->item($karachiShop, 'Cola', ['category_id' => $drinks->id, 'price' => 120]);
        $this->item($karachiShop, 'Jacket', ['price' => 8000, 'discount_price' => 6000]);
        $this->item($lahoreShop, 'Rice', ['price' => 2400]);

        $this->assertSame(['Cola', 'Jacket'], $this->names(['city_id' => $this->karachi->id]));
        $this->assertSame(['Rice'], $this->names(['business_type' => 'mart']));
        $this->assertSame(['Cola'], $this->names(['category' => 'Drinks']));
        $this->assertSame(['Rice'], $this->names(['shop_slug' => $lahoreShop->slug]));
        $this->assertSame(['Jacket'], $this->names(['on_sale' => 1]));
        $this->assertSame(['Cola'], $this->names(['max_price' => 500]));
        $this->assertSame(['Jacket', 'Rice'], $this->names(['min_price' => 500]));
        $this->assertSame(['Cola'], $this->names(['q' => 'col']));
        // The shop's own name is searchable — "everything from the grocer".
        $this->assertSame(['Rice'], $this->names(['q' => 'Grocer']));
    }

    public function test_a_price_filter_uses_the_price_on_the_card(): void
    {
        // THE DRIFT GUARD. `Product::sellingPrice()` decides the price in PHP
        // and the filter decides it in SQL; if they disagree, "under Rs 5,000"
        // lists a product whose sticker says 8,000.
        $shop = $this->shop();
        $this->item($shop, 'Discounted', ['price' => 8000, 'discount_price' => 4000]);
        // A "discount" that is not lower is not a discount — sellingPrice()
        // ignores it, and so must the filter.
        $this->item($shop, 'Fake Discount', ['price' => 3000, 'discount_price' => 9000]);

        $this->assertSame(['Discounted', 'Fake Discount'], $this->names(['max_price' => 5000]));
        $this->assertSame([], $this->names(['min_price' => 5001]));

        $row = collect($this->getJson('/api/v1/marketplace/products?max_price=5000')->json('data'))
            ->firstWhere('name', 'Discounted');
        $this->assertSame(4000.0, (float) $row['price']);
    }

    public function test_a_size_can_be_asked_for_across_shops(): void
    {
        $a = $this->shop(['business_name' => 'A']);
        $b = $this->shop(['business_name' => 'B']);

        $shirt = $this->item($a, 'Shirt', ['stock_quantity' => 0]);
        ProductVariant::withoutTenancy()->create(['tenant_id' => $a->id, 'product_id' => $shirt->id, 'name' => 'L', 'price' => 1200, 'stock_quantity' => 3]);

        $shoes = $this->item($b, 'Shoes', ['stock_quantity' => 0]);
        ProductVariant::withoutTenancy()->create(['tenant_id' => $b->id, 'product_id' => $shoes->id, 'name' => '42', 'price' => 5000, 'stock_quantity' => 2]);

        $this->item($a, 'Plain Belt');

        $this->assertSame(['Shirt'], $this->names(['size' => 'L']));
        $this->assertSame(['Shoes'], $this->names(['size' => '42']));
    }

    public function test_available_means_both_in_stock_and_not_turned_off_tonight(): void
    {
        $shop = $this->shop();
        $branchId = Branch::withoutTenancy()->where('tenant_id', $shop->id)->value('id');

        $this->item($shop, 'On The Shelf');
        $this->item($shop, 'Ran Out', ['stock_quantity' => 0]);
        $eightySixed = $this->item($shop, 'Off Tonight');
        BranchSoldOut::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'branch_id' => $branchId,
            'product_id' => $eightySixed->id, 'variant_id' => null, 'sold_out_at' => now(),
        ]);

        // Answering only "is there stock" offers a basket that is refused at
        // checkout, which is where the 86 button came from in the first place.
        $this->assertSame(['On The Shelf'], $this->names(['in_stock' => 1]));
        $this->assertSame(['Off Tonight', 'On The Shelf', 'Ran Out'], $this->names());
    }

    public function test_a_size_that_carries_the_stock_still_counts_as_available(): void
    {
        // A product WITH sizes holds no stock of its own — the sizes carry it.
        $shop = $this->shop();
        $shirt = $this->item($shop, 'Sized Shirt', ['stock_quantity' => 0]);
        ProductVariant::withoutTenancy()->create(['tenant_id' => $shop->id, 'product_id' => $shirt->id, 'name' => 'M', 'price' => 1200, 'stock_quantity' => 4]);

        $this->assertSame(['Sized Shirt'], $this->names(['in_stock' => 1]));
    }

    public function test_cheapest_first_means_cheapest_first(): void
    {
        $shop = $this->shop();
        $this->item($shop, 'Dear', ['price' => 9000]);
        $this->item($shop, 'Cheap', ['price' => 100]);
        $this->item($shop, 'Middle', ['price' => 900, 'discount_price' => 500]);

        $ordered = collect($this->getJson('/api/v1/marketplace/products?sort=price_asc')->json('data'))->pluck('name')->all();
        $this->assertSame(['Cheap', 'Middle', 'Dear'], $ordered);
    }

    public function test_a_named_set_of_items_can_be_asked_for(): void
    {
        // What the saved list needs: one request for the things a customer
        // hearted, rather than one request per heart.
        $shop = $this->shop();
        $kettle = $this->item($shop, 'Kettle');
        $this->item($shop, 'Toaster');
        $blender = $this->item($shop, 'Blender');

        $this->assertSame(['Blender', 'Kettle'], $this->names(['ids' => "{$kettle->id},{$blender->id}"]));
    }

    public function test_an_empty_saved_list_returns_nothing_not_everything(): void
    {
        // `whereIn('id', [])` and "no filter" are one keystroke apart, and the
        // difference is a saved page that fills itself with the whole shop the
        // moment somebody removes their last item.
        $shop = $this->shop();
        $this->item($shop, 'Kettle');

        $this->assertSame([], $this->names(['ids' => '']));
    }

    // ── The counts beside the options ───────────────────────────────

    public function test_a_facet_count_is_the_number_of_rows_clicking_it_produces(): void
    {
        $karachiA = $this->shop(['business_name' => 'K1']);
        $karachiB = $this->shop(['business_name' => 'K2']);
        $lahore = $this->shop(['business_name' => 'L1', 'city_id' => $this->lahore->id]);

        foreach (['a', 'b', 'c'] as $n) {
            $this->item($karachiA, "K1 {$n}");
        }
        $this->item($karachiB, 'K2 a');
        $this->item($lahore, 'L1 a');

        $facets = $this->getJson('/api/v1/marketplace/products/facets')->assertOk()->json('data');

        $this->assertSame(5, $facets['total']);

        foreach ($facets['cities'] as $city) {
            $listed = $this->getJson("/api/v1/marketplace/products?city_id={$city['id']}&per_page=60")->json('meta.pagination.total');
            $this->assertSame(
                $city['products_count'],
                $listed,
                "The rail offers {$city['name']} ({$city['products_count']}) and clicking it returns {$listed}.",
            );
        }

        // DENOMINATOR: a loop over an empty facet list asserts nothing.
        $this->assertCount(2, $facets['cities']);
    }

    public function test_choosing_one_city_still_shows_what_the_others_hold(): void
    {
        // Counting an axis with its OWN filter applied makes every unselected
        // option read zero, so switching city looks impossible.
        $karachi = $this->shop(['business_name' => 'K']);
        $lahore = $this->shop(['business_name' => 'L', 'city_id' => $this->lahore->id]);

        $this->item($karachi, 'Kettle');
        $this->item($lahore, 'Toaster');
        $this->item($lahore, 'Blender');

        $facets = $this->getJson("/api/v1/marketplace/products/facets?city_id={$this->karachi->id}")->json('data');

        $byName = collect($facets['cities'])->keyBy('name');
        $this->assertSame(1, $byName['Karachi']['products_count']);
        $this->assertSame(2, $byName['Lahore']['products_count'], 'The other city reads zero — its own filter was counted against it.');

        // …while the TOTAL does honour the chosen city, because that is the
        // number the listing is about to show.
        $this->assertSame(1, $facets['total']);
    }

    public function test_the_rail_never_offers_an_option_with_nothing_behind_it(): void
    {
        $shop = $this->shop();
        $drinks = Category::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Drinks']);
        Category::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Empty Aisle']);

        $this->item($shop, 'Cola', ['category_id' => $drinks->id]);

        $facets = $this->getJson('/api/v1/marketplace/products/facets')->json('data');
        $names = collect($facets['categories'])->pluck('name')->all();

        $this->assertSame(['Drinks'], $names);
    }

    public function test_the_price_slider_is_told_the_real_range(): void
    {
        $shop = $this->shop();
        $this->item($shop, 'Cheap', ['price' => 150]);
        $this->item($shop, 'Dear', ['price' => 9000, 'discount_price' => 7500]);

        $price = $this->getJson('/api/v1/marketplace/products/facets')->json('data.price');

        $this->assertSame(150.0, (float) $price['min']);
        // The MAX is what a customer would pay, not the crossed-out sticker.
        $this->assertSame(7500.0, (float) $price['max']);
    }

    // ── One product, on its own page ────────────────────────────────

    public function test_a_product_has_a_page_of_its_own(): void
    {
        $shop = $this->shop(['business_name' => 'Corner Store']);
        $drinks = Category::withoutTenancy()->create(['tenant_id' => $shop->id, 'name' => 'Drinks']);
        $cola = $this->item($shop, 'Cola', ['category_id' => $drinks->id]);
        $this->item($shop, 'Lemonade', ['category_id' => $drinks->id]);

        $body = $this->getJson("/api/v1/marketplace/products/{$cola->id}")->assertOk()->json('data');

        $this->assertSame('Cola', $body['name']);
        $this->assertSame('Corner Store', $body['shop']['business_name']);
        $this->assertSame(['Lemonade'], collect($body['also_from_this_shop'])->pluck('name')->all());
        // Never the numbers a competitor could use.
        $this->assertArrayNotHasKey('cost', $body);
        $this->assertArrayNotHasKey('stock_quantity', $body);
    }

    public function test_a_hidden_shops_product_has_no_page(): void
    {
        $hidden = $this->shop(['business_name' => 'Offline Shop', 'online_shop_enabled' => false]);
        $item = $this->item($hidden, 'Secret Kettle');

        // 404, never 403 — existence is not revealed either way.
        $this->getJson("/api/v1/marketplace/products/{$item->id}")->assertNotFound();
    }

    public function test_a_shop_rating_can_be_asked_for(): void
    {
        $good = $this->shop(['business_name' => 'Good Shop']);
        $poor = $this->shop(['business_name' => 'Poor Shop']);

        foreach ([5, 5, 4] as $stars) {
            Review::withoutTenancy()->create([
                'tenant_id' => $good->id, 'customer_id' => User::factory()->create()->id,
                'rating' => $stars, 'is_published' => true,
            ]);
        }
        Review::withoutTenancy()->create([
            'tenant_id' => $poor->id, 'customer_id' => User::factory()->create()->id,
            'rating' => 2, 'is_published' => true,
        ]);

        $this->item($good, 'Good Kettle');
        $this->item($poor, 'Poor Kettle');

        $this->assertSame(['Good Kettle'], $this->names(['rating_min' => 4]));
    }
}
