<?php

namespace App\Console\Commands;

use App\Actions\Sale\CreateSaleAction;
use App\Models\Branch;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BranchContext;
use App\Support\Modules;
use App\Support\StaffPresets;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * THREE REAL SHOPS, AT THE SIZE REAL SHOPS ARE.
 *
 * The demo world is fifty products and a handful of sales. It proves the
 * screens render; it proves nothing about the day a shop actually has. A
 * cash-and-carry carries six thousand lines, a clothing brand carries every
 * size of every design, and a pharmacy carries five thousand medicines each
 * with its own batches and expiry dates.
 *
 * Almost every defect this product has shipped was invisible at fifty rows and
 * obvious at five thousand: a picker that only ever showed page one, a list
 * with no pager, a report that summed the wrong column, a search that scanned
 * instead of using its index. This command builds the volumes those bugs need
 * in order to show themselves.
 *
 * It is DESTRUCTIVE ONLY TO ITS OWN TENANTS. Every shop it makes carries a
 * slug prefixed `loadtest-`, and a re-run deletes exactly those and no others —
 * the demo world beside them is never touched.
 */
class SeedLoadTestShops extends Command
{
    protected $signature = 'loadtest:shops
        {--products=6000 : catalogue lines for the grocery (the others scale from it)}
        {--sales=600 : sales per shop, spread over the last 90 days}
        {--fresh : delete the loadtest shops first}';

    protected $description = 'Build grocery, clothing and pharmacy shops at real volume, with branches, staff and sales';

    private const PREFIX = 'loadtest-';

    public function handle(): int
    {
        $started = microtime(true);

        if ($this->option('fresh')) {
            $gone = Tenant::query()->where('slug', 'like', self::PREFIX.'%')->get();
            foreach ($gone as $t) {
                $this->line("  removing {$t->business_name}");
                $t->forceDelete();
            }
        }

        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);
        $lines = max(200, (int) $this->option('products'));

