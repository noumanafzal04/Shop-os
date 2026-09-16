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
 * TEN SHOPS IN ONE CITY, so the app has something to be.
 *
 * ── Why this exists beside DemoDataSeeder ───────────────────────────────
 *
 * `DemoDataSeeder` builds a rich BUSINESS world — nine shops with sales,
 * expenses, shifts, purchase orders, batches, the lot — and spreads them
 * `$cities[$i % $cities->count()]`. Nine shops over eight cities is one shop
 * per city, and since the marketplace fences by city AND by each shop's
 * delivery radius, a customer standing in Lahore opens the app and sees ONE
 * shop, no trades worth a tile, and an empty home screen.
 *
 * That is correct behaviour on bad data. This seeder is the data: ten shops,
 * all in Lahore, all within a few kilometres of each other, across seven
 * trades — enough for the home screen's tiles, the aisle's filters, search,
 * and a delivery order that a rider can actually be offered.
 *
 * It deliberately does NOT seed sales, shifts or purchasing. Those belong to
 * the business simulation; this one answers "does the customer app have
 * anything in it", and a seeder that answered both would be a second copy of
 * the first one.
 *
 * ── Every fence a shop has to clear to be seen ──────────────────────────
 *
 * Set explicitly below rather than left to a default, because each of them has
 * silently emptied this app at least once:
 *
 *   is_demo false            a demo tenant is never listed
 *   status active            + setup_completed
 *   online_shop_enabled      the shop opted into the marketplace
 *   features.marketplace     the MODULE, which several types leave off
 *   city_id + lat/lng        `scopeServesPin` fences on both
 *   delivery_radius_km       absent means CITY_WIDE_KM, which is fine — but
 *                            stated here so the pins can be read against it
 *   products visible_in_marketplace + is_active
 *
 * Idempotent: keyed by slug and by email, and a shop that already has products
 * is left alone.
 *
 * Login: lahore1@app.com … lahore10@app.com / password
 */
class LahoreShopsSeeder extends Seeder
{
    use MakesPlaceholderArt;

    /**
     * A GROUND PER TRADE, so ten shops are ten shops.
     *
     * These went out with no `logo_path` and no `cover_path` at all, which is
     * why the home screen's rails were ten identical letter tiles: the app was
     * drawing its fallback correctly, ten times, because there was nothing to
     * draw. Keyed by trade rather than by shop so a new row in `SHOPS` gets a
     * colour without anybody remembering to give it one.
     */
    private const GROUND = [
        'food' => [198, 52, 30],
        'mart' => [30, 110, 160],
        'pharmacy' => [22, 132, 108],
        'retail' => [96, 62, 150],
        'bakery' => [176, 116, 34],
        'automotive' => [62, 78, 96],
        'services' => [130, 46, 96],
    ];

    private function ground(string $type): array
    {
        return self::GROUND[$type] ?? [85, 127, 29];
    }

    /** Lahore, and how far the shops are scattered around it. */
    private const CENTRE = [31.5204, 74.3587];

    /**
     * Ten shops.
     *
     * `[slug, name, type, category, area, latOffset, lngOffset]` — the offsets
     * are in degrees and are deliberately small: roughly 0.5 to 4 km out, so
     * every shop is inside every other shop's radius and inside any pin a
     * tester drops in the city. A demo world where half the shops are fenced
     * out is a demo world that teaches the tester the app is broken.
     */
    private const SHOPS = [
        ['al-madina-cash-carry', 'Al-Madina Cash & Carry', 'mart', 'supermarket', 'Gulberg III', 0.010, 0.006],
        ['gulberg-kiryana', 'Gulberg Kiryana Store', 'mart', 'kiryana', 'Gulberg II', -0.008, 0.011],
        ['karahi-junction', 'Karahi Junction', 'food', 'restaurant', 'MM Alam Road', 0.014, -0.009],
        ['lahori-nihari-house', 'Lahori Nihari House', 'food', 'restaurant', 'Johar Town', -0.017, -0.013],
        ['bakery-corner', 'Bakery Corner', 'food', 'bakery', 'Model Town', 0.006, 0.017],
        ['shifa-pharmacy', 'Shifa Pharmacy', 'pharmacy', 'pharmacy', 'Garden Town', -0.012, 0.004],
        ['galaxy-electronics', 'Galaxy Electronics', 'retail', 'electronics', 'Hall Road', 0.019, 0.012],
        ['zara-fabrics', 'Zara Fabrics & Garments', 'retail', 'garments', 'Liberty Market', -0.005, -0.016],
        ['sadiq-hardware', 'Sadiq Hardware & Paints', 'retail', 'hardware', 'Ferozepur Road', 0.021, -0.004],
        ['speed-auto-care', 'Speed Auto Care', 'automotive', 'auto_parts', 'Band Road', -0.020, 0.018],
    ];

