<?php

namespace Database\Seeders;

use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Enums\TenantStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Category;
use App\Models\City;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use Database\Seeders\Concerns\MakesPlaceholderArt;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

/**
 * JOHAR TOWN — the names people actually search for, with pictures.
 *
 * ── What this is for ────────────────────────────────────────────────────
 *
 * `LahoreShopsSeeder` fills the city with believable generic shops, which is
 * what a marketplace needs to be TESTED. This is the other half: somebody
 * looking at a demo types "KFC" before they type "Al-Madina Cash & Carry", and
 * a home screen of names nobody recognises reads as an empty product however
 * many rows it has.
 *
 * Every shop here has a logo and every product a picture, because the thing
 * these screens are for is showing goods — see `MakesPlaceholderArt` for why
 * they are drawn rather than downloaded.
 *
 * ── THESE ARE OTHER PEOPLE'S NAMES ──────────────────────────────────────
 *
 * KFC, McDonald's, Pizza Hut, Cheezious and Subway are trademarks of the
 * companies that own them. This seeder exists so a demo LOOKS like the market
 * it is aimed at; it is not a claim that any of them is on this platform.
 *
 * Every row it writes is marked, and one command removes them all:
 *
 *     php artisan db:seed --class=JoharTownSeeder            # add
 *     php artisan tinker --execute="App\Models\Tenant::query()
 *         ->where('email','like','%@johartown.demo')->forceDelete();"   # remove
 *
 * Keeping them on a public marketplace with a working order button is a
 * decision about somebody else's brand, and it belongs to whoever runs the
 * platform rather than to this file. The `.demo` address is so that decision
 * can always be reversed in one line.
 *
 * Login: johar1@app.com … johar8@app.com / password
 */
class JoharTownSeeder extends Seeder
{
    use MakesPlaceholderArt;

    /** Johar Town, Lahore — roughly the Kalma Chowk end of Khayaban-e-Firdousi. */
    private const CENTRE = [31.4697, 74.2728];

    /**
     * The shops.
     *
     * `[slug, name, type, category, lat offset, lng offset, [r,g,b], menu key]`
     *
     * The offsets are degrees and deliberately tiny — Johar Town is a couple of
     * kilometres across, and a demo where half the shops are outside each
     * other's delivery radius teaches a tester that the app is broken.
     *
     * The colour is the brand's own, near enough to be recognisable on a tile
     * without being the logo itself.
     */
    private const SHOPS = [
        ['kfc-johar-town', 'KFC Johar Town', 'food', 'fast_food', 0.004, 0.003, [200, 16, 46], 'fried_chicken'],
        ['mcdonalds-johar-town', "McDonald's Johar Town", 'food', 'fast_food', -0.005, 0.006, [255, 188, 13], 'burgers'],
        ['pizza-hut-johar-town', 'Pizza Hut Johar Town', 'food', 'fast_food', 0.007, -0.004, [197, 32, 51], 'pizza'],
        ['cheezious-johar-town', 'Cheezious Johar Town', 'food', 'fast_food', -0.003, -0.007, [237, 28, 36], 'pizza'],
        ['pizza-online-johar-town', 'Pizza Online Johar Town', 'food', 'fast_food', 0.009, 0.008, [0, 140, 69], 'pizza'],
        ['subway-johar-town', 'Subway Johar Town', 'food', 'fast_food', -0.008, 0.002, [0, 133, 62], 'subs'],
        // …and the neighbourhood around them, because a food court is not a
        // marketplace. Johar Town's own, not a chain.
        ['johar-mart', 'Johar Town Cash & Carry', 'mart', 'supermarket', 0.006, 0.010, [46, 125, 50], 'mart'],
        ['johar-medicos', 'Johar Medicos', 'pharmacy', 'pharmacy', -0.009, -0.003, [21, 101, 192], 'pharmacy'],
    ];

    public function run(): void
    {
        $city = City::query()->where('name', 'Lahore')->first();

        if ($city === null) {
            $this->command?->warn('JoharTownSeeder: no Lahore in `cities` — run CitySeeder first.');

            return;
        }

        $plan = Plan::query()->where('code', 'premium')->first() ?? Plan::query()->first();

        $this->command?->info('JoharTownSeeder: Johar Town, with logos and product pictures…');

        foreach (self::SHOPS as $i => [$slug, $name, $type, $category, $dLat, $dLng, $rgb, $menu]) {
            $tenant = $this->shop($i + 1, $slug, $name, $type, $category, $city, $plan, $dLat, $dLng, $rgb);

            if ($tenant === null) {
                continue;
            }

            $made = $this->catalog($tenant, $type, $menu, $rgb);
            $this->command?->info(sprintf('  ✓ %-28s %-10s · %d products', $name, $type, $made));
        }
    }

    // ---------------------------------------------------------------