        $this->shop('grocery', 'Al-Madina Cash & Carry', 'mart', $city, [
            'branches' => ['Main — Ferozepur Road', 'Johar Town', 'Model Town'],
            'lines' => $lines,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('clothing', 'Zahra Couture', 'retail', $city, [
            'branches' => ['Main — Liberty', 'Packages Mall'],
            // Fewer designs, but every design in four sizes — the row count
            // that matters here is variants, not products.
            'lines' => (int) round($lines * 0.4),
            'sizes' => 4,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('restaurant', 'Karahi House', 'food', $city, [
            'branches' => ['Main — MM Alam Road', 'Bahria Town'],
            // A MENU IS NOT A CATALOGUE. Six thousand dishes is not a
            // restaurant, it is a warehouse — the volume that matters here is
            // tables, tickets and modifier combinations, not lines.
            'lines' => 420,
            'sizes' => 0,
            'batches' => false,
            'dining' => true,
        ]);

        $this->shop('pharmacy', 'Shifa Pharmacy', 'pharmacy', $city, [
            'branches' => ['Main — Jail Road', 'DHA Phase 4'],
            'lines' => (int) round($lines * 0.8),
            'sizes' => 0,
            'batches' => true,
            'dining' => false,
        ]);

        $this->shop('services', 'Gulberg Service Centre', 'services', $city, [
            'branches' => ['Main — Gulberg', 'Township'],
            // A service list is short. What a service business carries volume
            // in is JOBS and QUOTES, not lines on a price list.
            'lines' => 120,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('wholesale', 'Akbari Mandi Traders', 'wholesale', $city, [
            'branches' => ['Main — Akbari Mandi', 'Sabzi Mandi'],
            'lines' => (int) round($lines * 0.5),
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->newLine();
        $this->info(sprintf('Done in %.1fs', microtime(true) - $started));
        $this->line('Owners sign in with  <slug>@loadtest.test  /  password');

        return self::SUCCESS;
    }

    /** @param array{branches: string[], lines: int, sizes: int, batches: bool} $spec */
    private function shop(string $key, string $name, string $type, City $city, array $spec): void
    {
        $this->newLine();
        $this->info("── {$name} ({$type})");

        $tenant = Tenant::factory()->create([
            'business_name' => $name,
            'slug' => self::PREFIX.$key,
            'email' => "{$key}@loadtest.test",
            'business_type' => $type,
            'city_id' => $city->id,
            'setup_completed' => true,
            'timezone' => 'Asia/Karachi',
            'features' => Modules::defaultsFor($type),
        ]);

        app(TenantContext::class)->set($tenant);

        $owner = User::factory()->shopOwner($tenant)->create([
            'name' => "{$name} Owner",
            'email' => "{$key}@loadtest.test",
            'password' => 'password',
        ]);

        $branches = $this->branches($tenant, $city, $spec['branches']);
        $this->staff($tenant, $branches);
        $categories = $this->categories($tenant, $type);
        $productIds = $this->catalogue($tenant, $type, $categories, $spec, $branches);
        if (! empty($spec['dining'])) {
            $this->diningRoom($tenant, $branches, $productIds);
        }
        $this->sales($tenant, $type, $owner, $branches, $productIds);

        app(TenantContext::class)->clear();
    }

    /** @param string[] $names @return Branch[] */
    private function branches(Tenant $tenant, City $city, array $names): array
    {
        /**
         * A TENANT ALREADY HAS A MAIN. Provisioning creates it, and creating a
         * second branch marked `is_default` leaves the shop with two — which
         * nothing refuses, and which quietly breaks stock: `InventoryService`
         * resolves the default with `where('is_default', true)->value('id')`
         * and takes whichever row comes back first. Goods then land on a
         * branch nobody is looking at, and the till reports an empty shelf
         * against a full one.
         *
         * So the first name RENAMES the existing Main; only the rest are new.
         */
        $out = [];
        $main = Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_default', true)
            ->first();

        foreach ($names as $i => $label) {
            $code = strtoupper(Str::slug(Str::words($label, 1, ''))) ?: 'B'.($i + 1);

            if ($i === 0 && $main !== null) {
                $main->forceFill(['name' => $label, 'code' => $code, 'city_id' => $city->id])->save();
                $out[] = $main;

                continue;
            }

            $out[] = Branch::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'name' => $label,
                'code' => $code,
                'is_default' => $i === 0,
                'is_active' => true,
                'city_id' => $city->id,
            ]);
        }
        $this->line('  branches   '.count($out));

        return $out;
    }

    /**
     * Staff who hold DIFFERENT permission sets, because that is the thing most
     * likely to be wrong and least likely to be noticed: a screen offered to
     * somebody who cannot use it, or withheld from somebody who needs it.
     *
     * @param  Branch[]  $branches
     */
    private function staff(Tenant $tenant, array $branches): void
    {
        $jobs = ['cashier', 'shift_supervisor', 'stock_keeper', 'buyer', 'accountant', 'manager'];
        $made = 0;

        foreach ($jobs as $i => $code) {
            $permissions = StaffPresets::permissionsFor($code);
            if ($permissions === []) {
                continue;
            }

            User::factory()->tenantStaff($tenant, $permissions)->create([
                'name' => Str::headline($code),
                'email' => $tenant->slug."-{$code}@loadtest.test",
                'password' => 'password',
                // Spread across branches: whoever works at branch two must see
                // branch two's figures and nobody else's.
                'branch_id' => $branches[$i % count($branches)]->id,
            ]);
            $made++;
        }

        $this->line("  staff      {$made} (each on a different permission set)");
    }

    /** @return string[] category ids */
    private function categories(Tenant $tenant, string $type): array
    {
        $names = match ($type) {
            'pharmacy' => ['Antibiotics', 'Painkillers', 'Cardiac', 'Diabetes', 'Vitamins', 'Syrups', 'Injections', 'Baby Care', 'Skin', 'Surgical'],
            'services' => ['Appliance', 'Laundry', 'Tailoring', 'Repairs', 'Cleaning', 'Printing', 'Automotive', 'Electronics', 'Home', 'Callout'],
            'wholesale' => ['Grains', 'Pulses', 'Oils', 'Spices', 'Sugar & Salt', 'Tea', 'Flour', 'Packaging', 'Dry Fruit', 'Misc'],
            'retail' => ['Lawn', 'Chiffon', 'Linen', 'Kurti', 'Shalwar Kameez', 'Abaya', 'Scarves', 'Formals', 'Casuals', 'Bridal'],
            default => ['Rice & Pulses', 'Flour', 'Oil & Ghee', 'Tea & Coffee', 'Spices', 'Dairy', 'Bakery', 'Snacks', 'Beverages', 'Frozen', 'Cleaning', 'Personal Care', 'Paper Goods', 'Baby', 'Pet'],
        };

        $rows = [];
        foreach ($names as $i => $n) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'name' => $n,
                'sort_order' => $i,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('categories')->insert($rows);
        $this->line('  categories '.count($rows));

        return array_column($rows, 'id');
    }

    /**
     * @param  string[]  $categories
     * @param  array{lines: int, sizes: int, batches: bool}  $spec
     * @param  Branch[]  $branches
     * @return array<int, array{product_id: string, variant_id: ?string}> what can actually be sold
     */
    private function catalogue(Tenant $tenant, string $type, array $categories, array $spec, array $branches): array
    {
        $words = match ($type) {
            'services' => [['AC Service', 'Laundry Wash', 'Suit Stitching', 'Shoe Repair', 'Photo Printing', 'Car Wash', 'Mobile Repair', 'Water Filter Service', 'Generator Tune-up', 'Carpet Cleaning'], ['Standard', 'Deep', 'Express', 'On-site', 'Annual', 'Half-day', 'Premium', 'Basic', 'Callout', 'Contract']],
            'wholesale' => [['Sugar', 'Basmati Rice', 'Wheat Flour', 'Cooking Oil', 'Red Chilli', 'Turmeric', 'Lentils', 'Tea Leaves', 'Gram Flour', 'Salt'], ['50kg Bag', '25kg Bag', '10kg Bag', 'Carton', 'Drum', 'Sack', 'Bale', 'Crate', 'Tin', 'Bundle']],
            'food' => [['Chicken Karahi', 'Mutton Karahi', 'Seekh Kebab', 'Chicken Tikka', 'Daal Makhani', 'Biryani', 'Nihari', 'Haleem', 'Malai Boti', 'Chapli Kebab'], ['Half', 'Full', 'Platter', 'Family', 'Special', 'Boneless', 'Degi', 'Peshawari', 'Lahori', 'Handi']],
            'pharmacy' => [['Amoxil', 'Panadol', 'Brufen', 'Augmentin', 'Risek', 'Calpol', 'Flagyl', 'Zantac', 'Ventolin', 'Glucophage'], ['125mg', '250mg', '500mg', '650mg', '1g', 'Syrup', 'Drops', 'Inj', 'Cap', 'Tab']],
            'retail' => [['Gul', 'Noor', 'Zara', 'Meher', 'Aiza', 'Rida', 'Sana', 'Hina', 'Komal', 'Areeba'], ['Printed', 'Embroidered', 'Digital', 'Hand Block', 'Sequin', 'Jacquard', 'Plain', 'Dyed', 'Lace', 'Schiffli']],
            default => [['Sunridge', 'Dalda', 'Tapal', 'Olpers', 'National', 'Shan', 'Nurpur', 'Lipton', 'Rafhan', 'Kolson'], ['1kg', '500g', '250g', '5kg', '1L', '2L', 'Pack', 'Box', 'Jar', 'Pouch']],
        };

        $sellable = [];
        $productRows = [];
        $variantRows = [];
        $stockRows = [];
        $batchRows = [];
        $made = 0;

        for ($i = 0; $i < $spec['lines']; $i++) {
            $id = (string) Str::uuid7();
            $brand = $words[0][$i % 10];
            $spec2 = $words[1][intdiv($i, 10) % 10];
            $price = match ($type) {
                'pharmacy' => random_int(35, 2400),
                'retail' => random_int(1800, 24000),
                default => random_int(60, 4800),
            };
            // A grocery weighs some of what it sells; the others never do.
            $byWeight = $type === 'mart' && $i % 11 === 0;

            $productRows[] = [
                'id' => $id,
                'tenant_id' => $tenant->id,
                'category_id' => $categories[$i % count($categories)],
                'type' => $type === 'services' ? 'service' : 'product',
                'item_type' => match ($type) {
                    'pharmacy' => 'medicine',
                    // A DISH IS MADE TO ORDER. It is not a thing on a shelf,
                    // so it carries no stock of its own — what depletes is the
                    // INGREDIENTS, through the recipe. Seeding the menu as
                    // tracked stock made a kitchen refuse to settle a tab for
                    // food the customer had already eaten.
                    'food' => 'food_item',
                    'services' => 'service',
                    default => 'physical_product',
                },
                'name' => "{$brand} {$spec2} #".($i + 1),
                'sku' => strtoupper(substr($type, 0, 3)).'-'.str_pad((string) ($i + 1), 6, '0', STR_PAD_LEFT),
                // A real barcode, because a grocery's whole day is a scanner.
                'barcode' => (string) (8964000000000 + $i),
                'brand' => $brand,
                'generic_name' => $type === 'pharmacy' ? $brand.' '.$spec2 : null,
                'unit' => $byWeight ? 'kg' : 'pcs',
                'price' => $price,
                'cost' => round($price * 0.78, 2),
                'sold_by' => $byWeight ? 'weight' : 'unit',
                'stock_quantity' => 0,
                'low_stock_threshold' => $i % 5 === 0 ? 40 : 10,
                'track_inventory' => ! in_array($type, ['food', 'services'], true),
                // How long it takes. A service business books its day in
                // minutes, not in units on a shelf.
                'duration_minutes' => $type === 'services' ? [30, 45, 60, 90, 120][$i % 5] : null,
                /**
                 * WHOLESALE SELLS BY THE BREAK. Twenty bags are cheaper per
                 * bag than one, and the price list IS the business — a mandi
                 * trader with a single price is not a wholesaler.
                 */
                'price_tiers' => $type === 'wholesale'
                    ? json_encode([
                        ['min_qty' => 10, 'price' => round($price * 0.95, 2)],
                        ['min_qty' => 50, 'price' => round($price * 0.90, 2)],
                        ['min_qty' => 200, 'price' => round($price * 0.84, 2)],
                    ])
                    : null,
                /**
                 * And some of it will not be sold singly. ONE LINE IN THREE,
                 * not all of them — a mandi trader breaks bulk on plenty of
                 * things, and a price list where nothing can be bought by the
                 * piece is not a wholesaler, it is a locked door.
                 *
                 * Worth knowing: this is enforced at the COUNTER as well as
                 * online. `CreateSaleAction` does it deliberately and says why;
                 * the column's own comment in the catalog migration still says
                 * "enforced on online orders", which is now the smaller claim.
                 */
                'min_order_qty' => $type === 'wholesale' && $i % 3 === 0 ? 5 : null,
                'is_active' => true,
                'visible_in_marketplace' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            if ($spec['sizes'] > 0) {
                foreach (['S', 'M', 'L', 'XL'] as $size) {
                    $vid = (string) Str::uuid7();
                    // A sized product holds NO stock of its own — the sizes do.
                    // Selling one without naming a size is refused, correctly,
                    // so the sellable list carries the size and not the parent.
                    if ($i % 10 !== 0) {
                        $sellable[] = ['product_id' => $id, 'variant_id' => $vid];
                    }
                    $variantRows[] = [
                        'id' => $vid,
                        'tenant_id' => $tenant->id,
                        'product_id' => $id,
                        'name' => $size,
                        'sku' => strtoupper(substr($type, 0, 3)).'-'.str_pad((string) ($i + 1), 6, '0', STR_PAD_LEFT)."-{$size}",
                        'price' => $price,
                        'cost' => round($price * 0.78, 2),
                        'stock_quantity' => 0,
                        'is_active' => true,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                    foreach ($branches as $b) {
                        $stockRows[] = [
                            'id' => (string) Str::uuid7(),
                            'tenant_id' => $tenant->id,
                            'branch_id' => $b->id,
                            'product_id' => $id,
                            'variant_id' => $vid,
                            'quantity' => $i % 10 === 0 ? 0 : random_int(8, 60),
                            'created_at' => now(),
                            'updated_at' => now(),
                        ];
                    }
                }
            } elseif (! in_array($type, ['food', 'services'], true)) {
                foreach ($branches as $b) {
                    $stockRows[] = [
                        'id' => (string) Str::uuid7(),
                        'tenant_id' => $tenant->id,
                        'branch_id' => $b->id,
                        'product_id' => $id,
                        'variant_id' => null,
                        'quantity' => $i % 10 === 0 ? 0 : random_int(25, 400),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }
            }

            if ($spec['batches']) {
                /**
                 * Two lots per medicine, and only about one in twelve carries
                 * a near-expiry one.
                 *
                 * The first version gave EVERY medicine a lot expiring inside
                 * sixty days, which put half the catalogue inside the ninety-day
                 * window and made the expiring list look like a defect: four
                 * thousand rows. That was the data's shape, not the product's. A
                 * pharmacy with half its shelf about to expire is not a pharmacy
                 * anybody is testing against — it is a fire.
                 */
                $soon = $i % 12 === 0;
                foreach ([random_int(200, 600), $soon ? random_int(10, 80) : random_int(150, 500)] as $n => $days) {
                    $batchRows[] = [
                        'id' => (string) Str::uuid7(),
                        'tenant_id' => $tenant->id,
                        // A lot physically sits at ONE branch. Spreading a
                        // batch number across the chain would be a fiction the
                        // expiry and FEFO screens would then report on.
                        'branch_id' => $branches[$n % count($branches)]->id,
                        'product_id' => $id,
                        'batch_number' => 'B'.str_pad((string) ($i + 1), 5, '0', STR_PAD_LEFT).'-'.($n + 1),
                        'expiry_date' => now()->addDays($days)->toDateString(),
                        'quantity' => $i % 7 === 0 ? 0 : random_int(15, 150),
                        'cost' => round($price * 0.78, 2),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }
            }

            if ($spec['sizes'] === 0 && (in_array($type, ['food', 'services'], true) || $i % 10 !== 0)) {
                $sellable[] = ['product_id' => $id, 'variant_id' => null];
            }
            $made++;

            if (count($productRows) >= 500) {
                $this->flush($productRows, $variantRows, $stockRows, $batchRows);
            }
        }

        $this->flush($productRows, $variantRows, $stockRows, $batchRows);

        // The product-level figure is the sum of its branches, which is what
        // every stock screen compares against.
        DB::statement(
            'UPDATE products p SET stock_quantity = COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0) WHERE p.tenant_id = ?',
            [$tenant->id]
        );

        $variants = DB::table('product_variants')->where('tenant_id', $tenant->id)->count();
        $this->line("  products   {$made}".($variants > 0 ? " · {$variants} sizes" : ''));
        $this->line('  stock rows '.DB::table('branch_stock')->where('tenant_id', $tenant->id)->count());
        if ($spec['batches']) {
            $this->line('  batches    '.DB::table('product_batches')->where('tenant_id', $tenant->id)->count());
        }

        return $sellable;
    }

    /**
     * THE ROOM, AND WHAT CAN BE ASKED FOR IN IT.
     *
     * A restaurant's volume is not its menu. It is tables, open tickets and
     * the combinations a modifier group allows — "no onions, extra cheese,
     * medium spicy" is three choices on one line, and the ticket has to carry
     * all three to the kitchen and back onto the bill.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $dishes
     */
    private function diningRoom(Tenant $tenant, array $branches, array $dishes): void
    {
        $tables = [];
        foreach ($branches as $b) {
            foreach (['Hall', 'Terrace', 'Family'] as $area) {
                foreach (range(1, 10) as $n) {
                    $tables[] = [
                        'id' => (string) Str::uuid7(),
                        'tenant_id' => $tenant->id,
                        'branch_id' => $b->id,
                        'name' => substr($area, 0, 1).$n,
                        'area' => $area,
                        'seats' => $area === 'Family' ? 6 : 4,
                        'sort_order' => $n,
                        'is_active' => true,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }
            }
        }
        DB::table('dining_tables')->insert($tables);

        // Modifiers on roughly one dish in four — the ones a kitchen actually
        // asks about. A menu where everything is configurable is a menu nobody
        // can take an order from.
        $groups = [];
        $options = [];
        foreach (array_slice($dishes, 0, max(1, intdiv(count($dishes), 4))) as $i => $dish) {
            $gid = (string) Str::uuid7();
            $groups[] = [
                'id' => $gid,
                'tenant_id' => $tenant->id,
                'product_id' => $dish['product_id'],
                'name' => $i % 2 === 0 ? 'Spice level' : 'Add-ons',
                'type' => $i % 2 === 0 ? 'single' : 'multiple',
                'min_select' => $i % 2 === 0 ? 1 : 0,
                'max_select' => $i % 2 === 0 ? 1 : 3,
                'sort_order' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ];
            $choices = $i % 2 === 0
                ? [['Mild', 0], ['Medium', 0], ['Hot', 0]]
                : [['Extra cheese', 150], ['No onions', 0], ['Raita', 80]];
            foreach ($choices as $n => [$label, $delta]) {
                $options[] = [
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'modifier_group_id' => $gid,
                    'name' => $label,
                    'price_delta' => $delta,
                    'is_default' => $n === 0,
                    'is_active' => true,
                    'sort_order' => $n,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
        }
        foreach (array_chunk($groups, 500) as $c) {
            DB::table('modifier_groups')->insert($c);
        }
        foreach (array_chunk($options, 500) as $c) {
            DB::table('modifier_options')->insert($c);
        }

        $this->line('  tables     '.count($tables).' across '.count($branches).' branches');
        $this->line('  modifiers  '.count($groups).' groups · '.count($options).' options');
    }

    private function flush(array &$products, array &$variants, array &$stock, array &$batches): void
    {
        foreach ([['products', &$products], ['product_variants', &$variants], ['branch_stock', &$stock], ['product_batches', &$batches]] as [$table, $rows]) {
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table($table)->insert($chunk);
            }
            $rows = [];
        }
        $products = [];
        $variants = [];
        $stock = [];
        $batches = [];
    }

    /**
     * Sales go through CreateSaleAction, never straight into the table.
     *
     * Pricing is server-authoritative everywhere else in this product, and a
     * seeder that wrote its own line totals would be generating a world the
     * real code could never have produced — which is how a report gets tested
     * against figures no till would ever ring.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    private function sales(Tenant $tenant, string $type, User $owner, array $branches, array $productIds): void
    {
        $want = max(0, (int) $this->option('sales'));
        if ($want === 0 || $productIds === []) {
            return;
        }

        $action = app(CreateSaleAction::class);
        $done = 0;
        $skipped = 0;
        /** @var array<string, int> $reasons */
        $reasons = [];
        $bar = $this->output->createProgressBar($want);

        for ($i = 0; $i < $want; $i++) {
            $branch = $branches[$i % count($branches)];

            /**
             * THE BRANCH COMES FROM CONTEXT, NOT FROM THE PAYLOAD.
             *
             * `CreateSaleAction` reads `BranchContext` — set by the
             * ResolveBranch middleware on a real request — and ignores any
             * `branch_id` in the data. That is right for HTTP and silent for a
             * console caller: every sale this command made landed with
             * `branch_id` NULL, so the figures were correct in total and
             * invisible to every per-branch report. A three-branch shop that
             * could not be asked what branch two took.
             */
            app(BranchContext::class)->set($branch);
            $items = [];
            foreach (range(1, random_int(1, 5)) as $_) {
                $pick = $productIds[array_rand($productIds)];
                $items[] = array_filter([
                    'product_id' => $pick['product_id'],
                    'variant_id' => $pick['variant_id'],
                    // A wholesale basket is not a shopper's basket. Buying in
                    // ones here would also trip every line that carries a
                    // minimum order quantity.
                    'quantity' => $type === 'wholesale' ? random_int(5, 60) : random_int(1, 3),
                ], fn ($v) => $v !== null);
            }

            try {
                $sale = $action->execute([
                    'branch_id' => $branch->id,
                    'channel' => 'walk_in',
                    'customer_name' => ['Ahmed', 'Fatima', 'Bilal', 'Ayesha', 'Usman'][$i % 5],
                    'items' => $items,
                    'payment_method' => ['cash', 'card', 'wallet', 'bank_transfer'][$i % 4],
                    'amount_paid' => 1_000_000,
                    'created_by' => $owner->id,
                ]);

                // Ninety days of trade, so every report has a shape to draw.
                $sale->forceFill([
                    'sold_at' => now()->subDays(random_int(0, 89))->subHours(random_int(0, 13)),
                ])->save();
                $done++;
            } catch (\Throwable $e) {
                // WHY, not just how many. A silent skip counter hid the fact
                // that every shop stopped at exactly the same number — which
                // is never what running out of stock looks like.
                $skipped++;
                $reason = $e->getMessage();
                $reasons[$reason] = ($reasons[$reason] ?? 0) + 1;
            }
            $bar->advance();
        }

        app(BranchContext::class)->set(null);

        $bar->finish();
        $this->newLine();
        $this->line("  sales      {$done}".($skipped > 0 ? " ({$skipped} refused)" : ''));
        arsort($reasons);
        foreach (array_slice($reasons, 0, 3, true) as $why => $n) {
            $this->line('             × '.$n.'  '.Str::limit($why, 90));
        }
    }
}
