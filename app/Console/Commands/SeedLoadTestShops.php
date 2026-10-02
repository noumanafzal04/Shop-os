<?php

namespace App\Console\Commands;

use App\Actions\Inventory\ApplyStockCountAction;
use App\Actions\Inventory\RecordStockCountAction;
use App\Actions\Inventory\StartStockCountAction;
use App\Actions\Inventory\TransferStockAction;
use App\Actions\Inventory\WriteOffStockAction;
use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Sale;
use App\Models\StockCountItem;
use App\Models\StockDisposal;
use App\Models\Supplier;
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

                /**
                 * ORDER MATTERS ON THE WAY OUT.
                 *
                 * `purchase_orders.supplier_id` is ON DELETE RESTRICT — a
                 * supplier with orders against it cannot be removed, and the
                 * cascade from `tenants` therefore stops dead. Clear the rows
                 * that hold a restricted reference first.
                 *
                 * The app itself never meets this: a shop is SOFT-deleted
                 * there, and only this command force-deletes. Written down so
                 * the next person does not read the failure as a schema bug.
                 */
                foreach (['supplier_payments', 'purchase_order_items', 'purchase_orders', 'suppliers'] as $table) {
                    DB::table($table)->where('tenant_id', $t->id)->delete();
                }

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

        $this->shop('finance', 'Rehman Books & Accounts', 'finance', $city, [
            // THE SHOP WITH NO SHOP. No till, no catalogue, no stock — the
            // expense book IS the product. It is the shape most likely to be
            // broken by a change made for everybody else, and the only one
            // where the cashbook has no sales to lean on.
            'branches' => ['Main — Office'],
            'lines' => 0,
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
            // A shop with the marketplace module is OPEN online. The module
            // says it may list; this flag says it does, and without it the
            // storefront, the order path and the delivery leg are all
            // unreachable — a whole half of the product that no amount of
            // catalogue volume would exercise.
            'online_shop_enabled' => true,
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
        $this->supplyChain($tenant, $type, $owner, $branches);
        // Offers BEFORE sales, or there is nothing for a basket to pick up.
        $this->offers($tenant, $owner, $categories);
        $customers = $this->theCounter($tenant);
        $this->sales($tenant, $type, $owner, $branches, $productIds, $customers);
        $this->khata($tenant, $owner);
        $this->afterTheSale($tenant, $owner, $branches);
        $this->theShelf($tenant, $owner, $branches, $productIds);
        $this->books($tenant, $owner, $branches);

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

        /**
         * RIDERS, for a shop that delivers.
         *
         * A tenant's own rider — the shop's boy on a bike — as opposed to a
         * platform rider, who is a USER who applied. Without one the delivery
         * leg of an online order cannot be walked at all: the order reaches
         * `ready` and there is nobody to hand it to.
         */
        if (($tenant->features['delivery'] ?? false) === true) {
            $riders = [];
            foreach (['Imran', 'Shahid', 'Waqar', 'Naveed'] as $n => $name) {
                $riders[] = [
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'name' => $name,
                    'phone' => '+9230012345'.str_pad((string) $n, 2, '0', STR_PAD_LEFT),
                    'is_active' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            DB::table('riders')->insert($riders);
            $this->line('  riders     '.count($riders));
        }
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

    /**
     * MONEY THAT IS NOT A SALE.
     *
     * Rent, wages, electricity, a delivery bike's petrol — and the other side,
     * a rebate or a scrap sale. Every shop has these and none of them come
     * through the till, so a cashbook tested only against sales is a cashbook
     * tested on half its sources.
     *
     * @param  Branch[]  $branches
     */
    private function books(Tenant $tenant, User $owner, array $branches): void
    {
        if (($tenant->features['expenses'] ?? false) !== true) {
            return;
        }

        $outs = ['Shop rent', 'Electricity bill', 'Staff wages', 'Delivery petrol', 'Packaging', 'Internet', 'Repairs', 'Municipal fee'];
        $ins = ['Scrap sale', 'Supplier rebate', 'Sublet rent'];

        $rows = [];
        foreach (range(0, 59) as $i) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'branch_id' => $branches[$i % count($branches)]->id,
                'description' => $outs[$i % count($outs)],
                'amount' => random_int(1500, 95000),
                'expense_date' => now()->subDays(random_int(0, 89))->toDateString(),
                'payment_method' => ['cash', 'bank_transfer'][$i % 2],
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('expenses')->insert($rows);

        $inRows = [];
        foreach (range(0, 11) as $i) {
            $inRows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'branch_id' => $branches[$i % count($branches)]->id,
                'description' => $ins[$i % count($ins)],
                'amount' => random_int(2000, 40000),
                'income_date' => now()->subDays(random_int(0, 89))->toDateString(),
                'payment_method' => 'cash',
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('incomes')->insert($inRows);

        $this->line('  books      '.count($rows).' expenses · '.count($inRows).' other income');
    }

    /**
     * WHERE THE STOCK CAME FROM, AND WHAT IS STILL OWED FOR IT.
     *
     * Every test so far has sold goods that appeared on the shelf by magic.
     * A real shop's stock arrives on a purchase order, is counted in against
     * a delivery note, and is paid for later — and each of those is money or
     * quantity that can be got wrong.
     *
     * Orders go through the REAL actions, not inserts: receiving blends the
     * moving average cost and writes stock movements, and the supplier balance
     * is the thing the Pay screen once failed to settle at all. A seeder that
     * wrote these rows itself would be testing its own arithmetic.
     *
     * @param  Branch[]  $branches
     */
    private function supplyChain(Tenant $tenant, string $type, User $owner, array $branches): void
    {
        if (($tenant->features['purchasing'] ?? false) !== true) {
            return;
        }

        /**
         * A SIZED PRODUCT HOLDS NO STOCK OF ITS OWN, so a purchase order for
         * the parent is refused — correctly — and a clothing shop would end up
         * with forty suppliers and no deliveries. Buy the SIZE.
         */
        $sellable = DB::table('product_variants')
            ->join('products', 'products.id', '=', 'product_variants.product_id')
            ->where('product_variants.tenant_id', $tenant->id)
            ->whereNull('product_variants.deleted_at')
            ->inRandomOrder()->limit(400)
            ->get([
                'product_variants.product_id as id',
                'product_variants.id as variant_id',
                'product_variants.cost as cost',
                'product_variants.price as price',
            ]);

        if ($sellable->isEmpty()) {
            $sellable = Product::query()
                ->where('tenant_id', $tenant->id)
                ->where('track_inventory', true)
                ->whereDoesntHave('variants')
                ->inRandomOrder()->limit(400)
                ->get(['id', 'cost', 'price'])
                ->map(fn ($p) => (object) ['id' => $p->id, 'variant_id' => null, 'cost' => $p->cost, 'price' => $p->price]);
        }

        if ($sellable->isEmpty()) {
            return;
        }

        $houses = ['Metro', 'Imtiaz', 'Al-Fatah', 'Chase', 'Naheed', 'Greenland', 'Bismillah', 'Madina', 'Faisal', 'Shaheen'];
        $suppliers = [];
        foreach (range(0, 39) as $i) {
            $suppliers[] = Supplier::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'name' => $houses[$i % 10].' '.['Traders', 'Distributors', 'Enterprises', 'Agency'][intdiv($i, 10)],
                'phone' => '+9230099'.str_pad((string) $i, 5, '0', STR_PAD_LEFT),
                'is_active' => true,
            ]);
        }

        app(BranchContext::class)->set($branches[0]);

        $made = ['draft' => 0, 'ordered' => 0, 'received' => 0, 'part' => 0];
        $paid = 0;
        /** @var array<string,int> $why — a silent catch hid the cause twice already. */
        $why = [];

        foreach (range(0, 119) as $i) {
            $supplier = $suppliers[$i % count($suppliers)];
            $lines = $sellable->random(random_int(3, 12))->map(fn ($p) => array_filter([
                'product_id' => $p->id,
                'variant_id' => $p->variant_id,
                'quantity' => random_int(10, 200),
                'unit_cost' => round((float) ($p->cost ?? max(1, (float) $p->price * 0.7)), 2),
            ], fn ($v) => $v !== null))->values()->all();

            try {
                $po = app(CreatePurchaseOrderAction::class)->execute([
                    'supplier_id' => $supplier->id,
                    'order_date' => now()->subDays(random_int(1, 89))->toDateString(),
                    'status' => 'ordered',
                    'items' => $lines,
                ]);
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                continue;
            }

            // A fifth stay open — a shop always has deliveries it is waiting on,
            // and an outstanding-orders screen with nothing in it proves nothing.
            if ($i % 5 === 0) {
                $made['ordered']++;

                continue;
            }

            $po->load('items');
            $map = [];
            foreach ($po->items as $item) {
                $product = $item->product_id !== null ? Product::withoutTenancy()->find($item->product_id) : null;
                // A SHORT DELIVERY IS NORMAL. Every fourth order arrives
                // incomplete; a chain where everything lands in full never
                // exercises `outstanding()` or the partially-received state.
                $want = $i % 4 === 0
                    ? max(1, (int) floor($item->outstanding() * 0.6))
                    : $item->outstanding();
                $map[$item->id] = [
                    'quantity' => $want,
                    'expiry_date' => $product?->requiresExpiry() ? now()->addMonths(random_int(6, 30))->toDateString() : null,
                ];
            }

            try {
                app(ReceivePurchaseOrderAction::class)->execute($po, $map);
                $made[$i % 4 === 0 ? 'part' : 'received']++;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                continue;
            }

            // Paid in full, in part, or not yet — all three are real, and the
            // supplier ledger is only worth testing when it carries a balance.
            $total = (float) $po->fresh()->total;
            $share = [1.0, 0.5, 0.0][$i % 3];
            if ($share > 0.0 && $total > 0) {
                try {
                    app(RecordSupplierPaymentAction::class)->execute($supplier, [
                        'amount' => round($total * $share, 2),
                        'method' => ['cash', 'bank_transfer'][$i % 2],
                        'purchase_order_id' => $po->id,
                    ]);
                    $paid++;
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }
            }
        }

        app(BranchContext::class)->set(null);

        $this->line('  suppliers  '.count($suppliers));
        $this->line('  purchases  '.array_sum($made)." ({$made['received']} received, {$made['part']} short, {$made['ordered']} awaiting) · {$paid} paid");
        arsort($why);
        foreach (array_slice($why, 0, 3, true) as $msg => $n) {
            $this->line('             × '.$n.'  '.Str::limit($msg, 95));
        }
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
    /**
     * THE OTHER SIDE OF THE MONEY LEDGER.
     *
     * The payables bug — a shop shown Rs 45.6M of debt for goods still in a
     * van — was found because suppliers had volume to be wrong about.
     * Customers had none: a load-test shop had three hundred sales and not one
     * named customer, so the khata, the credit limit, the ledger and every
     * "who owes us" figure were measured against nothing at all.
     *
     * Khata is how most of these shops actually trade. It is also the half of
     * the ledger where the shop LOSES money rather than overpays — the same
     * shape of fault, pointed the other way.
     *
     * @return Customer[]
     */
    private function theCounter(Tenant $tenant): array
    {
        if (($tenant->features['customers'] ?? false) !== true) {
            return [];
        }

        $first = ['Ahmed', 'Fatima', 'Bilal', 'Ayesha', 'Usman', 'Sana', 'Hamza', 'Zainab', 'Imran', 'Nida'];
        $last = ['Khan', 'Malik', 'Butt', 'Sheikh', 'Raza', 'Chaudhry', 'Qureshi', 'Awan'];

        $rows = [];
        foreach (range(0, 239) as $i) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'name' => $first[$i % count($first)].' '.$last[intdiv($i, count($first)) % count($last)],
                // A KHATA NEEDS A PHONE. The till finds a customer by phone
                // and by nothing else, so a customer seeded without one is a
                // row no cashier could ever reach — see the Khata Needs A
                // Phone note. Unique per shop, hence the index in the number.
                'phone' => '03'.str_pad((string) (100000000 + $i), 9, '0', STR_PAD_LEFT),
                // Not everybody gets a book. A shop that extends credit to all
                // two hundred and forty of its walk-ins is not a shop.
                'credit_limit' => $i % 3 === 0 ? random_int(5, 60) * 1000 : 0,
                'credit_balance' => 0,
                'loyalty_points' => 0,
                'created_at' => now()->subDays(random_int(0, 180)),
                'updated_at' => now(),
            ];
        }
        DB::table('customers')->insert($rows);

        $onTheBook = Customer::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('credit_limit', '>', 0)->get()->all();

        $this->line('  customers  '.count($rows).' ('.count($onTheBook).' with a khata)');

        return $onTheBook;
    }

    /**
     * PAYING THE BOOK DOWN.
     *
     * A khata that only ever grows is not a khata, and a balance nothing
     * reduces cannot catch the arithmetic fault that matters here: a payment
     * that lands in the ledger and not on the balance, or the other way round.
     * Roughly two in three of the shops' debtors pay something back, in one or
     * two instalments, never more than they owe.
     */
    private function khata(Tenant $tenant, User $owner): void
    {
        $owing = Customer::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('credit_balance', '>', 0)->get();

        if ($owing->isEmpty()) {
            return;
        }

        auth()->setUser($owner);
        $paid = 0;
        $total = 0.0;

        foreach ($owing as $i => $customer) {
            if ($i % 3 === 0) {
                continue; // somebody always has not come in yet
            }

            foreach (range(1, random_int(1, 2)) as $_) {
                $owed = (float) $customer->fresh()->credit_balance;
                if ($owed <= 0) {
                    break;
                }

                // NEVER more than the balance. Overpaying is a real and
                // deliberate act in this product (KHATA_OVERPAYMENT, with an
                // allow_advance flag) and seeding it by accident would make
                // every advance figure look like noise.
                $amount = round(min($owed, $owed * (random_int(20, 100) / 100)), 2);
                if ($amount <= 0) {
                    break;
                }

                $customer->recordCreditPayment($amount, ['cash', 'bank_transfer', 'wallet'][$i % 3]);
                $total += $amount;
                $paid++;
            }
        }

        $this->line(sprintf('  khata      %d payments · %s collected', $paid, number_format($total, 2)));
    }

    /**
     * WHAT CAME BACK.
     *
     * Returns are where refund arithmetic, stock restoration and the khata all
     * meet, and not one load-test shop had a single one. The action is the
     * real one, so each return re-runs the cumulative-allocation rule that
     * stops three partial returns of an 800 line summing to 800.01.
     *
     * @param  Branch[]  $branches
     */
    private function afterTheSale(Tenant $tenant, User $owner, array $branches): void
    {
        $sales = Sale::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('status', 'completed')
            ->with('items')
            ->get();

        if ($sales->isEmpty()) {
            return;
        }

        auth()->setUser($owner);
        $action = app(ProcessSaleReturnAction::class);
        $done = 0;
        $refunded = 0.0;
        /** @var array<string, int> $reasons */
        $reasons = [];

        // Roughly one sale in twelve comes back, in whole or in part. A shop
        // where everything is returned is as unrealistic as one where nothing
        // is, and both hide different faults.
        foreach ($sales as $i => $sale) {
            if ($i % 12 !== 0 || $sale->items->isEmpty()) {
                continue;
            }

            app(BranchContext::class)->set(
                collect($branches)->firstWhere('id', $sale->branch_id) ?? $branches[0],
            );

            $line = $sale->items->random();
            $qty = (float) $line->quantity;
            // Half the returns are PARTIAL — the case the refund rounding rule
            // exists for, and the one a "return the whole sale" fixture never
            // reaches.
            $back = $i % 24 === 0 || $qty <= 1 ? $qty : max(1, floor($qty / 2));

            try {
                $return = $action->execute($sale, [
                    'items' => [['sale_item_id' => $line->id, 'quantity' => $back]],
                    'reason' => ['Damaged', 'Wrong item', 'Changed mind', 'Expired'][$i % 4],
                ]);
                $refunded += (float) $return->refund_total;
                $done++;
            } catch (\Throwable $e) {
                $reasons[$e->getMessage()] = ($reasons[$e->getMessage()] ?? 0) + 1;
            }
        }

        app(BranchContext::class)->set(null);

        $this->line(sprintf('  returns    %d · %s refunded', $done, number_format($refunded, 2)));
        arsort($reasons);
        foreach (array_slice($reasons, 0, 2, true) as $why => $n) {
            $this->line('             × '.$n.'  '.Str::limit($why, 90));
        }
    }

    /**
     * EVERYTHING THAT MOVES STOCK WITHOUT SELLING IT.
     *
     * A count, a transfer between branches, and stock written off. All three
     * modules shipped with screens, and on a load-test shop all three tables
     * held zero rows — so nothing had ever asked whether a count of six
     * thousand lines can be drawn, paged and applied, or whether a transfer
     * leaves the two branches' stock summing to what it was before.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    private function theShelf(Tenant $tenant, User $owner, array $branches, array $productIds): void
    {
        if ($productIds === []) {
            return;
        }

        auth()->setUser($owner);

        // ── A COUNT, on the main branch ──────────────────────────────
        if (($tenant->features['stocktake'] ?? false) === true) {
            try {
                $count = app(StartStockCountAction::class)->execute($owner, $tenant->id, [
                    'branch_id' => $branches[0]->id, 'scope' => 'all', 'blind' => true,
                ]);

                // Count a slice of the sheet, and get a realistic share of it
                // WRONG — a count where every line agrees proves only that the
                // expectation was copied into the answer.
                $lines = StockCountItem::withoutTenancy()
                    ->where('stock_count_id', $count->id)->limit(400)->get();

                $entered = [];
                foreach ($lines as $n => $line) {
                    $expected = (float) $line->expected_quantity;
                    $entered[] = [
                        'item_id' => $line->id,
                        'counted_quantity' => $n % 7 === 0
                            ? max(0, $expected - random_int(1, 3))   // shrinkage
                            : ($n % 23 === 0 ? $expected + 1 : $expected),
                    ];
                }

                app(RecordStockCountAction::class)->execute($owner, $count, $entered);
                app(ApplyStockCountAction::class)->execute($owner, $count, 'Quarterly count');
                $this->line('  stocktake  '.count($entered).' lines counted and applied');
            } catch (\Throwable $e) {
                $this->line('  stocktake  refused — '.Str::limit($e->getMessage(), 80));
            }
        }

        // ── TRANSFERS between branches ───────────────────────────────
        if (count($branches) > 1) {
            $moved = 0;
            foreach (range(1, 6) as $n) {
                $items = [];
                foreach (array_rand($productIds, min(4, count($productIds))) as $k) {
                    $pick = $productIds[$k];
                    $items[] = array_filter([
                        'product_id' => $pick['product_id'],
                        'variant_id' => $pick['variant_id'],
                        'quantity' => random_int(1, 5),
                    ], fn ($v) => $v !== null);
                }

                try {
                    app(TransferStockAction::class)->execute($tenant, [
                        'from_branch_id' => $branches[0]->id,
                        'to_branch_id' => $branches[$n % count($branches) ?: 1]->id,
                        'items' => $items,
                        'notes' => 'Topping up the shelf',
                    ]);
                    $moved++;
                } catch (\Throwable $e) {
                    // Counted, not swallowed — a transfer refused for lack of
                    // stock at the source is a legitimate outcome and a
                    // transfer refused for every reason is a bug.
                    $this->line('             transfer refused — '.Str::limit($e->getMessage(), 70));
                }
            }
            $this->line("  transfers  {$moved}");
        }

        // ── WRITTEN OFF ──────────────────────────────────────────────
        if (($tenant->features['disposals'] ?? false) === true) {
            $written = 0;
            $lost = 0.0;
            app(BranchContext::class)->set($branches[0]);

            foreach (range(1, 30) as $n) {
                $pick = $productIds[array_rand($productIds)];
                try {
                    $row = app(WriteOffStockAction::class)->execute($owner, [
                        'product_id' => $pick['product_id'],
                        'variant_id' => $pick['variant_id'],
                        'branch_id' => $branches[0]->id,
                        'quantity' => random_int(1, 4),
                        'disposition' => $n % 4 === 0
                            ? StockDisposal::RETURNED
                            : StockDisposal::WRITTEN_OFF,
                        'reason' => ['damaged', 'expired', 'other'][$n % 3],
                    ]);
                    $lost += (float) ($row->total_cost ?? 0);
                    $written++;
                } catch (\Throwable $e) {
                    // A lot-tracked item is refused here BY DESIGN and sent to
                    // its batch — so a pharmacy writing nothing off this way is
                    // the rule working, not a failure.
                }
            }

            app(BranchContext::class)->set(null);
            $this->line(sprintf('  write-offs %d · %s of stock', $written, number_format($lost, 2)));
        }
    }

    /**
     * COUPONS, PROMOTIONS AND POINTS — rules a basket picks up on its way past.
     *
     * Every one of these discounts the bill, and a discount applied twice, or
     * applied and then not reflected in the refund, is money. None of the
     * three had a single row in any load-test shop, so the whole discount
     * ladder in CreateSaleAction — cart, coupon, promotion, group price,
     * points — had never been exercised at volume against real reports.
     *
     * @param  array<string, string>  $categories
     */
    private function offers(Tenant $tenant, User $owner, array $categories): void
    {
        if (($tenant->features['promotions'] ?? false) !== true) {
            return;
        }

        $codes = [
            ['SAVE10', 'percent', 10, 1000, 500],
            ['FLAT200', 'fixed', 200, 1500, null],
            ['EID25', 'percent', 25, 3000, 1500],
            ['WELCOME', 'fixed', 100, 500, null],
            // Expired and exhausted ones, because "is this coupon still good"
            // is a rule with three answers and seeding only the live one tests
            // a third of it.
            ['LASTEID', 'percent', 15, 1000, 800],
            ['GONE', 'fixed', 300, 1000, null],
        ];

        $rows = [];
        foreach ($codes as $i => [$code, $type, $value, $minSpend, $maxDiscount]) {
            $dead = $code === 'LASTEID';
            $spent = $code === 'GONE';
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'code' => $code,
                'type' => $type,
                'value' => $value,
                'min_spend' => $minSpend,
                'max_discount' => $maxDiscount,
                'usage_limit' => $spent ? 5 : 500,
                'used_count' => $spent ? 5 : 0,
                'starts_at' => now()->subDays(60),
                'expires_at' => $dead ? now()->subDays(10) : now()->addDays(60),
                'is_active' => true,
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('coupons')->insert($rows);

        $promos = [];
        $categoryIds = array_values($categories);
        foreach (range(0, 2) as $i) {
            $promos[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'name' => ['Weekend 5% off', 'Rs 150 off a big basket', 'Category clearance'][$i],
                'type' => $i === 1 ? 'fixed' : 'percent',
                'value' => [5, 150, 12][$i],
                'scope' => $i === 2 && $categoryIds !== [] ? 'category' : 'order',
                'category_id' => $i === 2 ? ($categoryIds[0] ?? null) : null,
                'min_spend' => [2000, 5000, 0][$i],
                'priority' => $i,
                'starts_on' => now()->subDays(30)->toDateString(),
                'ends_on' => now()->addDays(30)->toDateString(),
                'is_active' => true,
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('promotions')->insert($promos);

        // POINTS. Off by default and switched on here, because a shop with
        // loyalty off never runs the earn/redeem arithmetic at all.
        $tenant->forceFill([
            'settings' => ($tenant->settings ?? []) + [
                'loyalty_enabled' => true,
                'loyalty_earn_per_amount' => 100,  // a point per hundred rupees
                'loyalty_redeem_value' => 1,
                'loyalty_min_redeem' => 50,
            ],
        ])->save();

        $this->line('  offers     '.count($rows).' coupons · '.count($promos).' promotions · points on');
    }

    /** @param Customer[] $customers */
    private function sales(Tenant $tenant, string $type, User $owner, array $branches, array $productIds, array $customers = []): void
    {
        $want = max(0, (int) $this->option('sales'));
        if ($want === 0 || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $action = app(CreateSaleAction::class);
        $done = 0;
        $onCredit = 0;
        $withACoupon = 0;
        /** @var array<string, int> $couponRefusals */
        $couponRefusals = [];
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

            /**
             * ONE SALE IN SIX IS ON THE BOOK.
             *
             * `payment_method: credit` against a named customer is how most of
             * these shops actually trade, and it is the only path that moves
             * `customers.credit_balance`. Until this existed the khata, the
             * credit limit and every "who owes us" figure were measured
             * against a table of zeroes.
             *
             * `amount_paid` is what the customer actually handed over, so some
             * of these are part-paid — the shape that catches a balance
             * charged for the whole bill instead of the unpaid remainder.
             */
            $debtor = $customers !== [] && $i % 6 === 0
                ? $customers[$i % count($customers)]
                : null;

            // Every fifth basket arrives with a code. SAVE10 and FLAT200 have
            // a minimum spend, so plenty of these are legitimately refused —
            // which is the half of a coupon rule nothing was testing.
            $coupon = $i % 5 === 0 ? ['SAVE10', 'FLAT200', 'WELCOME'][$i % 3] : null;

            try {
                $sale = $action->execute(array_filter([
                    'branch_id' => $branch->id,
                    'channel' => 'walk_in',
                    'customer_name' => $debtor?->name ?? ['Ahmed', 'Fatima', 'Bilal', 'Ayesha', 'Usman'][$i % 5],
                    'customer_phone' => $debtor?->phone,
                    'coupon_code' => $coupon,
                    'items' => $items,
                    'payment_method' => $debtor !== null
                        ? 'credit'
                        : ['cash', 'card', 'wallet', 'bank_transfer'][$i % 4],
                    // On credit the shop takes a part payment or nothing; a
                    // cash sale is settled in full.
                    'amount_paid' => $debtor !== null ? ($i % 12 === 0 ? 0 : 200) : 1_000_000,
                    'created_by' => $owner->id,
                ], fn ($v) => $v !== null));

                if ($debtor !== null) {
                    $onCredit++;
                }
                if ($coupon !== null && (float) $sale->discount > 0) {
                    $withACoupon++;
                }

                // Ninety days of trade, so every report has a shape to draw.
                $sale->forceFill([
                    'sold_at' => now()->subDays(random_int(0, 89))->subHours(random_int(0, 13)),
                ])->save();
                $done++;
            } catch (\Throwable $e) {
                /**
                 * A REFUSED COUPON IS NOT A LOST SALE.
                 *
                 * `CouponService::apply` THROWS when the basket is under the
                 * minimum spend, or the code has expired, or its uses are
                 * gone — so attaching a code to one basket in five refused one
                 * basket in five outright, and the shop lost those sales
                 * instead of ringing them. At the counter the cashier simply
                 * takes the code off and takes the money.
                 *
                 * Retried without it, which is also the only way the refusal
                 * itself gets exercised at volume: every one of these is a
                 * real coupon rule firing on a real basket.
                 */
                $refusedCoupon = $coupon !== null && str_starts_with(
                    (string) ($e instanceof DomainException ? $e->errorCode : ''),
                    'COUPON_',
                );

                if ($refusedCoupon) {
                    $couponRefusals[$e->getMessage()] = ($couponRefusals[$e->getMessage()] ?? 0) + 1;

                    try {
                        $sale = $action->execute(array_filter([
                            'branch_id' => $branch->id,
                            'channel' => 'walk_in',
                            'customer_name' => $debtor?->name ?? 'Walk-in',
                            'customer_phone' => $debtor?->phone,
                            'items' => $items,
                            'payment_method' => $debtor !== null ? 'credit' : 'cash',
                            'amount_paid' => $debtor !== null ? 200 : 1_000_000,
                            'created_by' => $owner->id,
                        ], fn ($v) => $v !== null));

                        $sale->forceFill([
                            'sold_at' => now()->subDays(random_int(0, 89))->subHours(random_int(0, 13)),
                        ])->save();
                        $done++;
                        if ($debtor !== null) {
                            $onCredit++;
                        }
                        $bar->advance();

                        continue;
                    } catch (\Throwable $second) {
                        $e = $second;
                    }
                }

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
        $this->line("  sales      {$done}".($skipped > 0 ? " ({$skipped} refused)" : '')
            ." · {$onCredit} on the book · {$withACoupon} took a coupon");
        arsort($couponRefusals);
        foreach (array_slice($couponRefusals, 0, 3, true) as $why => $n) {
            $this->line('             coupon refused ×'.$n.'  '.Str::limit($why, 70));
        }
        arsort($reasons);
        foreach (array_slice($reasons, 0, 3, true) as $why => $n) {
            $this->line('             × '.$n.'  '.Str::limit($why, 90));
        }
    }
}
