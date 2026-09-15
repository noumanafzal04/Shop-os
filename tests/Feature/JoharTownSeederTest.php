<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use Database\Seeders\CitySeeder;
use Database\Seeders\JoharTownSeeder;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * JOHAR TOWN — the names people search for, and the pictures they expect.
 *
 * ── What this guards that the other seeder test does not ────────────────
 *
 * `LahoreShopsSeederTest` asks whether the app can SEE the shops. This asks
 * whether there is anything to LOOK at: a logo on every shop, a picture on
 * every product, and offers that are real reductions rather than decorated
 * numbers.
 *
 * A marketplace with no images reads as one that failed to load, and every
 * one of those three can be absent while every row is present and correct.
 */
class JoharTownSeederTest extends TestCase
{
    use RefreshDatabase;

    private const PIN = ['lat' => 31.4697, 'lng' => 74.2728];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        /**
         * THE URL THE PHONE RECEIVES, not the one a fake disk invents.
         *
         * `Storage::url()` is built from `APP_URL` (see `config/filesystems.php`)
         * and `Storage::fake` leaves that at whatever the test env holds — which
         * yielded `/storage/…`, a root-relative URL. React Native cannot resolve
         * one of those any more than it can resolve a bare path, so a test that
         * accepted it would be blind to exactly the failure it is here for.
         *
         * Set to a real origin, because that is what production has, and the
         * assertion below is that the app gets something it can fetch.
         */
        config(['app.url' => 'https://cartze.test']);
        Storage::fake('public');
        // AFTER the fake, and that ordering is the whole trick: `Storage::fake`
        // swaps the disk for one rooted in a temp directory and built from its
        // own config, so anything set before it is discarded. Re-pointed here
        // and the resolved instance forgotten, so the next `disk('public')`
        // picks the new url up.
        config(['filesystems.disks.public.url' => 'https://cartze.test/storage']);
        Storage::forgetDisk('public');
        $this->seed(CitySeeder::class);
        $this->seed(PlanSeeder::class);
    }

    private function pin(): string
    {
        return 'lat='.self::PIN['lat'].'&lng='.self::PIN['lng'];
    }

    public function test_it_builds_the_neighbourhood(): void
    {
        $this->seed(JoharTownSeeder::class);

        $this->assertSame(8, Tenant::query()->count());
        // Food, and the shops around it — a food court is not a marketplace.
        $this->assertSame(6, Tenant::query()->where('business_type', 'food')->count());
        $this->assertSame(1, Tenant::query()->where('business_type', 'mart')->count());
        $this->assertSame(1, Tenant::query()->where('business_type', 'pharmacy')->count());
    }

    /**
     * THE POINT OF THIS SEEDER. A home screen of coloured letters is a home
     * screen that failed to load.
     */
    public function test_every_shop_has_a_logo_the_app_can_actually_load(): void
    {
        $this->seed(JoharTownSeeder::class);

        $shops = $this->getJson('/api/v1/marketplace/shops?'.$this->pin())->assertOk()->json('data');
        $this->assertCount(8, $shops);

        foreach ($shops as $shop) {
            // Not `logo_path`, which is a storage path `<Image>` cannot
            // resolve — the bug this field was added to fix.
            $this->assertNotNull($shop['logo_url'], "{$shop['business_name']} has no logo");
            $this->assertStringStartsWith('http', $shop['logo_url']);
            $this->assertTrue(
                Storage::disk('public')->exists($shop['logo_path']),
                "{$shop['business_name']}'s logo file was never written",
            );
        }
    }

    public function test_every_product_has_a_picture(): void
    {
        $this->seed(JoharTownSeeder::class);

        foreach (Tenant::query()->get() as $shop) {
            $products = Product::withoutTenancy()->where('tenant_id', $shop->id)->with('images')->get();

            $this->assertGreaterThanOrEqual(10, $products->count(), "{$shop->business_name} has too few items");

            $blank = $products->filter(fn (Product $p) => $p->images->isEmpty());
            $this->assertCount(0, $blank, "{$shop->business_name} has products with no picture");
        }
    }

    /**
     * A STRIKE-THROUGH HAS TO BE TRUE.
     *
     * `price` is the list price and `discount_price` what is charged. Seeding
     * them the other way round — or equal — draws a saving that does not
     * exist, which is the one thing a deals rail must never do.
     */
    public function test_the_deals_are_real_reductions(): void
    {
        $this->seed(JoharTownSeeder::class);

        $offers = Product::withoutTenancy()->whereNotNull('discount_price')->get();
        $this->assertGreaterThanOrEqual(8, $offers->count(), 'nothing is on offer — the deals rail would be empty');

        foreach ($offers as $p) {
            $this->assertLessThan(
                (float) $p->price,
                (float) $p->discount_price,
                "{$p->name} is 'discounted' to the same price or higher",
            );
        }

        // …and the home feed actually carries them, which is the surface that
        // matters.
        $deals = $this->getJson('/api/v1/marketplace/home?'.$this->pin())->assertOk()->json('data.deals');
        $this->assertNotEmpty($deals);
        foreach ($deals as $d) {
            $this->assertGreaterThan(0, $d['percent_off']);
        }
    }

    /** Beverages, because "deals like this type" meant a menu, not a list. */
    public function test_the_food_shops_sell_drinks_too(): void
    {
        $this->seed(JoharTownSeeder::class);

        foreach (Tenant::query()->where('business_type', 'food')->get() as $shop) {
            $drinks = Product::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->whereHas('category', fn ($q) => $q->where('name', 'Beverages'))
                ->count();

            $this->assertGreaterThan(0, $drinks, "{$shop->business_name} sells no drinks");
        }
    }

    /**
     * These are other people's names, so the rows say so in a way one command
     * can act on. Without it, removing them means knowing which eight slugs
     * this file happened to use.
     */
    public function test_every_row_is_marked_so_it_can_be_removed_again(): void
    {
        $this->seed(JoharTownSeeder::class);

        $this->assertSame(8, Tenant::query()->where('email', 'like', '%@johartown.demo')->count());
    }

    public function test_it_refuses_to_overwrite_a_real_shop(): void
    {
        $real = Tenant::query()->create([
            'business_name' => 'Somebody Else',
            'slug' => 'kfc-johar-town',
            'email' => 'owner@real.pk',
            'business_type' => 'food',
            'setup_completed' => true,
        ]);

        $this->seed(JoharTownSeeder::class);

        $this->assertSame('Somebody Else', $real->fresh()->business_name);
        $this->assertSame(7, Tenant::query()->where('email', 'like', '%@johartown.demo')->count());
    }

    public function test_running_it_again_changes_nothing(): void
    {
        $this->seed(JoharTownSeeder::class);
        $shops = Tenant::query()->count();
        $products = Product::withoutTenancy()->count();

        $this->seed(JoharTownSeeder::class);

        $this->assertSame($shops, Tenant::query()->count());
        $this->assertSame($products, Product::withoutTenancy()->count());
    }
}