    public function run(): void
    {
        $city = City::query()->where('name', 'Lahore')->first();

        if ($city === null) {
            $this->command?->warn('LahoreShopsSeeder: no Lahore in `cities` — run CitySeeder first.');

            return;
        }

        $plan = Plan::query()->where('code', 'premium')->first()
            ?? Plan::query()->first();

        $this->command?->info('LahoreShopsSeeder: ten shops in Lahore…');

        foreach (self::SHOPS as $i => [$slug, $name, $type, $category, $area, $dLat, $dLng]) {
            $tenant = $this->shop($i + 1, $slug, $name, $type, $category, $area, $city, $plan, $dLat, $dLng);

            if ($tenant === null) {
                continue;
            }

            $made = $this->catalog($tenant, $type);

            $this->command?->info(
                sprintf('  ✓ %-28s %-10s %s  · %d products', $name, $type, $area, $made),
            );
        }
    }

    // ─────────────────────────────────────────────────────────────────

    private function shop(
        int $n, string $slug, string $name, string $type, string $category,
        string $area, City $city, ?Plan $plan, float $dLat, float $dLng,
    ): ?Tenant {
        /**
         * NEVER WRITE OVER A SHOP THIS SEEDER DID NOT MAKE.
         *
         * `updateOrCreate` keyed on a slug is a rewrite when the slug already
         * belongs to somebody. "Al-Madina Cash & Carry" is a plausible name for
         * a real Pakistani shop, and this seeder is meant to be run against a
         * live database on purpose — so the one thing it must not do is take a
         * real business's row and overwrite its name, pin, hours and settings
         * with a fixture's.
         *
         * The seeder's own email is the proof of ownership. Anything else
         * wearing this slug is somebody's shop, and it is left alone and said
         * out loud rather than skipped quietly.
         */
        $existing = Tenant::query()->where('slug', $slug)->first();
        $mine = "shop{$n}@lahore.test";

        if ($existing !== null && $existing->email !== $mine) {
            $this->command?->warn(
                "  ! {$slug} already belongs to {$existing->business_name} — left alone.",
            );

            return null;
        }

        $tenant = Tenant::query()->updateOrCreate(['slug' => $slug], [
            'business_name' => $name,
            'email' => "shop{$n}@lahore.test",
            'phone' => sprintf('+92300111%04d', $n),
            'business_type' => $type,
            'business_category' => $category,
            'plan_id' => $plan?->id,
            'city_id' => $city->id,
            'address' => "{$name}, {$area}, Lahore",
            'latitude' => round((float) ($city->latitude ?? self::CENTRE[0]) + $dLat, 7),
            'longitude' => round((float) ($city->longitude ?? self::CENTRE[1]) + $dLng, 7),
            'status' => TenantStatus::Active,
            'setup_completed' => true,
            'online_shop_enabled' => true,
            // A shop handed to a stranger from the landing page is never listed.
            // These are permanent fixtures, so they are not that.
            'is_demo' => false,
            'delivery_fee' => 120,
            'subscription_starts_at' => now()->subMonths(3),
            'subscription_ends_at' => now()->addYear(),
            'business_hours' => $this->openAllWeek($type),
            // A PICTURE, because the card is shaped for one. `shopBanner` in
            // the app reaches for the cover first and falls back to the logo;
            // with neither set, every rail on the home screen was a row of
            // coloured letters and the report was that covers "show ni ho rhi".
            'logo_path' => $this->makeLogo($slug, $name, $this->ground($type)),
            'cover_path' => $this->makeCover($slug, $name, $this->ground($type)),
            'settings' => [
                // EIGHTEEN, and the number was measured rather than picked.
                //
                // Ten looked generous and was not: these shops sit around the
                // city centre and a tester standing in Johar Town is 10.2 to
                // 12.1 km from seven of them, so seven of ten vanished and the
                // report was "saari shops show ni ho rahi". The fence was
                // right; the demo world was laid out wider than the radius it
                // was given.
                //
                // Still a real number rather than "no limit" — an absent radius
                // means CITY_WIDE_KM, which would hide the fence rather than
                // demonstrate it. Lahore is roughly 20 km across, so this is
                // what a shop that genuinely covers the city would set.
                'delivery_radius_km' => 18,
                'delivery_enabled' => true,
                'pickup_enabled' => true,
                // THE ONE THAT COST A WHOLE EVENING. Shops default to their own
                // riders, and with `self` no order is ever offered to the
                // platform pool — so the rider app stays empty however many
                // orders are placed. Stated, because a default that quietly
                // switches off the rider side is the kind of thing a demo world
                // exists to prevent.
                'delivery_provider' => 'platform',
                'min_order_amount' => $type === 'food' ? 400 : 0,
                'prep_time_minutes' => $type === 'food' ? 25 : 15,
            ],
        ]);

        User::query()->updateOrCreate(['email' => "lahore{$n}@app.com"], [
            'tenant_id' => $tenant->id,
            'name' => "{$name} Owner",
            'password' => 'password',
            'role' => UserRole::ShopOwner,
            'status' => UserStatus::Active,
            'email_verified_at' => now(),
        ]);

        // Categories come from the type's own template — the same ones a real
        // shop is given on its first day, so the aisle's category filter shows
        // what a real customer would see rather than something invented here.
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $type);

