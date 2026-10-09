<?php

namespace App\Console\Commands;

use App\Console\Commands\DemoShops\CafeMenu;
use App\Console\Commands\DemoShops\MartShelves;
use App\Console\Commands\DemoShops\TradeLists;
use App\Enums\TenantStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\City;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * THE SHOPS YOU HAND TO SOMEBODY.
 *
 * ── What this is for ────────────────────────────────────────────────────
 *
 * "Here is a login — have a look." The person on the other end opens a
 * restaurant and expects a menu they could order from, a floor with people
 * sitting at it, a kitchen with dockets on the pass and a month of takings. A
 * shop with five sample products proves the screens render and sells nothing.
 *
 * So each of these is built the way `loadtest:shops` builds its shops — through
 * the same actions the product itself runs: every sale is rung, every tab is
 * opened, fired and settled, every delivery is booked in. That command exists
 * to be big; this one exists to be BELIEVABLE. It borrows the whole of that
 * builder and changes two things: what the goods are called, and who the people
 * are. A catalogue line reads "Chicken Karahi (Half)" here, not
 * "Chicken Karahi Half #1".
 *
 * ── One per trade ───────────────────────────────────────────────────────
 *
 *     shop1@johartown.demo   Johar Café & Grill      food        600+ dishes
 *     shop2@johartown.demo   Johar Fresh Mart        mart        500+ lines
 *     shop3@johartown.demo   CarePlus Pharmacy       pharmacy
 *     shop4@johartown.demo   Zari Clothing           retail      sizes & colours
 *     shop5@johartown.demo   FixIt Service Centre    services
 *     shop6@johartown.demo   Johar Auto Care         automotive
 *     shop7@johartown.demo   Canal Road Fuels        petroleum
 *     shop8@johartown.demo   GadgetHub               online
 *     shop9@johartown.demo   Malik & Co. Accounts    finance
 *
 * Every owner's password is `password`. They are demo logins and are meant to
 * be passed around; nothing real should ever be kept in one of these shops.
 *
 * ── Safe to run on a real server ────────────────────────────────────────
 *
 *  · It writes only its own shops (slug `jtdemo-…`) and removes only those.
 *    `--fresh` rebuilds them; without it a shop that is already there is left
 *    exactly as somebody last saw it.
 *  · It needs no development package. The load test makes its rows with
 *    factories, and a factory needs Faker, which `composer install --no-dev`
 *    does not install — so every row here is made by hand.
 *  · It does not touch a platform setting. The load test switches commission
 *    on so the billing path can be exercised; that is not this command's to
 *    decide on somebody's live platform.
 *  · The shops are NOT on the public marketplace unless `--listed` is passed.
 *    Their order history is real and visible to the owner, but a stranger
 *    cannot find one and order dinner from a restaurant that does not exist.
 */
class SeedDemoShops extends SeedLoadTestShops
{
    protected $signature = 'demo:shops
        {--fresh : remove these demo shops first, then build them again}
        {--only= : one shop — shop1 … shop9, or its trade (food, mart, pharmacy, retail, services, automotive, petroleum, online, finance)}
        {--sales=240 : sales rung into each shop, spread over the last 90 days}
        {--listed : leave the shops open on the public marketplace}';

    protected $description = 'Build the demo shops that can be shown to somebody: one per trade, a believable catalogue, three months of trading';

    private const SLUGS = 'jtdemo-';

    /** Where the owners' logins live. The address the logins were asked for. */
    private const LOGINS = 'johartown.demo';