    private function shop(
        int $n, string $slug, string $name, string $type, string $category,
        City $city, ?Plan $plan, float $dLat, float $dLng, array $rgb,
    ): ?Tenant {
        /**
         * NEVER WRITE OVER A SHOP THIS SEEDER DID NOT MAKE — the same guard
         * `LahoreShopsSeeder` carries, and it matters more here: these slugs
         * are real business names, so the chance one already belongs to
         * somebody is not theoretical.
         */
        $existing = Tenant::query()->where('slug', $slug)->first();
        $mine = "shop{$n}@johartown.demo";

        if ($existing !== null && $existing->email !== $mine) {
            $this->command?->warn("  ! {$slug} already belongs to {$existing->business_name} — left alone.");

            return null;
        }

        $tenant = Tenant::query()->updateOrCreate(['slug' => $slug], [
            'business_name' => $name,
            'email' => $mine,
            'phone' => sprintf('+92300222%04d', $n),
            'business_type' => $type,
            'business_category' => $category,
            'plan_id' => $plan?->id,
            'city_id' => $city->id,
            'address' => "{$name}, Johar Town, Lahore",
            'latitude' => round(self::CENTRE[0] + $dLat, 7),
            'longitude' => round(self::CENTRE[1] + $dLng, 7),
            'status' => TenantStatus::Active,
            'setup_completed' => true,
            'online_shop_enabled' => true,
            'is_demo' => false,
            'delivery_fee' => $type === 'food' ? 99 : 120,
            'subscription_starts_at' => now()->subMonths(3),
            'subscription_ends_at' => now()->addYear(),
            'business_hours' => $this->hours($type),
            'settings' => [
                'delivery_radius_km' => 10,
                'delivery_enabled' => true,
                'pickup_enabled' => true,
                // Without this no order ever reaches the rider pool — the
                // default is a shop's own riders, and a demo with an empty
                // rider app is a demo that looks broken.
                'delivery_provider' => 'platform',
                'min_order_amount' => $type === 'food' ? 500 : 0,
                'prep_time_minutes' => $type === 'food' ? 30 : 15,
            ],
        ]);

        // The logo, which is the whole reason this seeder exists — a home
        // screen of coloured letters is a home screen that failed to load.
        $tenant->forceFill(['logo_path' => $this->makeLogo($tenant->id, $name, $rgb)])->save();

        User::query()->updateOrCreate(['email' => "johar{$n}@app.com"], [
            'tenant_id' => $tenant->id,
            'name' => "{$name} Owner",
            'password' => 'password',
            'role' => UserRole::ShopOwner,
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $type);

        // The marketplace module, which several types leave off by default. A
        // shop with a full menu and this flag false is invisible, and nothing
        // about the shop looks wrong while it is.
        $tenant->applyModules(
            array_merge(BusinessTypes::defaultFeatures($type, $category), [
                'marketplace' => true,
                'products' => true,
                'delivery' => true,
            ]),
            merge: false,
        );

        return $tenant->refresh();
    }

    private function hours(string $type): array
    {
        [$open, $close] = $type === 'food' ? ['11:00', '02:00'] : ['09:00', '23:00'];

        return array_map(fn (int $d) => ['day' => $d, 'open' => $open, 'close' => $close], range(0, 6));
    }

    /**
     * The menu, with a picture on every line.
     *
     * Deals are marked by their own category and priced with a `discount_price`
     * so the "% off" rail and the on-sale filter have real content — a demo
     * where nothing is discounted cannot show the feature the home screen leads
     * with.
     */
    private function catalog(Tenant $tenant, string $type, string $menu, array $rgb): int
    {
        if (Product::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return 0;
        }

        $itemType = match ($type) {
            'food' => ItemTypes::FOOD,
            'pharmacy' => ItemTypes::MEDICINE,
            default => ItemTypes::PHYSICAL,
        };

        $n = 0;
        foreach ($this->menu($menu) as [$group, $name, $price, $was]) {
            $category = Category::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $group],
                ['sort_order' => 10],
            );

            $product = Product::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'category_id' => $category->id,
                'type' => 'product',
                'item_type' => $itemType,
                'name' => $name,
                'description' => "{$name} at {$tenant->business_name}, Johar Town.",
                'sku' => strtoupper(Str::slug($tenant->slug, '')).'-'.str_pad((string) ($n + 1), 3, '0', STR_PAD_LEFT),
                'price' => $was ?? $price,
                // A strike-through has to be TRUE: `price` is the list price and
                // `discount_price` the one being charged, so a deal shows a real
                // saving rather than a decorated number.
                'discount_price' => $was === null ? null : $price,
                'cost' => round($price * 0.62, 2),
                'track_inventory' => $type !== 'food',
                'stock_quantity' => $type === 'food' ? 0 : 60,
                'is_active' => true,
                'visible_in_marketplace' => true,
            ]);

            $product->images()->create([
                'tenant_id' => $tenant->id,
                'path' => $this->makeProductImage($product->id, $name, $rgb),
                'sort_order' => 0,
            ]);
            $n++;
        }

        return $n;
    }

    /**
     * What each kind of place sells: [category, name, price now, list price].
     *
     * A null list price means it is not on offer. Real items at Lahore prices,
     * because a menu of "Item 1 … Item 12" tests that a list renders and shows
     * nobody whether the app is worth using.
     *
     * @return list<array{0:string,1:string,2:float,3:float|null}>
     */
    private function menu(string $key): array
    {
        return match ($key) {
            'fried_chicken' => [
                ['Deals', 'Krunch Combo', 690, 850],
                ['Deals', 'Mighty Box Meal', 1190, 1450],
                ['Deals', 'Family Festival (4 pcs + Fries + Drink)', 2390, 2890],
                ['Burgers', 'Zinger Burger', 690, null],
                ['Burgers', 'Krunch Burger', 390, null],
                ['Burgers', 'Zinger Stacker', 990, null],
                ['Chicken', 'Hot Wings — 5 pcs', 560, null],
                ['Chicken', 'Hot & Crispy — 3 pcs', 780, null],
                ['Sides', 'Fries — Regular', 240, null],
                ['Sides', 'Coleslaw', 200, null],
                ['Beverages', 'Pepsi 345ml', 130, null],
                ['Beverages', 'Mountain Dew 500ml', 160, null],
                ['Beverages', 'Mineral Water 500ml', 80, null],
            ],
            'burgers' => [
                ['Deals', 'McSaver Meal', 640, 790],
                ['Deals', 'Happy Meal', 690, null],
                ['Burgers', 'Big Mac', 990, null],
                ['Burgers', 'McChicken', 590, null],
                ['Burgers', 'Double Cheeseburger', 850, null],
                ['Burgers', 'Spicy McCrispy', 790, null],
                ['Sides', 'French Fries — Medium', 260, null],
                ['Sides', 'Chicken McNuggets — 6 pcs', 490, null],
                ['Desserts', 'McFlurry Oreo', 390, null],
                ['Desserts', 'Apple Pie', 220, null],
                ['Beverages', 'Coca-Cola 400ml', 150, null],
                ['Beverages', 'Fresh Orange Juice', 290, null],
                ['Beverages', 'Cold Coffee', 420, null],
            ],
            'pizza' => [
                ['Deals', 'Midnight Deal — Large + Drink', 1590, 1990],
                ['Deals', 'Duo Deal — 2 Medium Pizzas', 2490, 2990],
                ['Deals', 'Solo Box — Small + Fries + Drink', 890, 1090],
                ['Pizza', 'Chicken Fajita — Large', 1890, null],
                ['Pizza', 'Chicken Tikka — Large', 1890, null],
                ['Pizza', 'Peri Peri — Medium', 1390, null],
                ['Pizza', 'Cheese Lover — Medium', 1290, null],
                ['Pizza', 'Behari Kebab — Small', 790, null],
                ['Sides', 'Garlic Bread', 390, null],
                ['Sides', 'Chicken Wings — 6 pcs', 590, null],
                ['Beverages', 'Pepsi 1.5L', 220, null],
                ['Beverages', 'Sprite 500ml', 150, null],
                ['Beverages', 'Mineral Water 1.5L', 120, null],
            ],
            'subs' => [
                ['Deals', 'Sub of the Day + Drink', 690, 890],
                ['Subs', 'Chicken Teriyaki — 6"', 790, null],
                ['Subs', 'Italian BMT — 6"', 850, null],
                ['Subs', 'Roasted Chicken — 12"', 1490, null],
                ['Subs', 'Veggie Delite — 6"', 590, null],
                ['Salads', 'Chicken Caesar Salad', 890, null],
                ['Sides', 'Cookies — 3 pcs', 290, null],
                ['Beverages', 'Fountain Drink — Regular', 160, null],
                ['Beverages', 'Iced Tea', 220, null],
                ['Beverages', 'Mineral Water 500ml', 80, null],
            ],
            'mart' => [
                ['Offers', 'Cooking Oil 5L', 2190, 2450],
                ['Offers', 'Chakki Atta 10kg', 1180, 1350],
                ['Grocery', 'Basmati Rice 5kg', 2200, null],
                ['Grocery', 'Sugar 1kg', 165, null],
                ['Grocery', 'Tea — Danedar 950g', 1890, null],
                ['Dairy', 'Milk 1L', 290, null],
                ['Dairy', 'Yoghurt 1kg', 280, null],
                ['Dairy', 'Eggs — Dozen', 340, null],
                ['Household', 'Washing Powder 1kg', 720, null],
                ['Household', 'Dishwash Liquid 500ml', 380, null],
                ['Beverages', 'Coca-Cola 1.5L', 220, null],
                ['Beverages', 'Mineral Water 1.5L', 110, null],
            ],
            'pharmacy' => [
                ['Offers', 'Vitamin C 1000mg — 20 tabs', 610, 720],
                ['Medicines', 'Panadol 500mg — Strip of 10', 60, null],
                ['Medicines', 'Brufen 400mg — Strip of 10', 95, null],
                ['Medicines', 'Augmentin 625mg — Strip of 6', 640, null],
                ['Medicines', 'Calpol Syrup 120ml', 185, null],
                ['Medicines', 'ORS Sachet', 35, null],
                ['Care', 'Dettol Antiseptic 250ml', 480, null],
                ['Care', 'Surgical Mask — Box of 50', 550, null],
                ['Devices', 'Digital Thermometer', 850, null],
                ['Devices', 'Blood Pressure Monitor', 6500, null],
            ],
            default => [],
        };
    }
}