        // …and then the marketplace module, which several types leave OFF by
        // default. A shop with a full catalog and this flag false is invisible,
        // and nothing about the shop looks wrong while it is.
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

    /** Open 08:00–23:00 every day, so nothing in the demo reads "Closed". */
    private function openAllWeek(string $type): array
    {
        [$open, $close] = $type === 'food' ? ['11:00', '23:45'] : ['08:00', '23:00'];

        return array_map(
            fn (int $d) => ['day' => $d, 'open' => $open, 'close' => $close],
            range(0, 6),
        );
    }

    /**
     * The catalog, spread across the categories the type template just made.
     *
     * Returns how many were written. Zero means the shop already had some —
     * re-running must not double a catalog.
     */
    private function catalog(Tenant $tenant, string $type): int
    {
        if (Product::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return 0;
        }

        $categories = Category::withoutTenancy()
            ->where('tenant_id', $tenant->id)->orderBy('sort_order')->get();

        $itemType = match ($type) {
            'food' => ItemTypes::FOOD,
            'pharmacy' => ItemTypes::MEDICINE,
            default => ItemTypes::PHYSICAL,
        };

        $n = 0;
        foreach ($this->itemsFor($tenant->business_category ?? $type) as $i => [$item, $price, $unit]) {
            // Round-robin across whatever categories this type actually has, so
            // no category is empty and the filter is worth opening. A product
            // with no category is legal and useless to browse.
            $category = $categories->isEmpty() ? null : $categories[$i % $categories->count()];

            // Every fourth thing is on offer. Enough for the Deals rail and the
            // "on sale" filter to have content; not so many that a strike-through
            // stops meaning anything — see the price-and-the-card rule.
            $discount = $i % 4 === 0 ? round($price * 0.85, 2) : null;

            $product = Product::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'category_id' => $category?->id,
                'type' => 'product',
                'item_type' => $itemType,
                'name' => $item,
                'description' => "{$item} — {$tenant->business_name}, Lahore.",
                'sku' => strtoupper(Str::slug($tenant->slug, '')).'-'.str_pad((string) ($i + 1), 3, '0', STR_PAD_LEFT),
                'unit' => $unit,
                'price' => $price,
                'cost' => round($price * 0.72, 2),
                'discount_price' => $discount,
                // Food is made to order and holds no stock; everything else does,
                // or "in stock" is a claim with nothing behind it.
                'track_inventory' => $type !== 'food',
                'stock_quantity' => $type === 'food' ? 0 : 40 + ($i * 3) % 60,
                'low_stock_threshold' => $type === 'food' ? null : 10,
                'is_active' => true,
                'visible_in_marketplace' => true,
            ]);