    /**
     * `colour` is the shop's own brand colour — each demo opens in a different
     * one, so two of them side by side do not read as the same shop.
     *
     * @var array<string, array<string, mixed>>
     */
    private const SHOPS = [
        'cafe' => [
            'n' => 1, 'name' => 'Johar Café & Grill', 'type' => 'food', 'category' => 'restaurant', 'owner' => 'Ahmed Raza',
            'colour' => '#B45309', 'address' => '24-B, Main Boulevard, Johar Town, Lahore', 'at' => [31.4697, 74.2728],
            'plan' => 'premium', 'branches' => ['Main — Johar Town', 'Emporium Mall'],
            'sizes' => 0, 'batches' => false, 'dining' => true, 'online' => true,
        ],
        'mart' => [
            'n' => 2, 'name' => 'Johar Fresh Mart', 'type' => 'mart', 'category' => 'supermarket', 'owner' => 'Bilal Chaudhry',
            'colour' => '#15803D', 'address' => '112-G1, Canal Road, Johar Town, Lahore', 'at' => [31.4731, 74.2795],
            'plan' => 'enterprise', 'branches' => ['Main — Johar Town', 'Wapda Town'],
            'sizes' => 0, 'batches' => false, 'dining' => false, 'online' => true, 'bank_offers' => true,
        ],
        'pharmacy' => [
            'n' => 3, 'name' => 'CarePlus Pharmacy', 'type' => 'pharmacy', 'category' => 'medical_store', 'owner' => 'Dr. Sana Malik',
            'colour' => '#0E7490', 'address' => '7-R2, Shaukat Khanum Road, Johar Town, Lahore', 'at' => [31.4652, 74.2701],
            'plan' => 'premium', 'branches' => ['Main — Johar Town', 'Model Town'],
            'sizes' => 0, 'batches' => true, 'dining' => false, 'online' => true,
        ],
        'clothing' => [
            'n' => 4, 'name' => 'Zari Clothing', 'type' => 'retail', 'category' => 'garments', 'owner' => 'Ayesha Sheikh',
            'colour' => '#9D174D', 'address' => 'Shop 18, Emporium Mall, Johar Town, Lahore', 'at' => [31.4675, 74.2660],
            'plan' => 'premium', 'branches' => ['Main — Emporium Mall', 'Packages Mall'],
            'sizes' => 4, 'batches' => false, 'dining' => false, 'online' => true,
        ],
        'services' => [
            'n' => 5, 'name' => 'FixIt Service Centre', 'type' => 'services', 'category' => 'mobile_repair', 'owner' => 'Usman Qureshi',
            'colour' => '#4338CA', 'address' => '45-H3, Khayaban-e-Firdousi, Johar Town, Lahore', 'at' => [31.4712, 74.2689],
            'plan' => 'basic', 'branches' => ['Main — Johar Town'],
            'sizes' => 0, 'batches' => false, 'dining' => false,
        ],
        'workshop' => [
            'n' => 6, 'name' => 'Johar Auto Care', 'type' => 'automotive', 'category' => 'auto_parts', 'owner' => 'Hamza Butt',
            'colour' => '#B91C1C', 'address' => '9-E, Maulana Shaukat Ali Road, Johar Town, Lahore', 'at' => [31.4620, 74.2760],
            'plan' => 'premium', 'branches' => ['Main — Johar Town'],
            'sizes' => 0, 'batches' => false, 'dining' => false,
        ],
        'fuels' => [
            'n' => 7, 'name' => 'Canal Road Fuels', 'type' => 'petroleum', 'category' => 'filling_station', 'owner' => 'Imran Khokhar',
            'colour' => '#A16207', 'address' => 'Canal Bank Road, near Doctors Hospital, Johar Town, Lahore', 'at' => [31.4780, 74.2832],
            'plan' => 'premium', 'branches' => ['Main — Canal Road', 'Raiwind Road'],
            'sizes' => 0, 'batches' => false, 'dining' => false,
        ],
        'gadgets' => [
            'n' => 8, 'name' => 'GadgetHub', 'type' => 'online', 'category' => 'electronics_online', 'owner' => 'Zainab Awan',
            'colour' => '#6D28D9', 'address' => 'Office 4, Arfa Software Technology Park, Lahore', 'at' => [31.4760, 74.3430],
            'plan' => 'basic', 'branches' => ['Main — Warehouse'],
            'sizes' => 0, 'batches' => false, 'dining' => false, 'online' => true,
        ],
        'accounts' => [
            'n' => 9, 'name' => 'Malik & Co. Accounts', 'type' => 'finance', 'category' => null, 'owner' => 'Nida Malik',
            'colour' => '#0F766E', 'address' => 'Office 12, Siddiq Trade Centre, Gulberg, Lahore', 'at' => [31.5360, 74.3440],
            'plan' => 'basic', 'extra_staff' => 7, 'hrm' => true, 'branches' => ['Main — Office'],
            'sizes' => 0, 'batches' => false, 'dining' => false,
        ],
    ];