            // One picture each. A marketplace where the shops have covers and
            // the goods do not is half a demo — the aisle, search and the
            // basket all draw the product, not the shop.
            $product->images()->create([
                'tenant_id' => $tenant->id,
                'path' => $this->makeProductImage($product->id, $item, $this->ground($type)),
                'sort_order' => 0,
            ]);
            $n++;
        }

        return $n;
    }

    /**
     * What each kind of shop sells, in rupees.
     *
     * Real names and believable prices on purpose. A catalog of "Product 1 …
     * Product 12" tests that a list renders; it does not show anybody whether
     * the app is worth using, which is the only question a demo world answers.
     *
     * @return list<array{0: string, 1: float, 2: string}>
     */
    private function itemsFor(string $category): array
    {
        return match ($category) {
            'supermarket', 'kiryana', 'mart' => [
                ['Dalda Cooking Oil 5L', 2450, 'Bottle'],
                ['Sunridge Chakki Atta 10kg', 1350, 'Bag'],
                ['Basmati Rice Super Kernel 5kg', 2200, 'Bag'],
                ['Tapal Danedar Tea 950g', 1890, 'Pack'],
                ['Nestlé Milkpak 1L', 290, 'Pack'],
                ['Olpers Cream 200ml', 180, 'Pack'],
                ['Shan Biryani Masala 50g', 120, 'Pack'],
                ['National Red Chilli Powder 200g', 310, 'Pack'],
                ['Sugar 1kg', 165, 'KG'],
                ['Lifebuoy Soap 3-pack', 345, 'Pack'],
                ['Surf Excel 1kg', 720, 'Pack'],
                ['Coca-Cola 1.5L', 220, 'Bottle'],
                ['Lays Masala 40g', 60, 'Pack'],
                ['Eggs — Dozen', 340, 'Dozen'],
            ],
            'restaurant' => [
                ['Chicken Karahi (Full)', 1950, 'Plate'],
                ['Mutton Karahi (Full)', 3200, 'Plate'],
                ['Chicken Handi (Half)', 1150, 'Plate'],
                ['Beef Nihari', 650, 'Bowl'],
                ['Chicken Biryani', 480, 'Plate'],
                ['Mutton Pulao', 720, 'Plate'],
                ['Seekh Kebab (6 pcs)', 690, 'Plate'],
                ['Chicken Tikka (1 pc)', 420, 'Piece'],
                ['Dal Makhani', 450, 'Bowl'],
                ['Garlic Naan', 90, 'Piece'],
                ['Roghni Naan', 80, 'Piece'],
                ['Kheer', 250, 'Bowl'],
                ['Fresh Lime Soda', 180, 'Glass'],
                ['Kashmiri Chai', 220, 'Cup'],
            ],
            'bakery' => [
                ['Chocolate Fudge Cake 1lb', 1450, 'Piece'],
                ['Black Forest Pastry', 320, 'Piece'],
                ['Chicken Patties', 180, 'Piece'],
                ['Beef Roll', 220, 'Piece'],
                ['Plain Bread Large', 180, 'Piece'],
                ['Bran Bread', 220, 'Piece'],
                ['Chicken Sandwich', 380, 'Piece'],
                ['Cream Roll', 140, 'Piece'],
                ['Doughnut — Chocolate', 160, 'Piece'],
                ['Biscuit Box — Assorted', 950, 'Box'],
                ['Rusk 350g', 260, 'Pack'],
                ['Birthday Cake 2lb', 2800, 'Piece'],
            ],
            'pharmacy' => [
                ['Panadol 500mg (Strip of 10)', 60, 'Strip'],
                ['Brufen 400mg (Strip of 10)', 95, 'Strip'],
                ['Augmentin 625mg (Strip of 6)', 640, 'Strip'],
                ['Disprin (Strip of 10)', 40, 'Strip'],
                ['Risek 20mg (Strip of 14)', 420, 'Strip'],
                ['Calpol Syrup 120ml', 185, 'Bottle'],
                ['ORS Sachet', 35, 'Sachet'],
                ['Dettol Antiseptic 250ml', 480, 'Bottle'],
                ['Surgical Face Mask (Box of 50)', 550, 'Box'],
                ['Digital Thermometer', 850, 'Piece'],
                ['Blood Pressure Monitor', 6500, 'Piece'],
                ['Vitamin C 1000mg (20 tabs)', 720, 'Pack'],
            ],
            'electronics' => [
                ['Haier LED 43" Smart TV', 68000, 'Piece'],
                ['Dawlance Microwave 20L', 34500, 'Piece'],
                ['Philips Steam Iron', 7800, 'Piece'],
                ['Anker PowerBank 20000mAh', 9500, 'Piece'],
                ['JBL Go 3 Speaker', 11500, 'Piece'],
                ['Logitech Wireless Mouse', 3200, 'Piece'],
                ['USB-C Fast Charger 30W', 2400, 'Piece'],
                ['Extension Board 6-Way', 1450, 'Piece'],
                ['LED Bulb 12W (Pack of 4)', 1180, 'Pack'],
                ['Ceiling Fan 56"', 14500, 'Piece'],
                ['Room Cooler', 28500, 'Piece'],
                ['Water Dispenser', 32000, 'Piece'],
            ],
            'garments' => [
                ['Gul Ahmed Lawn 3-Piece', 6500, 'Set'],
                ['Khaadi Unstitched 2-Piece', 4800, 'Set'],
                ['Men’s Cotton Kurta', 2900, 'Piece'],
                ['Shalwar Kameez — Wash & Wear', 4200, 'Set'],
                ['Ladies Shawl — Pashmina', 3500, 'Piece'],
                ['Men’s Dress Shirt', 2600, 'Piece'],
                ['Kids Frock — Cotton', 1800, 'Piece'],
                ['Bed Sheet Set — Double', 5400, 'Set'],
                ['Towel — Large', 900, 'Piece'],
                ['Socks (Pack of 3)', 650, 'Pack'],
                ['Dupatta — Chiffon', 1400, 'Piece'],
                ['Waistcoat — Formal', 5200, 'Piece'],
            ],
            'hardware' => [
                ['Master Paint Emulsion 1 Gallon', 4200, 'Piece'],
                ['Brighto Enamel 1L', 1650, 'Bottle'],
                ['Paint Brush 3"', 380, 'Piece'],
                ['PVC Pipe 1" × 20ft', 950, 'Piece'],
                ['Tap — Brass', 1750, 'Piece'],
                ['Hammer 1kg', 890, 'Piece'],
                ['Screwdriver Set (6 pcs)', 1250, 'Set'],
                ['Measuring Tape 5m', 540, 'Piece'],
                ['Cement — Bag 50kg', 1320, 'Bag'],
                ['Nails 2" — 1kg', 380, 'KG'],
                ['Padlock — Heavy', 1100, 'Piece'],
                ['Electric Drill 500W', 8900, 'Piece'],
            ],
            'auto_parts', 'automotive' => [
                ['Engine Oil 20W-50 4L', 4800, 'Piece'],
                ['Oil Filter — Suzuki Mehran', 650, 'Piece'],
                ['Air Filter — Corolla', 1450, 'Piece'],
                ['Battery 12V 65Ah', 18500, 'Piece'],
                ['Tyre 165/65 R14', 11500, 'Piece'],
                ['Wiper Blade Pair', 1800, 'Pair'],
                ['Brake Pads — Front Set', 4200, 'Set'],
                ['Spark Plug (Set of 4)', 2400, 'Set'],
                ['Car Shampoo 500ml', 780, 'Bottle'],
                ['Microfibre Cloth (Pack of 3)', 950, 'Pack'],
                ['Dashboard Polish', 1100, 'Bottle'],
                ['Tyre Inflator 12V', 5600, 'Piece'],
            ],
            default => [
                ['Assorted Item A', 500, 'Piece'],
                ['Assorted Item B', 900, 'Piece'],
                ['Assorted Item C', 1400, 'Piece'],
            ],
        };
    }
}