    /** People, so a staff list and an order book read as people. */
    private const STAFF = ['Kashif Mehmood', 'Rabia Aslam', 'Tariq Javed', 'Sadia Iqbal', 'Faisal Nadeem', 'Maryam Yousaf', 'Asad Rauf', 'Hira Saleem'];

    private const SHOPPERS = [
        'Ali Hassan', 'Fatima Noor', 'Omar Farooq', 'Mahnoor Tariq', 'Saad Rehman', 'Iqra Javed', 'Danish Ali', 'Amna Shah', 'Hassan Mir', 'Laiba Aziz',
        'Shahzaib Khan', 'Anum Riaz', 'Waleed Ahmed', 'Kinza Baig', 'Junaid Akram', 'Sehrish Gul', 'Talha Mahmood', 'Hafsa Naeem', 'Rizwan Haider', 'Mehwish Zafar',
        'Arsalan Siddiqui', 'Noor ul Ain', 'Zeeshan Anwar', 'Sidra Kamal', 'Adnan Rasheed', 'Tooba Farhan', 'Furqan Latif', 'Aleena Waseem', 'Noman Ashraf', 'Bushra Sami',
        'Haris Jamil', 'Zoya Imtiaz', 'Shoaib Akhtar', 'Rimsha Hanif', 'Usama Ghani', 'Eman Shafiq', 'Kamran Sabir', 'Areej Fawad', 'Moiz Abbas', 'Dua Rafiq',
    ];

    /** The shop being built right now: its key, its row above, and its goods. */
    private string $key = '';

    /** @var array<int, array<string, mixed>> */
    private array $goods = [];

    /** @var array<string, int> shelf name → its place in the shop's categories */
    private array $shelves = [];

    private int $phones = 0;

    private ?string $password = null;

    public function handle(): int
    {
        $started = microtime(true);

        // See the load test's own note: a fixture builder that keeps a query
        // log runs out of memory half-way through its fourth shop.
        DB::connection()->disableQueryLog();
        if ((int) ini_get('memory_limit') > 0) {
            ini_set('memory_limit', '1024M');
        }

        $wanted = $this->wanted();
        if ($wanted === []) {
            $this->error('No such shop: '.$this->option('only').'. Use shop1 … shop9, or a trade: '.implode(', ', array_unique(array_column(self::SHOPS, 'type'))).'.');

            return self::FAILURE;
        }

        if ($this->option('fresh')) {
            $this->remove(array_keys($wanted));
        }

        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);
        $built = [];

        foreach ($wanted as $key => $shop) {
            if (Tenant::withTrashed()->where('slug', self::SLUGS.$key)->exists()) {
                $this->newLine();
                $this->line("── {$shop['name']} is already there — left as it is. Pass --fresh to build it again.");
                $built[$key] = false;

                continue;
            }

            $this->key = $key;
            $this->goods = $this->goodsOf($key);
            $this->shelves = array_flip(array_values(array_unique(array_column($this->goods, 'category'))));

            $tenant = $this->shop($key, $shop['name'], $shop['type'], $city, $shop + ['lines' => count($this->goods)]);
            $this->handOver($tenant, $shop);
            $built[$key] = true;
        }

        $this->newLine();
        $this->info(sprintf('Done in %.1fs', microtime(true) - $started));
        $this->newLine();
        $this->table(['Sign in as', 'Password', 'Shop', 'Trade', ''], array_map(
            fn (string $key) => [
                $this->ownerLogin($key), 'password', self::SHOPS[$key]['name'], self::SHOPS[$key]['type'],
                $built[$key] ? 'built' : 'was already there',
            ],
            array_keys($wanted),
        ));
        $this->line($this->option('listed')
            ? 'The shops are OPEN on the public marketplace.'
            : 'The shops are not on the public marketplace. Pass --listed to leave them open there.');

        return self::SUCCESS;
    }

    /** @return array<string, array<string, mixed>> the shops asked for, in order */
    private function wanted(): array
    {
        $only = strtolower(trim((string) $this->option('only')));
        if ($only === '') {
            return self::SHOPS;
        }

        return array_filter(
            self::SHOPS,
            fn (array $shop, string $key) => in_array($only, [$key, 'shop'.$shop['n'], $shop['type']], true),
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function goodsOf(string $key): array
    {
        return match ($key) {
            'cafe' => $this->menu(),
            'mart' => MartShelves::lines(),
            'pharmacy' => TradeLists::pharmacy(),
            'clothing' => TradeLists::clothing(),
            'services' => TradeLists::repairCentre(),
            'workshop' => TradeLists::workshop(),
            'fuels' => TradeLists::forecourtShop(),
            'gadgets' => TradeLists::gadgetStore(),
            default => [],
        };
    }

    /** @return array<int, array<string, mixed>> */
    private function menu(): array
    {
        $out = [];
        foreach (CafeMenu::sections() as $section => $dishes) {
            foreach ($dishes as $dish => $price) {
                $out[] = ['category' => $section, 'name' => $dish, 'price' => $price, 'brand' => null, 'by_weight' => false];
            }
        }

        return $out;
    }

    // ── Who they are ──────────────────────────────────────────────────

    protected function slugPrefix(): string
    {
        return self::SLUGS;
    }

    protected function tenantEmail(string $key): string
    {
        // Not the logins' domain. Another seeder owns tenants at that address
        // and removes them by it; these shops are not that seeder's to remove.
        return "{$key}@demo.trueserve.app";
    }

    protected function ownerLogin(string $key): string
    {
        return 'shop'.self::SHOPS[$key]['n'].'@'.self::LOGINS;
    }

    protected function ownerName(string $shop): string
    {
        return self::SHOPS[$this->key]['owner'];
    }

    protected function staffLogin(Tenant $tenant, string $job): string
    {
        return 'shop'.self::SHOPS[$this->key]['n'].'.'.str_replace('_', '', $job).'@'.self::LOGINS;
    }

    protected function staffName(string $job, int $i): string
    {
        return self::STAFF[($i + self::SHOPS[$this->key]['n']) % count(self::STAFF)];
    }

    protected function shopperName(int $n, Tenant $tenant): string
    {
        return self::SHOPPERS[($n - 1) % count(self::SHOPPERS)];
    }

    /**
     * By hand, and with everything the factory would have supplied.
     *
     * @param  array<string, mixed>  $attributes
     */
    protected function newTenant(array $attributes): Tenant
    {
        $shop = self::SHOPS[$this->key];

        $tenant = new Tenant;
        $tenant->forceFill($attributes + [
            'phone' => $this->phone(),
            'business_category' => $shop['category'],
            'status' => TenantStatus::Active,
            'online_shop_enabled' => false,
            'address' => $shop['address'],
            'latitude' => $shop['at'][0],
            'longitude' => $shop['at'][1],
        ])->save();

        return $tenant;
    }

    /**
     * @param  'owner'|'staff'|'shopper'  $as
     * @param  array<string, mixed>  $attributes
     * @param  string[]  $permissions
     */
    protected function newUser(string $as, ?Tenant $tenant, array $attributes, array $permissions = []): User
    {
        $user = new User;
        $user->forceFill([
            // Everybody here signs in with the same word, hashed ONCE for the
            // whole run. The cast hashes whatever it is handed, a real server
            // hashes slowly on purpose, and nine shops make four hundred
            // people — a minute and a half of one CPU working out one hash.
            'password' => $this->password ??= Hash::make('password'),
        ] + $attributes + [
            'phone' => $this->phone(),
            'email_verified_at' => now(),
            'status' => UserStatus::Active,
            'remember_token' => Str::random(10),
            'role' => match ($as) {
                'owner' => UserRole::ShopOwner,
                'staff' => UserRole::Staff,
                default => UserRole::Customer,
            },
            'tenant_id' => $as === 'shopper' ? null : $tenant?->id,
        ] + ($as === 'staff' ? ['permissions' => $permissions] : []))->save();

        return $user;
    }

    /** A number nobody has: this command's own block, counted up. */
    private function phone(): string
    {
        $shop = self::SHOPS[$this->key]['n'];

        return '+92399'.$shop.str_pad((string) (++$this->phones), 6, '0', STR_PAD_LEFT);
    }

    // ── What they sell ────────────────────────────────────────────────

    protected function categoryNames(Tenant $tenant, string $type): array
    {
        // A books-only office has no shelf; whatever the builder gives a shop
        // with nothing to sell is as good as anything.
        return $this->shelves === [] ? parent::categoryNames($tenant, $type) : array_keys($this->shelves);
    }

    protected function shelfLine(Tenant $tenant, string $type, int $i, array $words): array
    {
        $line = $this->goods[$i];

        return [
            'name' => $line['name'],
            'brand' => $line['brand'] ?? null,
            'generic' => $line['generic'] ?? null,
            'category' => $this->shelves[$line['category']],
            'price' => $line['price'],
            'by_weight' => (bool) ($line['by_weight'] ?? false),
        ];
    }

    /**
     * One, usually, where a single thing costs thousands.
     *
     * Three phones and two smart watches in one basket is a sale of half a
     * million rupees, and a month of those is a turnover no shop on this
     * street has — the first number a visitor looks at, and the wrong one.
     */
    protected function howMany(string $type): int
    {
        return in_array($this->key, ['clothing', 'gadgets', 'workshop', 'services'], true)
            ? (random_int(1, 5) === 1 ? 2 : 1)
            : random_int(1, 3);
    }

    /** Every dish is asked; the menu says which ones come with a choice. */
    protected function dishesWithChoices(Tenant $tenant, array $dishes): array
    {
        return $dishes;
    }

    protected function modifierFor(Tenant $tenant, int $i, array $dish): ?array
    {
        return isset($this->goods[$i]) ? CafeMenu::choiceFor($this->goods[$i]['category']) : null;
    }

    /**
     * The things that make it somebody's shop: its colour, and — in a kitchen —
     * which station cooks what.
     */
    protected function furnish(Tenant $tenant, string $type, User $owner, array $branches): void
    {
        $shop = self::SHOPS[$this->key];
        $settings = ['theme_primary' => $shop['colour']];

        if ($this->key === 'cafe') {
            $stations = array_values(array_unique(CafeMenu::STATIONS));
            $settings['kitchen_stations'] = $stations;

            $sections = DB::table('categories')->where('tenant_id', $tenant->id)->pluck('id', 'name');
            foreach (CafeMenu::STATIONS as $section => $station) {
                if (isset($sections[$section])) {
                    DB::table('products')
                        ->where('tenant_id', $tenant->id)
                        ->where('category_id', $sections[$section])
                        ->update(['kitchen_station' => $station]);
                }
            }
            $this->line('  stations   '.implode(', ', $stations));
        }

        $tenant->forceFill(['settings' => array_merge($tenant->settings ?? [], $settings)])->save();
    }

    // ── Afterwards ────────────────────────────────────────────────────

    /** What the shop is allowed, said to match what it was given — and whether it is listed. */
    private function handOver(Tenant $tenant, array $shop): void
    {
        $tenant->refresh();
        $tenant->assignLimits([
            'branches' => max(1, count($shop['branches'])),
            'staff' => max(8, (int) ($shop['extra_staff'] ?? 0) + 8),
            'registers' => 2 * count($shop['branches']),
        ]);

        if (! $this->option('listed') && $tenant->online_shop_enabled) {
            $tenant->forceFill(['online_shop_enabled' => false])->save();
        }
    }

    /**
     * Remove these shops, and only these.
     *
     * @param  string[]  $keys
     */
    private function remove(array $keys): void
    {
        // Nobody is signed in while a shop is taken away. Building one leaves
        // its owner as the acting user, and a removal recorded as that owner's
        // doing names somebody the removal itself is about to delete.
        auth()->forgetGuards();

        foreach ($keys as $key) {
            $tenant = Tenant::withTrashed()->where('slug', self::SLUGS.$key)->first();
            if ($tenant === null) {
                continue;
            }

            $this->line("  removing {$tenant->business_name}");

            // The same order the load test removes in, for the same reason: a
            // supplier with orders against it cannot be deleted, and the
            // cascade from `tenants` stops dead on it.
            foreach (['supplier_payments', 'purchase_order_items', 'purchase_orders', 'suppliers'] as $table) {
                DB::table($table)->where('tenant_id', $tenant->id)->delete();
            }

            $shoppers = Str::slug($tenant->slug).'-shopper%@example.test';
            $tenant->forceDelete();

            // The people who ordered from it have no shop of their own — they
            // are the platform's customers, and nothing else removes them.
            User::withTrashed()->where('email', 'like', $shoppers)->get()->each->forceDelete();
            User::withTrashed()->where('email', 'like', 'shop'.self::SHOPS[$key]['n'].'%@'.self::LOGINS)->get()->each->forceDelete();
        }
    }
}
