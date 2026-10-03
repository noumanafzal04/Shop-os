<?php

namespace App\Console\Commands;

use App\Actions\Expense\PostRecurringExpenseAction;
use App\Actions\Fuel\ChangeFuelPriceAction;
use App\Actions\Fuel\CloseForecourtShiftAction;
use App\Actions\Fuel\OpenForecourtShiftAction;
use App\Actions\Fuel\RecordFuelDeliveryAction;
use App\Actions\Income\PostRecurringIncomeAction;
use App\Actions\Inventory\ApplyStockCountAction;
use App\Actions\Inventory\RecordStockCountAction;
use App\Actions\Inventory\StartStockCountAction;
use App\Actions\Inventory\TransferStockAction;
use App\Actions\Inventory\WriteOffStockAction;
use App\Actions\Pos\CloseBusinessDayAction;
use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Actions\Restaurant\AddTicketItemsAction;
use App\Actions\Restaurant\FireKitchenTicketAction;
use App\Actions\Restaurant\OpenTicketAction;
use App\Actions\Restaurant\SettleTicketAction;
use App\Actions\Sale\CancelSaleAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessExchangeAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Actions\SaleDocument\ConvertSaleDocumentAction;
use App\Actions\SaleDocument\CreateSaleDocumentAction;
use App\Actions\SaleDocument\RecordDepositAction;
use App\Enums\OrderStatus;
use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\City;
use App\Models\Customer;
use App\Models\CustomerVehicle;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\Plan;
use App\Models\Product;
use App\Models\RecurringExpense;
use App\Models\RecurringIncome;
use App\Models\Register;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\SaleDocument;
use App\Models\StockCountItem;
use App\Models\StockDisposal;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Services\OrderService;
use App\Services\ReviewService;
use App\Services\RiderService;
use App\Support\BranchContext;
use App\Support\DrawerMath;
use App\Support\Modules;
use App\Support\Payable;
use App\Support\PlatformSettings;
use App\Support\StaffPresets;
use App\Support\TenantContext;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
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

        /**
         * A SEEDER THAT RUNS OUT OF MEMORY LOOKS LIKE A SCHEMA FAULT.
         *
         * This builds seven shops in one process and makes hundreds of
         * thousands of queries doing it. Laravel keeps every one of them in
         * the query log while a listener is attached, and the growth is
         * invisible until the run dies halfway through the fourth shop with
         * "Allowed memory size exhausted" — which it did, leaving a
         * half-built pharmacy and an audit reporting 450 shelves adrift.
         *
         * That finding was the seeder's, not the product's. The log is off
         * and the limit is raised, because this command is a fixture builder
         * and not a request.
         */
        DB::connection()->disableQueryLog();
        if ((int) ini_get('memory_limit') > 0) {
            ini_set('memory_limit', '1024M');
        }

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

        /**
         * THE PLATFORM HAS TO BE BILLING SOMETHING.
         *
         * Commission is OFF across the installation by default, which is the
         * right default — whether the platform takes a cut is a business
         * decision, not a seeding one. But with it off, `rateFor()` returns
         * zero, `chargeFor()` returns null, and thirty completed marketplace
         * orders produce an empty `commission_charges` table that reads as a
         * broken feature.
         *
         * Switched on HERE and said out loud, because this is the one thing
         * this command changes that is not a load-test row.
         */
        if (! PlatformSettings::get('commission_enabled')) {
            PlatformSettings::put(['commission_enabled' => true, 'commission_rate' => 4.5]);
            $this->warn('  platform commission switched ON at 4.5% — it was off, and the billing path cannot be exercised without it.');
        }

        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);
        $lines = max(200, (int) $this->option('products'));

        $this->shop('grocery', 'Al-Madina Cash & Carry', 'mart', $city, [
            'plan' => 'enterprise',
            'branches' => ['Main — Ferozepur Road', 'Johar Town', 'Model Town'],
            'lines' => $lines,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
            'online' => true,
            'bank_offers' => true,
        ]);

        $this->shop('clothing', 'Zahra Couture', 'retail', $city, [
            'plan' => 'pro',
            'branches' => ['Main — Liberty', 'Packages Mall'],
            // Fewer designs, but every design in four sizes — the row count
            // that matters here is variants, not products.
            'lines' => (int) round($lines * 0.4),
            'sizes' => 4,
            'batches' => false,
            'dining' => false,
            'online' => true,
            'bank_offers' => true,
        ]);

        $this->shop('restaurant', 'Karahi House', 'food', $city, [
            'plan' => 'premium',
            'branches' => ['Main — MM Alam Road', 'Bahria Town'],
            // A MENU IS NOT A CATALOGUE. Six thousand dishes is not a
            // restaurant, it is a warehouse — the volume that matters here is
            // tables, tickets and modifier combinations, not lines.
            'lines' => 420,
            'sizes' => 0,
            'batches' => false,
            'dining' => true,
            'online' => true,
        ]);

        $this->shop('pharmacy', 'Shifa Pharmacy', 'pharmacy', $city, [
            'plan' => 'premium',
            'branches' => ['Main — Jail Road', 'DHA Phase 4'],
            'lines' => (int) round($lines * 0.8),
            'sizes' => 0,
            'batches' => true,
            'dining' => false,
            'online' => true,
        ]);

        $this->shop('services', 'Gulberg Service Centre', 'services', $city, [
            'plan' => 'premium',
            'branches' => ['Main — Gulberg', 'Township'],
            // A service list is short. What a service business carries volume
            // in is JOBS and QUOTES, not lines on a price list.
            'lines' => 120,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('wholesale', 'Akbari Mandi Traders', 'wholesale', $city, [
            'plan' => 'pro',
            'branches' => ['Main — Akbari Mandi', 'Sabzi Mandi'],
            'lines' => (int) round($lines * 0.5),
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('petrol', 'Khokhar Filling Station', 'petroleum', $city, [
            // TWO SITES ON PURPOSE. A forecourt's equipment hangs off a
            // branch, and the one fault this shape has already had was a
            // tank stored with a null branch while the shift looked for
            // Main. One site could never have shown it.
            'plan' => 'premium',
            'branches' => ['Main — Multan Road', 'Raiwind Road'],
            // The shop behind the forecourt is small; the volume here is
            // SHIFTS, meters and dips, not lines on a shelf.
            'lines' => 140,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('workshop', 'Rahat Auto Workshop', 'automotive', $city, [
            'plan' => 'premium',
            'branches' => ['Main — Band Road'],
            // Parts on a shelf AND labour on the same invoice. What carries
            // the volume is cars through the bay, not part numbers.
            'lines' => 260,
            'sizes' => 0,
            'batches' => false,
            'dining' => false,
        ]);

        $this->shop('finance', 'Rehman Books & Accounts', 'finance', $city, [
            // THE SHOP WITH NO SHOP. No till, no catalogue, no stock — the
            // expense book IS the product. It is the shape most likely to be
            // broken by a change made for everybody else, and the only one
            // where the cashbook has no sales to lean on.
            'plan' => 'basic', 'extra_staff' => 7,
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

    /** @param array{branches: string[], lines: int, sizes: int, batches: bool, dining?: bool, online?: bool, bank_offers?: bool} $spec */
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
            /**
             * THE FLAG IS HALF THE DOOR.
             *
             * `Tenant::sellsOnline()` wants the flag AND the marketplace
             * module, and its own docblock names this as the trap: "the
             * module went on and the shop stayed invisible". The defaults for
             * every one of these trades leave `marketplace` off, so seven
             * shops carried the flag, answered false, and the audit reported
             * `orders` empty on all of them.
             *
             * Only where a shop would really take orders. A filling station
             * does not deliver petrol to a house, and an accountant's office
             * has no catalogue to list.
             */
            'features' => Modules::defaultsFor($type),
        ]);

        /**
         * THE SHOPS NOBODY PUT ON A PLAN.
         *
         * Nine shops the size of real businesses, and not one of them was on
         * a plan — the factory handed every tenant 20 branches, 100 staff and
         * 20 lanes as a flat override, which is how the biggest fixture in
         * this repo managed to exercise the entire pricing model not at all.
         * No ceiling was ever near, no usage band was ever anything but "ok",
         * and the retention window could not fire because there was no plan
         * to carry one.
         *
         * Each shop sits on a real rung now, spread across the ladder, and
         * the blanket override goes: a limit on one of these shops means
         * somebody decided it, exactly as on a real tenant. `extra_staff` is
         * the deliberate exception — one shop on the cheapest plan with a
         * hand-granted allowance on top, so the override arithmetic is
         * exercised by something other than a unit test.
         */
        $plan = Plan::query()->where('code', $spec['plan'] ?? 'premium')->first();

        $tenant->forceFill([
            'plan_id' => $plan?->id,
            'limits' => array_filter([
                'staff' => $spec['extra_staff'] ?? null,
            ], fn ($v) => $v !== null),
            // An anniversary in the past, so the bills meter has a real
            // period to count inside rather than falling back to the 1st.
            'subscription_starts_at' => now()->subMonthsNoOverflow(random_int(2, 14))->startOfDay(),
            'subscription_ends_at' => now()->addMonthNoOverflow(),
        ])->save();
        $tenant->refresh();

        if (! empty($spec['online'])) {
            $tenant->applyModules(['marketplace' => true, 'delivery' => true]);
            $tenant->refresh();
        }

        /**
         * A CARD PROMOTION IS NOT FOR EVERY TRADE.
         *
         * A clothing shop runs them constantly — it is how a bank puts its
         * card in a customer's hand on a Friday. A filling station's margin
         * does not survive one, and a mandi trader is paid in cash and on
         * account. So the module goes on where it is true to life, which is
         * also the only way `bank_card_offers` stops being empty.
         */
        if (! empty($spec['bank_offers'])) {
            $tenant->applyModules(['bank_offers' => true]);
            $tenant->refresh();
        }

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
        // Groups, packs, barcodes and tax bands BEFORE the till opens — a
        // price ladder nobody climbs is a price ladder nobody tests.
        $this->priceLists($tenant, $productIds);
        $this->sales($tenant, $type, $owner, $branches, $productIds, $customers);
        $this->khata($tenant, $owner);
        $this->afterTheSale($tenant, $owner, $branches, $productIds);
        $this->theShelf($tenant, $owner, $branches, $productIds);
        // The forecourt owns the week BEFORE the till's, because one person
        // cannot hold two open shifts and the server is right to refuse it.
        $this->theForecourt($tenant, $owner, $branches);
        $this->theTill($tenant, $type, $owner, $branches, $productIds);
        // Paperwork AFTER the till, because a job card converts into a sale
        // and the conversion has to land in a world where selling already works.
        $this->theBanksOffer($tenant, $owner, $branches, $productIds);
        $this->theReward($tenant, $type, $owner, $branches, $productIds);
        $this->theDiningRoom($tenant, $owner, $branches, $productIds);
        $this->theOnlineDoor($tenant, $owner, $branches, $productIds);
        $this->theShoppers($tenant, $owner, $productIds, $city);
        $this->thePaperwork($tenant, $type, $owner, $branches, $productIds, $customers);
        $this->theTills($tenant, $owner, $branches);
        $this->books($tenant, $owner, $branches);
        $this->theStandingOrders($tenant, $owner, $branches);

        app(TenantContext::class)->clear();
    }

    /**
     * EVERY COMBINATION OF TWO AXES, in the order a person would read them.
     *
     * The same shape the panel's `variantMatrix` produces, kept here rather
     * than approximated: a fixture that generated the combinations in a
     * different order, or that dropped the single-axis case, would be
     * testing a grid the product does not make.
     *
     * A null first axis means "this line has only one axis" and yields the
     * second axis alone — a shop sells scarves in four sizes and nothing
     * else, and that is not a degenerate case, it is most of the catalogue.
     *
     * @param  array<int, string|null>  $first
     * @param  string[]  $second
     * @return array<int, array{0: string|null, 1: string}>
     */
    private function grid(array $first, array $second): array
    {
        $out = [];
        foreach ($first as $a) {
            foreach ($second as $b) {
                $out[] = [$a, $b];
            }
        }

        return $out;
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
            // A filling station sells more than fuel, and the shop behind the
            // forecourt is an ordinary mart. The fuels themselves are NOT
            // here: they are made in theForecourt(), because a product only
            // counts as fuel once a tank holds it.
            'petroleum' => ['Engine Oil', 'Gear Oil', 'Coolant', 'Brake Fluid', 'Filters', 'Batteries', 'Wipers', 'Car Care', 'Tuck Shop', 'Lubricants'],
            'automotive' => ['Engine', 'Brakes', 'Suspension', 'Electrical', 'Filters', 'Tyres', 'Batteries', 'Body', 'Fluids', 'Labour'],
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
            'petroleum' => [['Shell Helix', 'Caltex Havoline', 'ZIC', 'Total Quartz', 'PSO Carient', 'Castrol GTX', 'Coolant', 'Brake Fluid', 'Oil Filter', 'Wiper Blade'], ['1L', '3L', '4L', '5L', 'Carton', '20W-50', '15W-40', '5W-30', 'Pair', 'Piece']],
            'automotive' => [['Brake Pad', 'Oil Filter', 'Air Filter', 'Spark Plug', 'Shock Absorber', 'Timing Belt', 'Clutch Plate', 'Radiator Hose', 'Wheel Bearing', 'Headlamp'], ['Suzuki Mehran', 'Toyota Corolla', 'Honda City', 'Suzuki Cultus', 'Suzuki Alto', 'Toyota Vitz', 'Honda Civic', 'Daihatsu Mira', 'KIA Picanto', 'Changan Alsvin']],
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
                /**
                 * A NUMBER STAMPED ON EACH UNIT — and a guarantee behind it.
                 *
                 * Batteries, headlamps, handsets. Marked HERE, before any
                 * delivery is booked in, because `product_serials` is written
                 * at goods-in: a product that becomes serialised afterwards
                 * has a stock registry that can never catch up with what is
                 * already on the shelf.
                 *
                 * One line in eight, in the two trades that carry them. Every
                 * line serialised would mean typing a number for each unit of
                 * a carton of wiper blades, which is not what anybody does.
                 */
                'tracks_serial' => in_array($type, ['automotive', 'retail'], true) && $i % 8 === 0,
                'warranty_months' => in_array($type, ['automotive', 'retail'], true) && $i % 8 === 0
                    ? [6, 12, 24][$i % 3]
                    : null,
                'is_active' => true,
                'visible_in_marketplace' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ];

            if ($spec['sizes'] > 0) {
                /**
                 * TWO AXES, NOT ONE — because a garment shop has two.
                 *
                 * The panel has built a colour × size GRID since the variant
                 * matrix shipped, and this fixture had only ever produced
                 * `S, M, L, XL`: one axis, four rows, the easy half. A shirt
                 * in three colours and four sizes is TWELVE things on the
                 * shelf, each with its own stock and its own barcode, and
                 * every screen that groups, searches, prices or counts
                 * variants behaves differently once the name has two
                 * segments in it.
                 *
                 * `/` is the separator the whole platform composes on, and
                 * it is the reason this matters: a two-axis row renders as
                 * `Kurti / Red / M` — three segments, with nothing in the
                 * string to say which slash is the product boundary.
                 *
                 * Not every line gets colours. A shop sells scarves in four
                 * sizes and plain cotton in one, and a catalogue where every
                 * single item is a twelve-way grid is not a shop.
                 */
                $colours = $i % 3 === 0
                    ? ['Red', 'Black', 'Ivory']
                    : ($i % 3 === 1 ? ['Navy', 'Maroon'] : [null]);

                /**
                 * THE AXES, KEPT BESIDE THE PRODUCT.
                 *
                 * `attributes.variant_axes` is what lets the form rebuild
                 * the GRID when somebody opens the item again. Without it
                 * the panel falls back to `axesFromRows`, which refuses to
                 * guess — so an edit screen would show twelve unexplained
                 * rows instead of "Colour × Size", and adding a fourth
                 * colour would mean typing four more by hand.
                 *
                 * A fixture that made the variants and not the axes would
                 * have been testing the half of the feature that is easy.
                 */
                $axes = [['name' => 'Size', 'values' => ['S', 'M', 'L', 'XL']]];
                if ($colours !== [null]) {
                    array_unshift($axes, ['name' => 'Colour', 'values' => $colours]);
                }
                $productRows[count($productRows) - 1]['attributes'] = json_encode(['variant_axes' => $axes]);

                foreach ($this->grid($colours, ['S', 'M', 'L', 'XL']) as [$colour, $size]) {
                    $label = $colour === null ? $size : "{$colour} / {$size}";
                    $slug = $colour === null ? $size : strtoupper(substr($colour, 0, 2))."-{$size}";
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
                        'name' => $label,
                        'sku' => strtoupper(substr($type, 0, 3)).'-'.str_pad((string) ($i + 1), 6, '0', STR_PAD_LEFT)."-{$slug}",
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
            /**
             * THE PARENT'S FIGURE IS ITS OWN ROWS, NOT ITS SIZES'.
             *
             * `InventoryService::adjust()` writes the roll-up to whichever
             * row the movement NAMED: a variant's stock lands on the variant,
             * and the parent of a sized product is left where it was — at
             * zero, because nothing is ever adjusted on it directly.
             *
             * This summed every branch_stock row for the product, variants
             * included, so 72 sized parents in the clothing shop carried a
             * figure the real application never writes. Low stock, valuation
             * and the marketplace all read that column, and a fixture that
             * inflates it is a fixture where those screens behave differently
             * from the shop they are meant to imitate. `LowStock` exists
             * BECAUSE the real figure is nought for anything sold in sizes.
             */
            'UPDATE products p SET stock_quantity = COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id AND bs.variant_id IS NULL), 0) WHERE p.tenant_id = ?',
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

        /**
         * A BOOK WITH NO HEADINGS IS A LIST.
         *
         * Both category tables were empty on every shop, so sixty expenses
         * sat under nothing and every "by category" figure on the money
         * screens was one unnamed bucket. The categories are also REQUIRED
         * by the recurring tables, which is how the absence finally spoke.
         */
        $outCats = [];
        foreach ($outs as $i => $name) {
            $id = (string) Str::uuid7();
            $outCats[$name] = $id;
            DB::table('expense_categories')->insert([
                'id' => $id, 'tenant_id' => $tenant->id, 'name' => $name,
                'is_default' => $i === 0, 'is_active' => true,
                'created_by' => $owner->id, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $inCats = [];
        foreach ($ins as $i => $name) {
            $id = (string) Str::uuid7();
            $inCats[$name] = $id;
            DB::table('income_categories')->insert([
                'id' => $id, 'tenant_id' => $tenant->id, 'name' => $name,
                'is_default' => $i === 0, 'is_active' => true,
                'created_by' => $owner->id, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $rows = [];
        foreach (range(0, 59) as $i) {
            $rows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'branch_id' => $branches[$i % count($branches)]->id,
                'description' => $outs[$i % count($outs)],
                'expense_category_id' => $outCats[$outs[$i % count($outs)]],
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
                'income_category_id' => $inCats[$ins[$i % count($ins)]],
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
                /**
                 * A NUMBER STAMPED ON EACH UNIT, REGISTERED AS IT ARRIVES.
                 *
                 * `product_serials` is the stock REGISTRY — what the shop
                 * holds, by serial — and it is written here, at goods-in, and
                 * nowhere else. The fixture used to mark its serialised lines
                 * long AFTER every delivery had been booked, so the registry
                 * was empty on every shop while `sale_item_serials` filled up:
                 * units sold that had never been received.
                 */
                $serials = [];
                if ($product?->tracks_serial) {
                    foreach (range(1, (int) $want) as $u) {
                        $serials[] = strtoupper(Str::random(3)).'-'.random_int(1000000, 9999999);
                    }
                }

                $map[$item->id] = [
                    'quantity' => $want,
                    'serials' => $serials,
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

            /**
             * PAID FOR WHAT CAME, in full, in part, or not yet.
             *
             * This paid a share of `total` against the named order, and once
             * the Pay screen started refusing anything past the DELIVERY —
             * which is the whole point of that fix — every short delivery
             * threw "Payment exceeds what has been delivered". The seeder was
             * asking the till to do the thing the till now refuses, so it was
             * the seeder that had to change.
             */
            $bill = (float) $po->fresh()->{Payable::AMOUNT};
            $share = [1.0, 0.5, 0.0][$i % 3];
            if ($share > 0.0 && $bill > 0) {
                try {
                    app(RecordSupplierPaymentAction::class)->execute($supplier, [
                        'amount' => round($bill * $share, 2),
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
     * WHAT A BASKET AT THIS SHOP HAS TO LOOK LIKE.
     *
     * Two callers ring sales — the ninety-day history and the seven days of
     * real shifts — and the first version let the second write its own
     * basket. It immediately produced 34 karahis with no spice level and a
     * stack of "Minimum order quantity is 5.000" at the wholesaler: the same
     * two rules, learned once and then not applied by the other caller.
     *
     * One place, so a rule the shop enforces cannot be obeyed by half the
     * fixture.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     * @param  array<string, array<string, string>>  $mustChoose
     * @return array<int, array<string, mixed>>
     */
    private function basket(string $type, array $productIds, array $mustChoose, int $lines): array
    {
        $items = [];
        foreach (range(1, $lines) as $_) {
            $pick = $productIds[array_rand($productIds)];
            $items[] = array_filter([
                'product_id' => $pick['product_id'],
                'variant_id' => $pick['variant_id'],
                // A required modifier group refuses the line without one, and
                // it is right to: nobody orders a karahi without saying how
                // hot they want it.
                'modifier_option_ids' => array_values($mustChoose[$pick['product_id']] ?? []) ?: null,
                // A wholesale line under the minimum order quantity is
                // refused, and it is right to: that is what a cash-and-carry
                // IS.
                'quantity' => $type === 'wholesale' ? random_int(5, 60) : random_int(1, 3),
            ], fn ($v) => $v !== null);
        }

        return $items;
    }

    /**
     * Which groups a dish cannot be ordered without, and which are optional.
     *
     * @return array{0: array<string, array<string, string>>, 1: array<string, array<string, string>>}
     */
    private function modifierRules(Tenant $tenant): array
    {
        $must = [];
        $may = [];
        foreach (
            DB::table('modifier_groups as g')
                ->join('modifier_options as o', 'o.modifier_group_id', '=', 'g.id')
                ->where('g.tenant_id', $tenant->id)
                ->where('o.is_active', true)
                ->orderBy('o.sort_order')
                ->get(['g.product_id', 'g.id as gid', 'g.min_select', 'o.id as oid']) as $row
        ) {
            // One option per GROUP, not per row — a single-select group handed
            // three options is refused for choosing too many.
            if ((int) $row->min_select > 0) {
                $must[$row->product_id][$row->gid] ??= $row->oid;
            } else {
                $may[$row->product_id][$row->gid] ??= $row->oid;
            }
        }

        return [$must, $may];
    }

    /**
     * SEVEN DAYS BEHIND A REAL TILL.
     *
     * Every sale this command made was rung with no shift at all, so
     * `cash_sessions` and `business_days` held nothing in any of the seven
     * shops — and the drawer is where a shop finds out it is being robbed.
     * `DrawerMath`, the close variance, the declared-tender comparison, the
     * day roll-up and the banking slip had never once been computed over real
     * trade.
     *
     * ── WHAT MAKES THIS WORTH THE ROWS ──────────────────────────────
     *
     * A drawer that always balances is a drawer nobody has tested. The close
     * here counts SHORT on some shifts and OVER on others, by amounts a real
     * till produces — a note miscounted, change given from a pocket — because
     * the number that matters is the variance and a variance of zero proves
     * only that the fixture copied the expectation into the answer.
     *
     * Cash movements too: petty cash out, khata collected in, a mid-shift
     * drop to the safe. Each moves the expectation a different way, and the
     * khata one is the daily reality that used to produce a phantom overage.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    /**
     * THE FORECOURT — meters, dips, and the gap between them.
     *
     * Every other shop in this file is reconciled by ONE question: does the
     * drawer hold what the till says it took. A filling station is reconciled
     * by three, and the whole point of the module is that they disagree:
     *
     *   the METERS say how many litres left the nozzles
     *   the TILL   says how many litres were charged for
     *   the DIPS   say how many litres are still in the ground
     *
     * Metered minus rung is fuel that left a hose without being billed — a
     * question about people. Book stock minus the dip is fuel that never
     * crossed a meter at all — a question about the ground. The two are never
     * summed, and a fixture that made them equal would prove nothing.
     *
     * So this phase deliberately produces BOTH kinds of gap, small and
     * plausible, on top of a week of otherwise honest shifts: a few litres
     * tested back into the tank, an attendant's nozzle a hair ahead of the
     * till, and one tank quietly a few litres light.
     *
     * It runs over days 14 → 8 so it never collides with `theTill()`, which
     * owns days 7 → 0. One person cannot hold two open shifts, and the server
     * is right to say so.
     *
     * @param  Branch[]  $branches
     */
    private function theForecourt(Tenant $tenant, User $owner, array $branches): void
    {
        if (($tenant->features['fuel'] ?? false) !== true) {
            return;
        }

        auth()->setUser($owner);
        $openShift = app(OpenForecourtShiftAction::class);
        $closeShift = app(CloseForecourtShiftAction::class);
        $delivery = app(RecordFuelDeliveryAction::class);
        $reprice = app(ChangeFuelPriceAction::class);
        $sale = app(CreateSaleAction::class);
        $openTill = app(OpenCashSessionAction::class);
        $closeTill = app(CloseCashSessionAction::class);
        $day = app(CloseBusinessDayAction::class);

        // ── What a tank holds ───────────────────────────────────────
        // Made here and not in the catalogue because a product is only FUEL
        // once a tank holds it — `ChangeFuelPriceAction` asks exactly that
        // question before it will reprice anything.
        $grades = [];
        foreach ([['Petrol', 268.50], ['High Speed Diesel', 276.00], ['Hi-Octane', 311.00]] as [$name, $price]) {
            $grades[$name] = Product::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'type' => 'product',
                'name' => $name,
                'price' => $price,
                'cost' => round($price * 0.955, 2),
                'unit' => 'Litre',
                // Litres are not whole things. `each` would refuse 7.449.
                'sold_by' => 'weight',
                'track_inventory' => true,
                'stock_quantity' => 0,
                'is_active' => true,
            ]);
        }

        $plant = 0;
        $shifts = 0;
        $closed = 0;
        $deliveries = 0;
        $rung = 0;
        /** @var array<string, int> $why */
        $why = [];

        foreach ($branches as $b => $branch) {
            app(BranchContext::class)->set($branch);

            /** @var array<string, FuelTank> $tanks */
            $tanks = [];
            foreach ($grades as $name => $product) {
                // The second site has no Hi-Octane — a real difference
                // between two forecourts of the same company, and the thing
                // that makes "every tank has to be dipped" mean something
                // other than "the same three tanks everywhere".
                if ($b > 0 && $name === 'Hi-Octane') {
                    continue;
                }

                $tank = FuelTank::withoutTenancy()->create([
                    'tenant_id' => $tenant->id,
                    'branch_id' => $branch->id,
                    'product_id' => $product->id,
                    'name' => 'Tank '.(count($tanks) + 1).' — '.$name,
                    'capacity_litres' => 30000,
                    'current_dip_litres' => random_int(9000, 16000),
                    // Fuel below the suction pipe cannot be sold and must not
                    // be counted as stock on hand.
                    'dead_stock_litres' => 300,
                    'is_active' => true,
                ]);
                /**
                 * FUEL IN THE GROUND IS FUEL ON THE BOOKS.
                 *
                 * The tank was given an opening dip and the product was left
                 * at zero, so the first 128 fuel lines were refused for want
                 * of stock — and `priceIt()` swallowed the reason, which is
                 * how "could not price the fuel line" came to stand for
                 * "there is no petrol in this shop". A station that has
                 * fourteen thousand litres underground has fourteen thousand
                 * litres to sell, and the two numbers start life equal.
                 */
                DB::table('branch_stock')->insert([
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'branch_id' => $branch->id,
                    'product_id' => $product->id,
                    'quantity' => $tank->current_dip_litres,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $tanks[$name] = $tank;
                $plant++;
            }

            /**
             * A STICK READS MILLIMETRES, AND ONLY ONE TANK IS CHARTED.
             *
             * Charting every tank would hide the branch the close action
             * actually has to handle — a station part-way through calibrating
             * its plant, dipping one tank in mm off the chart and the rest in
             * litres off a paper table. Both paths are then live in the same
             * close, which is the state no single-tank test can produce.
             */
            // One lookup for "which fuel does this nozzle pour", built once
            // per branch rather than searched per sale.
            /** @var array<string, Product> $byTank */
            $byTank = [];
            foreach ($tanks as $name => $t) {
                $byTank[$t->id] = $grades[$name];
            }

            $charted = reset($tanks);
            $points = [];
            for ($mm = 0; $mm <= 2000; $mm += 100) {
                $points[] = [
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'fuel_tank_id' => $charted->id,
                    // Not linear. An underground cylinder holds far less per
                    // millimetre at the bottom than across its middle, and a
                    // straight-line chart would make the interpolation look
                    // correct when it is not being exercised at all.
                    'litres' => round(30000 * (($mm / 2000) ** 1.35), 3),
                    'mm' => $mm,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }
            DB::table('fuel_tank_dip_points')->insert($points);

            /** @var FuelNozzle[] $nozzles */
            $nozzles = [];
            foreach ([1, 2] as $n) {
                $pump = FuelPump::withoutTenancy()->create([
                    'tenant_id' => $tenant->id,
                    'branch_id' => $branch->id,
                    'name' => 'Pump '.$n,
                    'code' => 'P'.$n,
                    'is_active' => true,
                ]);
                $plant++;

                foreach ($tanks as $name => $tank) {
                    $nozzles[] = FuelNozzle::withoutTenancy()->create([
                        'tenant_id' => $tenant->id,
                        'fuel_pump_id' => $pump->id,
                        'fuel_tank_id' => $tank->id,
                        'name' => chr(64 + $n).substr($name, 0, 1),
                        'current_reading' => random_int(100000, 900000),
                        'is_active' => true,
                    ]);
                    $plant++;
                }
            }

            $lane = Register::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branch->id,
                'name' => 'Forecourt cabin',
                'code' => 'FC',
                'is_active' => true,
            ]);

            // The shop-wide figure is the sum of the branches, same as the
            // catalogue does it — a product's own quantity is a roll-up, not
            // a second opinion.
            DB::update(
                'UPDATE products p SET stock_quantity = COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.id), 0) WHERE p.tenant_id = ?',
                [$tenant->id],
            );

            for ($d = 14; $d >= 8; $d--) {
                $date = now()->subDays($d)->setTime(6, 0);
                CarbonImmutable::setTestNow($date);
                Carbon::setTestNow($date);

                try {
                    // A TANKER ARRIVES BEFORE THE SHIFT, not during it. The
                    // discharge moves the dip, and a delivery landing inside
                    // an open shift is a different fixture — one worth having
                    // and not this one.
                    if ($d % 3 === 0) {
                        $tank = $tanks[array_rand($tanks)];
                        $before = (float) $tank->fresh()->current_dip_litres;
                        $invoiced = (float) random_int(8000, 12000);
                        // The tanker arrived SHORT. Dips beat the invoice, and
                        // that preference is the only reason the shortfall is
                        // visible at all.
                        $actual = $d % 6 === 0 ? $invoiced - random_int(40, 180) : $invoiced;

                        $delivery->execute($owner, [
                            'fuel_tank_id' => $tank->id,
                            'invoiced_litres' => $invoiced,
                            'dip_before' => $before,
                            'dip_after' => $before + $actual,
                            'invoice_number' => 'PSO-'.(20000 + $d),
                            'tanker_number' => 'LES-'.random_int(1000, 9999),
                            'unit_cost' => round((float) $tank->product->price * 0.955, 2),
                        ]);
                        $deliveries++;
                    }

                    // The rate moves overnight, as it does in Pakistan on the
                    // last day of the month — and the shift's readings
                    // snapshot the rate in force when the shift OPENED, so a
                    // reprice has to land between shifts to be honest.
                    if ($d === 11) {
                        foreach ($grades as $product) {
                            $reprice->execute($owner, [
                                'product_id' => $product->id,
                                'new_price' => round((float) $product->fresh()->price + random_int(-250, 450) / 100, 2),
                                'reason' => 'OGRA notification',
                            ]);
                        }
                    }

                    $shift = $openShift->execute($owner, [
                        'branch_id' => $branch->id,
                        'notes' => 'Day shift',
                    ]);
                    $shifts++;

                    $day->open($owner, $branch->id);
                    $session = $openTill->execute($owner, 5000, $lane);
                } catch (\Throwable $e) {
                    Carbon::setTestNow();
                    CarbonImmutable::setTestNow();
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                    continue;
                }

                // ── What the till rang, nozzle by nozzle ────────────
                /** @var array<string, float> $soldPerNozzle */
                $soldPerNozzle = [];

                foreach ($nozzles as $nozzle) {
                    $product = $byTank[$nozzle->fuel_tank_id];
                    $litres = 0.0;

                    foreach (range(1, random_int(9, 16)) as $k) {
                        /**
                         * MONEY IN, LITRES OUT — and both doors are used.
                         *
                         * Nobody at a pump asks for 7.449 litres; they hand
                         * over a two-thousand-rupee note. The line may name
                         * an `amount` and the server works the litres back
                         * from the rate. A fixture that only ever sent
                         * quantities would leave the door most customers
                         * actually use completely unwalked.
                         */
                        $byMoney = $k % 2 === 0;
                        $item = $byMoney
                            ? ['product_id' => $product->id, 'amount' => (float) (random_int(5, 40) * 100)]
                            : ['product_id' => $product->id, 'quantity' => round(random_int(300, 4000) / 100, 3)];

                        $line = [
                            'branch_id' => $branch->id,
                            'channel' => 'walk_in',
                            'items' => [$item],
                            'cash_session_id' => $session->id,
                            'created_by' => $owner->id,
                        ];

                        try {
                            $method = $k % 5 === 0 ? 'card' : 'cash';
                            $due = $this->priceIt($sale, $line);
                            if ($due === null) {
                                // Ask again WITHOUT the probe's safety net, so
                                // the reason reaches the refusal tally. A
                                // generic "could not price" hid 128 lines that
                                // were really "there is no petrol in this shop".
                                $sale->execute($line + ['payment_method' => 'cash', 'amount_paid' => 100_000_000]);

                                continue;
                            }

                            $s = $sale->execute($line + [
                                'payment_method' => $method,
                                // A card is charged the bill; only cash can
                                // give change back (CHANGE_WITHOUT_CASH).
                                'amount_paid' => $method === 'cash' ? ceil($due / 100) * 100 : $due,
                            ]);

                            $rung++;
                            // Read back rather than assumed: a line sent as
                            // `amount` has its litres worked out by the
                            // server, and the meter has to agree with THAT,
                            // not with what the fixture hoped it would be.
                            $litres += (float) $s->items()->get()->sum(
                                fn ($i) => (float) $i->quantity * (float) ($i->unit_factor ?? 1),
                            );
                        } catch (\Throwable $e) {
                            $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                        }
                    }

                    $soldPerNozzle[$nozzle->id] = round($litres, 3);
                }

                // ── The meters, and the two gaps ────────────────────
                $readings = [];
                /** @var array<string, float> $throughTank */
                $throughTank = [];

                foreach ($nozzles as $i => $nozzle) {
                    $sold = $soldPerNozzle[$nozzle->id] ?? 0.0;

                    // Litres pumped and tipped back into the tank to check a
                    // hose. They moved the meter and were never sold, so a
                    // shift that ignored them reads as theft every morning.
                    $test = $d % 4 === 0 && $i === 0 ? 5.0 : 0.0;

                    // UNBILLED AT THE PUMP. One attendant's nozzle runs a
                    // little ahead of the till on two days of the week.
                    $unbilled = ($d % 7 === 3 && $i === 1) ? round(random_int(100, 600) / 100, 3) : 0.0;

                    $through = round($sold + $test + $unbilled, 3);
                    $readings[] = [
                        'fuel_nozzle_id' => $nozzle->id,
                        'closing_reading' => round((float) $nozzle->fresh()->current_reading + $through, 3),
                        'test_litres' => $test,
                    ];
                    $throughTank[$nozzle->fuel_tank_id] = round(($throughTank[$nozzle->fuel_tank_id] ?? 0) + $through - $test, 3);
                }

                // MISSING FROM THE GROUND. A different question from the one
                // above and never added to it: one tank is a few litres light
                // against its book stock on one day of the week.
                $dips = [];
                foreach ($tanks as $tank) {
                    $fresh = $tank->fresh();
                    $expected = max(0.0, round((float) $fresh->current_dip_litres - ($throughTank[$tank->id] ?? 0), 3));
                    $loss = ($d % 7 === 5 && $tank->is($charted)) ? round(random_int(200, 900) / 100, 3) : 0.0;

                    $dips[] = [
                        'fuel_tank_id' => $tank->id,
                        'closing_dip' => max(0.0, round($expected - $loss, 3)),
                    ];
                }

                try {
                    $closeShift->execute($owner, $shift, [
                        'readings' => $readings,
                        'dips' => $dips,
                        'notes' => 'Handover',
                    ]);
                    $closed++;
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }

                try {
                    $fresh = $session->fresh();
                    $closeTill->execute($fresh, (float) DrawerMath::for($fresh)['expected_cash'], 'Handover', $owner->id, [
                        'declared_tenders' => DrawerMath::for($fresh)['tender_mix'],
                    ]);
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }

                Carbon::setTestNow();
                CarbonImmutable::setTestNow();
            }
        }

        app(BranchContext::class)->clear();
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        $this->line("  forecourt  {$plant} items of plant · {$shifts} shifts ({$closed} closed) · {$deliveries} tankers · {$rung} fuel sales");
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * PAPERWORK BEFORE A BILL — and, in a workshop, a car in a bay.
     *
     * Every shop in this file could sell. None of them could QUOTE, and the
     * audit reported `sale_documents` empty on all seven — which read as a
     * missing feature and was a missing fixture. A price given and not yet
     * taken is a different row from a sale, and three of the nine trades here
     * run on it.
     *
     * For a workshop it is more than paperwork: `sale_documents` is also the
     * BAY BOARD. A job card is a third kind of document carrying four extra
     * columns and one genuinely new idea — `work_status` answers *where is
     * this car right now*, independently of whether the document is still
     * open. A job card that is `ready` is still `open` until somebody pays,
     * and folding the two together would lose the board.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     * @param  Customer[]  $customers
     */
    private function thePaperwork(
        Tenant $tenant,
        string $type,
        User $owner,
        array $branches,
        array $productIds,
        array $customers,
    ): void {
        if (($tenant->features['documents'] ?? false) !== true || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $write = app(CreateSaleDocumentAction::class);
        $deposit = app(RecordDepositAction::class);
        $convert = app(ConvertSaleDocumentAction::class);
        $isWorkshop = $type === 'automotive';

        $quotes = 0;
        $layaways = 0;
        $jobs = 0;
        $converted = 0;
        $cancelled = 0;
        $vehicles = 0;
        $claims = 0;
        /** @var array<string, int> $why */
        $why = [];

        // ── The cars ────────────────────────────────────────────────
        // A workshop's records are worth something only because a year later
        // somebody can ask what was done to THIS registration. Without the
        // vehicle the answer is a customer name and a guess.
        /** @var CustomerVehicle[] $fleet */
        $fleet = [];
        if ($isWorkshop) {
            $makes = [
                ['Suzuki', 'Mehran', '145/80 R12'], ['Toyota', 'Corolla', '195/65 R15'],
                ['Honda', 'City', '185/60 R15'], ['Suzuki', 'Cultus', '165/65 R14'],
                ['Suzuki', 'Alto', '145/80 R13'], ['Toyota', 'Vitz', '175/65 R15'],
                ['Honda', 'Civic', '215/55 R16'], ['Daihatsu', 'Mira', '155/65 R14'],
                ['KIA', 'Picanto', '175/65 R14'], ['Changan', 'Alsvin', '195/55 R16'],
            ];

            foreach (array_slice($customers, 0, 150) as $i => $customer) {
                [$make, $model, $tyre] = $makes[$i % count($makes)];
                $fleet[] = CustomerVehicle::withoutTenancy()->create([
                    'tenant_id' => $tenant->id,
                    'customer_id' => $customer->id,
                    'registration' => ['LEA', 'LEB', 'LZA', 'AJV'][$i % 4].'-'.random_int(1000, 9999),
                    'make' => $make,
                    'model' => $model,
                    'year' => (string) random_int(2004, 2024),
                    'colour' => ['White', 'Silver', 'Black', 'Grey', 'Blue'][$i % 5],
                    'tyre_size' => $tyre,
                    'engine_no' => strtoupper(Str::random(3)).random_int(100000, 999999),
                    'chassis_no' => strtoupper(Str::random(4)).random_int(1000000, 9999999),
                    'odometer' => random_int(18000, 240000),
                    'odometer_at' => now()->subDays(random_int(1, 400)),
                    'is_active' => true,
                    'created_by' => $owner->id,
                ]);
                $vehicles++;
            }
        }

        $branch = $branches[0];
        app(BranchContext::class)->set($branch);

        $complaints = [
            'Noise from front left when braking',
            'Car pulls to the right above 60',
            'AC cools only when moving',
            'Engine misfires on cold start',
            'Clutch slipping in third',
            'Battery flat every second morning',
            'Steering vibration at speed',
            'Smoke from exhaust after idling',
        ];

        foreach (range(1, 90) as $n) {
            $customer = $customers === [] ? null : $customers[($n * 7) % count($customers)];
            $lines = [];
            foreach (range(1, random_int(1, 4)) as $l) {
                $pick = $productIds[array_rand($productIds)];
                $lines[] = [
                    'product_id' => $pick['product_id'],
                    'variant_id' => $pick['variant_id'],
                    'quantity' => random_int(1, 3),
                ];
            }

            // Two kinds for everybody, three for a workshop. The split is not
            // decorative: a quotation takes no money and expires, a layaway
            // must have a customer, and a job card has a car.
            $kind = $isWorkshop
                ? [SaleDocument::KIND_JOB_CARD, SaleDocument::KIND_JOB_CARD, SaleDocument::KIND_QUOTATION, SaleDocument::KIND_LAYAWAY][$n % 4]
                : [SaleDocument::KIND_QUOTATION, SaleDocument::KIND_QUOTATION, SaleDocument::KIND_LAYAWAY][$n % 3];

            $payload = [
                'kind' => $kind,
                'items' => $lines,
                'customer_id' => $customer?->id,
                'notes' => 'Counter',
            ];

            if ($kind === SaleDocument::KIND_JOB_CARD && $fleet !== []) {
                $car = $fleet[($n * 3) % count($fleet)];
                $payload += [
                    'vehicle_id' => $car->id,
                    // The reading when it came IN — not the one on the
                    // invoice, which is taken when it goes out. A car in the
                    // bay for a week with a road test has two numbers.
                    'odometer_in' => (int) $car->odometer + random_int(50, 900),
                    'complaint' => $complaints[$n % count($complaints)],
                    'promised_at' => now()->addDays(random_int(1, 4))->setTime(17, 0),
                    // A BOARD NEEDS ALL THREE COLUMNS OCCUPIED. Seeding every
                    // card as `received` would leave two thirds of the bay
                    // board empty and the sort between them unexercised.
                    'work_status' => [
                        SaleDocument::WORK_RECEIVED,
                        SaleDocument::WORK_IN_PROGRESS,
                        SaleDocument::WORK_READY,
                    ][$n % 3],
                ];
            }

            if ($kind === SaleDocument::KIND_LAYAWAY && $customer === null) {
                continue;
            }

            /**
             * GOODS COME OFF THE SHELF WHEN THE FIRST MONEY LANDS.
             *
             * A layaway is refused outright without its down payment — "This
             * shop asks for at least 20% down" — and the first run of this
             * phase built sixty quotations and not one layaway because the
             * advance was being added AFTER the document was written. It is
             * part of writing it: the deposit is what makes the arrangement
             * an arrangement rather than a price.
             */
            if ($kind === SaleDocument::KIND_LAYAWAY) {
                $payload['deposit'] = [
                    'amount' => max(1.0, round($this->documentValue($lines) * 0.35, 2)),
                    'method' => ['cash', 'card', 'wallet'][$n % 3],
                    'note' => 'Advance',
                ];
            }

            try {
                $doc = $write->execute($payload);
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                continue;
            }

            match ($kind) {
                SaleDocument::KIND_JOB_CARD => $jobs++,
                SaleDocument::KIND_LAYAWAY => $layaways++,
                default => $quotes++,
            };

            // An advance against the parts the shop is about to order. A
            // quotation takes nothing — it is a price, not an arrangement.
            if ($kind !== SaleDocument::KIND_QUOTATION && $n % 2 === 0) {
                try {
                    $deposit->execute($doc, [
                        'amount' => round((float) $doc->total * 0.3, 2),
                        'method' => ['cash', 'card', 'wallet'][$n % 3],
                        'note' => 'Advance',
                    ]);
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }
            }

            // THE CAR IS COLLECTED. Roughly half convert, a few are
            // cancelled, and the rest stay OPEN — which is the state the bay
            // board and the quotation list are both drawn from, so a fixture
            // that converted everything would leave both screens empty.
            if ($n % 5 === 0) {
                try {
                    DB::table('sale_documents')->where('id', $doc->id)->update([
                        'status' => SaleDocument::STATUS_CANCELLED,
                        'cancelled_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $cancelled++;
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }

                continue;
            }

            if ($n % 2 === 1) {
                try {
                    $live = $doc->fresh();
                    $due = round((float) $live->total - (float) $live->deposit_paid, 2);
                    $convert->execute($live, [
                        'payment_method' => 'cash',
                        'amount_paid' => $due,
                        'created_by' => $owner->id,
                    ]);
                    $converted++;
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }
            }
        }

        // ── What came back under warranty ───────────────────────────
        if ($isWorkshop) {
            $claims = $this->warrantyDesk($tenant, $owner, $branch, $productIds, $why);
        }

        app(BranchContext::class)->clear();

        $this->line(
            "  paperwork  {$quotes} quotes · {$layaways} layaways · {$jobs} job cards"
            .($vehicles > 0 ? " · {$vehicles} vehicles" : '')
            ." · {$converted} became sales, {$cancelled} cancelled"
            .($claims > 0 ? " · {$claims} warranty claims" : '')
        );
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * WHAT WILL THESE LINES COME TO — asked of the server, not guessed.
     *
     * A layaway's minimum advance is a percentage of the TOTAL, which carries
     * tax, group pricing and any ladder the shop has set. The fixture cannot
     * work that out; only `CreateSaleDocumentAction` can, and it refuses the
     * document if the guess is a rupee short.
     *
     * So a quotation is written for the same lines, read, and rolled back —
     * the same shape as `priceIt()` at the till, and for the same reason: the
     * price has to stay the product's answer rather than the seeder's.
     *
     * @param  array<int, array<string, mixed>>  $lines
     */
    private function documentValue(array $lines): float
    {
        DB::beginTransaction();

        try {
            $probe = app(CreateSaleDocumentAction::class)->execute([
                'kind' => SaleDocument::KIND_QUOTATION,
                'items' => $lines,
            ]);

            return round((float) $probe->total, 2);
        } catch (\Throwable $e) {
            return 0.0;
        } finally {
            DB::rollBack();
        }
    }

    /**
     * A SERIAL IS THE ONLY THING A WARRANTY CAN HANG ON.
     *
     * A claim points at `sale_item_serials`, so this cannot be seeded by
     * writing claim rows: the battery has to be given a serial, sold with
     * that serial captured at the counter, and only then can it come back.
     * Every shortcut round that would also skip the one rule worth testing —
     * that the desk works out whether the unit was still covered from the
     * sale, and does not take the customer's word for it.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     * @param  array<string, int>  $why
     */
    private function warrantyDesk(Tenant $tenant, User $owner, Branch $branch, array $productIds, array &$why): int
    {
        $sale = app(CreateSaleAction::class);

        // Things that carry a guarantee and a number stamped on them. Picked
        // off the catalogue rather than created, so they already have stock,
        // a cost and a supplier behind them.
        /**
         * THE ONES ALREADY CARDED AS SERIALISED — not a fresh set marked now.
         *
         * Marking products here was the fixture's own bug: `product_serials`
         * is written at goods-in, so a product that becomes serialised after
         * its deliveries were booked has an empty registry for ever while its
         * sales happily record serials. Units sold that were never received.
         * The catalogue marks them now, before the first purchase order.
         */
        $serialised = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->where('tracks_serial', true)
            ->inRandomOrder()
            ->limit(24)
            ->get();

        $claims = 0;
        $sold = [];

        foreach ($serialised as $i => $product) {
            // SELL A UNIT THE SHOP ACTUALLY HAS. `CreateSaleAction` checks the
            // registry: a serial that was formally RECEIVED can only be sold
            // if it is still in stock, so inventing one here would either be
            // refused or — worse — quietly sell a unit nobody booked in.
            $held = DB::table('product_serials')
                ->where('product_id', $product->id)
                ->where('status', 'in_stock')
                ->value('serial');

            if ($held === null) {
                continue;
            }

            $serial = $held;
            $line = [
                'branch_id' => $branch->id,
                'channel' => 'walk_in',
                'items' => [[
                    'product_id' => $product->id,
                    'quantity' => 1,
                    'serials' => [$serial],
                ]],
                'created_by' => $owner->id,
            ];

            try {
                $due = $this->priceIt($sale, $line);
                if ($due === null) {
                    throw new \RuntimeException('could not price the serialised line');
                }
                $s = $sale->execute($line + ['payment_method' => 'cash', 'amount_paid' => ceil($due / 100) * 100]);
                $sold[] = [$s, $serial, $product];
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        foreach ($sold as $i => [$s, $serial, $product]) {
            // Only some come back. A desk where every unit sold has a claim
            // against it is not a warranty desk, it is a recall.
            if ($i % 3 !== 0) {
                continue;
            }

            $row = DB::table('sale_item_serials')
                ->where('sale_id', $s->id)
                ->where('serial', $serial)
                ->first();

            if ($row === null) {
                continue;
            }

            $expires = $row->warranty_expires_at;
            // WAS IT STILL COVERED. Worked out from the sale, never asked of
            // the customer — and deliberately false on some rows, because a
            // desk that has only ever seen valid claims has never run the
            // branch that matters.
            $covered = $expires === null ? false : Carbon::parse($expires)->isFuture();

            DB::table('warranty_claims')->insert([
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'branch_id' => $branch->id,
                'sale_item_serial_id' => $row->id,
                'serial' => $serial,
                'product_name' => $product->name,
                'fault' => ['Will not hold charge', 'Leaking', 'Noisy under load', 'Stopped working'][$i % 4],
                'customer_name' => 'Walk-in',
                'customer_phone' => '0300'.random_int(1000000, 9999999),
                'was_under_warranty' => $covered,
                'warranty_expires_at' => $expires,
                'resolution' => $i % 2 === 0 ? ($covered ? 'replaced' : 'rejected') : null,
                'resolved_at' => $i % 2 === 0 ? now() : null,
                'resolved_by' => $i % 2 === 0 ? $owner->id : null,
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $claims++;
        }

        return $claims;
    }

    /**
     * THE OTHER DOOR — orders that arrive without anybody walking in.
     *
     * The audit reported `orders` empty on every shop, which read as a dead
     * module and was a shop that had never been switched on: `shop()` set
     * `online_shop_enabled`, and `Tenant::sellsOnline()` wants that AND the
     * marketplace module. The tenant's own docblock warns about this exact
     * pair — "the module went on and the shop stayed invisible" — and the
     * fixture walked straight into it.
     *
     * What this phase is really here for is the COD leg. An online order is
     * not finished when the sale is written: a rider carried the goods out
     * and carried the notes back, and until somebody presses Settle the
     * shop's takings are in a pocket. Nothing in this fixture had ever
     * produced a rider holding money.
     *
     * The riders here have NO APP. That is Model A, the documented design on
     * `assignRider()`, and the shape nearly every Pakistani shop runs: a name
     * and a phone number, the shop drives the status itself.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    private function theOnlineDoor(Tenant $tenant, User $owner, array $branches, array $productIds): void
    {
        if (! $tenant->fresh()->sellsOnline() || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $orders = app(OrderService::class);
        $riders = app(RiderService::class);
        $branch = $branches[0];
        app(BranchContext::class)->set($branch);

        /** @var Rider[] $fleet */
        $fleet = [];
        foreach ([['Bilal', '03001234501'], ['Usman', '03001234502'], ['Adnan', '03001234503']] as [$name, $phone]) {
            $fleet[] = Rider::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'name' => $name,
                'phone' => $phone,
                'is_active' => true,
                'created_by' => $owner->id,
            ]);
        }

        $placed = 0;
        $completed = 0;
        $cancelled = 0;
        $openAt = [];
        /** @var array<string, int> $why */
        $why = [];

        foreach (range(1, 120) as $n) {
            $lines = [];
            foreach (range(1, random_int(1, 3)) as $l) {
                $pick = $productIds[array_rand($productIds)];
                $lines[] = [
                    'product_id' => $pick['product_id'],
                    'variant_id' => $pick['variant_id'],
                    'quantity' => random_int(1, 2),
                ];
            }

            // A COLLECTION IS NOT A DELIVERY. One in four is picked up at the
            // counter, which is the leg with no rider, no fee and no cash in
            // anybody's pocket — and the one most likely to be broken by a
            // change made for the delivery leg.
            $pickup = $n % 4 === 0;
            $cod = $n % 3 !== 0;

            try {
                $order = $orders->place(
                    customer: null,
                    shop: $tenant,
                    data: [
                        'channel' => ['phone', 'whatsapp'][$n % 2],
                        'customer_name' => 'Caller '.$n,
                        'customer_phone' => '0321'.str_pad((string) (1000000 + $n), 7, '0', STR_PAD_LEFT),
                        'fulfillment_type' => $pickup ? 'pickup' : 'delivery',
                        'delivery_address' => $pickup ? null : 'House '.$n.', Johar Town, Lahore',
                        'payment_method' => $cod ? 'cod' : 'paid',
                        'items' => $lines,
                    ],
                    staff: $owner,
                );
                $placed++;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                continue;
            }

            // ONE IN SEVEN NEVER LEAVES. A shop that completed every order it
            // ever took has no refusals to show, no released stock, and an
            // Orders screen whose Cancelled tab is a blank page.
            if ($n % 7 === 0) {
                try {
                    $orders->cancel($order, 'Customer changed their mind');
                    $cancelled++;
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }

                continue;
            }

            // THE BOARD NEEDS EVERY COLUMN. A fifth of the orders are parked
            // part-way, because the Orders screen is a queue and a queue with
            // nothing in it is not a queue.
            $stopAt = $n % 5;
            $path = $pickup
                ? ['confirmed', 'preparing', 'ready', 'completed']
                : ['confirmed', 'preparing', 'out_for_delivery', 'completed'];

            if (! $pickup) {
                try {
                    $orders->assignRider($order, $fleet[$n % count($fleet)]);
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }
            }

            $walked = $stopAt === 0 ? count($path) - 1 : count($path);
            foreach (array_slice($path, 0, $walked) as $step) {
                try {
                    $order = $orders->advance($order->fresh(), OrderStatus::from($step));
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                    break;
                }
            }

            $final = $order->fresh()->status->value;
            if ($final === 'completed') {
                $completed++;
            } else {
                $openAt[$final] = ($openAt[$final] ?? 0) + 1;
            }
        }

        // ── The money that came back on a bike ──────────────────────
        $settled = 0;
        $heldBack = 0;
        $emptyHanded = 0;
        foreach ($fleet as $i => $card) {
            // NOT EVERY RIDER HANDS IT ALL IN. The last one is left holding
            // the day's cash, because "nothing outstanding" is the only state
            // the riders screen has ever been seeded in and the figure that
            // matters is the one beside a rider who still has it.
            if ($i === count($fleet) - 1) {
                $heldBack++;

                continue;
            }

            try {
                $riders->settle($tenant, $card, $owner, null, 'Evening handover');
                $settled++;
            } catch (\Throwable $e) {
                // A rider whose round happened to be all prepaid is holding
                // nothing, and the server saying so is the correct answer —
                // not a refusal worth reporting in red beside the real ones.
                if ($e instanceof DomainException && $e->errorCode === 'RIDER_NOTHING_TO_SETTLE') {
                    $emptyHanded++;

                    continue;
                }

                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        app(BranchContext::class)->clear();

        $still = [];
        foreach ($openAt as $status => $count) {
            $still[] = "{$count} {$status}";
        }

        $this->line(
            "  online     {$placed} orders · {$completed} completed · {$cancelled} cancelled"
            .($still === [] ? '' : ' · still '.implode(', ', $still))
            ." · {$settled} riders settled, {$heldBack} still holding"
            .($emptyHanded > 0 ? ", {$emptyHanded} carried nothing" : '')
        );
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * THE DINING ROOM, WITH PEOPLE IN IT.
     *
     * Sixty tables had been seeded since this fixture was written and not one
     * of them had ever been sat at: `restaurant_tickets` was empty on every
     * run, and so was the kitchen pass. A floor plan with no tabs on it is a
     * screen, not a service.
     *
     * A tab is not a sale until it is settled, and almost everything that can
     * go wrong lives in between:
     *
     *   the ORDER goes on in rounds, not all at once
     *   the KITCHEN is fired per round, and each docket belongs to a station
     *   the TABLE is occupied the whole time, and a second tab on it is wrong
     *   the BILL may be split, and a partial settlement leaves the rest open
     *
     * So this phase leaves tabs in every one of those states, including open
     * ones: a floor where every table has been settled and cleared is a floor
     * at closing time, and the screen a restaurant actually looks at is the
     * one at eight in the evening.
     *
     * @param  Branch[]  $branches
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $dishes
     */
    /**
     * HOW A TABLE PAYS, WITHOUT KNOWING WHAT THE TABLE OWES.
     *
     * A `restaurant_tickets` row carries no running total — the bill is
     * derived from its unsettled lines at the moment of settling, which is
     * correct and is why the first version of this phase tendered 0.00 on
     * every card and had every settlement refused.
     *
     * So the fixture tenders the way a counter does rather than the way an
     * integration does: notes, with change coming back. A card line is
     * carried as part of a SPLIT, where its amount is a figure somebody
     * actually names ("put five hundred on the card, rest in cash") and the
     * cash line absorbs whatever the bill turns out to be — which is also
     * the only honest way to get a card tender onto a bill of unknown size.
     *
     * @return array<string, mixed>
     */
    private function tender(int $n): array
    {
        if ($n % 3 !== 0) {
            return ['payment_method' => 'cash', 'amount_paid' => 1_000_000];
        }

        return ['payments' => [
            ['method' => 'card', 'amount' => 500],
            ['method' => 'cash', 'amount' => 1_000_000],
        ]];
    }

    private function theDiningRoom(Tenant $tenant, User $owner, array $branches, array $dishes): void
    {
        if (($tenant->features['dine_in'] ?? false) !== true || $dishes === []) {
            return;
        }

        auth()->setUser($owner);
        $open = app(OpenTicketAction::class);
        $add = app(AddTicketItemsAction::class);
        $fire = app(FireKitchenTicketAction::class);
        $settle = app(SettleTicketAction::class);
        [$mustChoose] = $this->modifierRules($tenant);

        $opened = 0;
        $rounds = 0;
        $fired = 0;
        $settled = 0;
        $split = 0;
        $stillOut = 0;
        /** @var array<string, int> $why */
        $why = [];

        foreach ($branches as $branch) {
            app(BranchContext::class)->set($branch);

            $tables = DB::table('dining_tables')
                ->where('tenant_id', $tenant->id)
                ->where('branch_id', $branch->id)
                ->pluck('id')
                ->all();

            if ($tables === []) {
                continue;
            }

            foreach ($tables as $i => $tableId) {
                /**
                 * ONE TAB PER TABLE AT A TIME — the server says so, and it is
                 * right. So a table is used, settled, and only then used
                 * again; the last few are left OCCUPIED on purpose.
                 */
                $sittings = $i % 5 === 0 ? 1 : 2;

                for ($s = 0; $s < $sittings; $s++) {
                    $leaveOpen = $s === $sittings - 1 && $i % 4 === 0;

                    try {
                        $ticket = $open->execute([
                            'order_type' => 'dine_in',
                            'dining_table_id' => $tableId,
                            'guest_count' => random_int(2, 6),
                            'customer_name' => $i % 3 === 0 ? 'Walk-in' : null,
                        ]);
                        $opened++;
                    } catch (\Throwable $e) {
                        $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                        continue;
                    }

                    // ── The rounds ──────────────────────────────────
                    // Starters, then mains, then somebody asks for one more
                    // naan. A tab built in a single call has never tested the
                    // thing a tab is FOR.
                    foreach (range(1, random_int(2, 3)) as $round) {
                        $items = $this->basket('food', $dishes, $mustChoose, random_int(1, 3));

                        try {
                            $add->execute($ticket->fresh(), ['items' => $items]);
                            $rounds++;
                        } catch (\Throwable $e) {
                            $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                            continue;
                        }

                        // THE KITCHEN IS TOLD PER ROUND. Firing the whole tab
                        // at the end is how a cold starter reaches a table.
                        try {
                            $fire->execute($ticket->fresh());
                            $fired++;
                        } catch (\Throwable $e) {
                            $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                        }
                    }

                    if ($leaveOpen) {
                        $stillOut++;

                        break;
                    }

                    // ── The bill ────────────────────────────────────
                    $live = $ticket->fresh();
                    // A line is BILLED when it carries a sale_id, and VOID
                    // when it carries a voided_at. There is no `settled_at`
                    // and no `is_void` — the ticket keeps both facts as the
                    // things that caused them.
                    $lines = DB::table('restaurant_ticket_items')
                        ->where('ticket_id', $live->id)
                        ->whereNull('sale_id')
                        ->whereNull('voided_at')
                        ->pluck('id')
                        ->all();

                    if ($lines === []) {
                        continue;
                    }

                    try {
                        // ONE TABLE IN SIX SPLITS THE BILL, and a split
                        // settlement leaves the rest of the tab open — which
                        // is a state nothing in this fixture had ever
                        // produced and the one most likely to be wrong.
                        if ($i % 6 === 0 && count($lines) > 1) {
                            $half = array_slice($lines, 0, (int) ceil(count($lines) / 2));
                            $settle->execute($live, $this->tender($i) + [
                                'item_ids' => $half,
                                'tip_amount' => $i % 12 === 0 ? 200 : 0,
                            ]);
                            $split++;

                            $rest = DB::table('restaurant_ticket_items')
                                ->where('ticket_id', $live->id)
                                ->whereNull('sale_id')->whereNull('voided_at')
                                ->pluck('id')->all();

                            if ($rest !== []) {
                                $settle->execute($ticket->fresh(), $this->tender($i + 1) + [
                                    'item_ids' => $rest,
                                ]);
                            }
                        } else {
                            $settle->execute($live, $this->tender($i) + [
                                'tip_amount' => $i % 7 === 0 ? 150 : 0,
                            ]);
                        }
                        $settled++;
                    } catch (\Throwable $e) {
                        $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                    }
                }
            }
        }

        app(BranchContext::class)->clear();

        $this->line(
            "  dining     {$opened} tabs · {$rounds} rounds · {$fired} kitchen fires"
            ." · {$settled} settled ({$split} split) · {$stillOut} still occupied"
        );
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * POINTS SPENT, NOT JUST EARNED.
     *
     * `loyalty_entries` had been filling up for weeks and every single row
     * was an `earn`. Nothing in this fixture had ever REDEEMED, which means
     * the half of the ledger that moves money — points become a discount,
     * the discount reduces the taxable base, and a later return has to give
     * the points BACK rather than the rupees — had never run on a shop with
     * real baskets in it.
     *
     * Earning is a side effect of selling. Spending is a decision at the
     * counter, and it is the one with the arithmetic in it.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     * @param  Branch[]  $branches
     */
    private function theReward(Tenant $tenant, string $type, User $owner, array $branches, array $productIds): void
    {
        if ((bool) $tenant->setting('loyalty_enabled', false) !== true || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $sale = app(CreateSaleAction::class);
        $branch = $branches[0];
        app(BranchContext::class)->set($branch);

        $minimum = (int) $tenant->setting('loyalty_min_redeem', 0);
        [$mustChoose] = $this->modifierRules($tenant);

        // Only customers who actually earned enough by shopping. Topping a
        // balance up by hand would make the redeem arithmetic agree with a
        // number the fixture invented rather than with the sales behind it.
        $rich = Customer::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('loyalty_points', '>=', max(1, $minimum))
            ->orderByDesc('loyalty_points')
            ->limit(40)
            ->get();

        $spent = 0;
        $points = 0;
        /** @var array<string, int> $why */
        $why = [];

        foreach ($rich as $i => $customer) {
            $held = (int) $customer->loyalty_points;

            // A SPREAD, not a single shape. Some spend the lot, most spend a
            // little, and one in five spends exactly the minimum — which is
            // the boundary the refusal is written against.
            $ask = match ($i % 5) {
                0 => $held,
                1 => max($minimum, (int) floor($held / 2)),
                default => $minimum,
            };

            if ($ask <= 0 || $ask > $held) {
                continue;
            }

            $line = [
                'branch_id' => $branch->id,
                'channel' => 'walk_in',
                'items' => $this->basket($type, $productIds, $mustChoose, random_int(1, 3)),
                'customer_phone' => $customer->phone,
                'customer_name' => $customer->name,
                'redeem_points' => $ask,
                'created_by' => $owner->id,
            ];

            try {
                $sale->execute($line + ['payment_method' => 'cash', 'amount_paid' => 500_000]);
                $spent++;
                $points += $ask;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        app(BranchContext::class)->clear();

        if ($spent > 0 || $why !== []) {
            $this->line("  rewards    {$spent} bills paid partly in points · {$points} points spent");
        }
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * THE BILLS THAT COME EVERY MONTH WHETHER ANYBODY TYPES THEM OR NOT.
     *
     * Rent, wages, the electricity bill, the shop's internet. A template
     * falls DUE and posts itself — which is a different thing from an
     * expense somebody keyed, and the audit had been reporting both
     * recurring tables empty since they were built.
     *
     * Three states on purpose, because they are three different screens:
     *
     *   DUE LATER   the ordinary one — a template waiting for its date
     *   OVERDUE     a date that has passed and nobody posted; the shop's
     *               books are understated by exactly that much and the
     *               only thing that says so is this row
     *   POSTED      run through `PostRecurringExpenseAction`, so the
     *               expense exists AND the template has rolled forward
     *
     * Posting through the action rather than writing both rows is the whole
     * point: the roll-forward arithmetic — this month's due date becomes
     * next month's — is the part that can be wrong.
     *
     * @param  Branch[]  $branches
     */
    private function theStandingOrders(Tenant $tenant, User $owner, array $branches): void
    {
        if (($tenant->features['expenses'] ?? false) !== true) {
            return;
        }

        auth()->setUser($owner);
        $branch = $branches[0];
        app(BranchContext::class)->set($branch);

        $outs = [
            ['Shop rent', 180000, 'monthly'],
            ['Electricity bill', 46000, 'monthly'],
            ['Staff wages', 320000, 'monthly'],
            ['Internet', 6500, 'monthly'],
            ['Security guard', 28000, 'monthly'],
            ['Municipal fee', 15000, 'quarterly'],
            ['Shop insurance', 90000, 'yearly'],
            ['Water tanker', 4500, 'weekly'],
        ];
        $ins = [
            ['Sublet rent — first floor', 35000, 'monthly'],
            ['Signboard rental', 12000, 'monthly'],
            ['Scrap contract', 9000, 'quarterly'],
        ];

        $made = 0;
        $overdue = 0;
        $posted = 0;
        /** @var array<string, int> $why */
        $why = [];

        $catColumn = [
            'recurring_expenses' => ['expense_category_id', 'expense_categories'],
            'recurring_incomes' => ['income_category_id', 'income_categories'],
        ];

        foreach ([['recurring_expenses', $outs], ['recurring_incomes', $ins]] as [$table, $list]) {
            [$column, $catTable] = $catColumn[$table];

            // The heading this bill files itself under, every month, without
            // anybody choosing again. A recurring row REQUIRES one — which is
            // how the fixture discovered that no shop here had any.
            $categories = DB::table($catTable)->where('tenant_id', $tenant->id)->pluck('id')->all();

            if ($categories === []) {
                continue;
            }

            foreach ($list as $i => [$what, $amount, $frequency]) {
                // One in three is already past its date and unposted. That is
                // not an error state, it is Tuesday — and it is the only
                // reading the shop has that its books are short.
                $late = $i % 3 === 0;

                DB::table($table)->insert([
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'branch_id' => $branch->id,
                    'description' => $what,
                    $column => $categories[$i % count($categories)],
                    'amount' => $amount,
                    'payment_method' => $i % 2 === 0 ? 'bank_transfer' : 'cash',
                    'frequency' => $frequency,
                    'next_due_on' => $late
                        ? now()->subDays(random_int(2, 20))->toDateString()
                        : now()->addDays(random_int(3, 25))->toDateString(),
                    'is_active' => $i !== count($list) - 1,
                    'created_by' => $owner->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $made++;
                $late && $overdue++;
            }
        }

        // ── And some of them actually posted ────────────────────────
        $post = app(PostRecurringExpenseAction::class);
        foreach (RecurringExpense::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->whereDate('next_due_on', '<=', now())
            ->get() as $template) {
            try {
                $post->execute($owner, $template);
                $posted++;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        $postIn = app(PostRecurringIncomeAction::class);
        foreach (RecurringIncome::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->whereDate('next_due_on', '<=', now())
            ->get() as $template) {
            try {
                $postIn->execute($owner, $template);
                $posted++;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        app(BranchContext::class)->clear();

        $this->line("  standing   {$made} templates ({$overdue} were overdue) · {$posted} posted themselves");
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * PEOPLE WHO SHOP FROM A PHONE.
     *
     * Everything in this fixture so far is somebody standing at a counter or
     * ringing the shop. A marketplace customer is a different kind of row
     * entirely — a USER, not a `customers` record — and without one, four
     * tables stay empty and so does the only path that bills the platform:
     *
     *   customer_addresses   where the rider is actually going
     *   reviews              what the shop's rating is made of
     *   orders.channel=online  the one channel commission is charged on
     *   commission_charges   the platform's own revenue
     *
     * The counter-taken orders seeded elsewhere are `phone` and `whatsapp`,
     * and `CommissionService` refuses them by design: if the marketplace did
     * not bring the customer, there is no commission on the sale. So the
     * platform's books were empty for the right reason and the wrong one —
     * nothing had ever come through the door it bills for.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    private function theShoppers(Tenant $tenant, User $owner, array $productIds, City $city): void
    {
        if (! $tenant->fresh()->sellsOnline() || $productIds === []) {
            return;
        }

        $orders = app(OrderService::class);
        $reviews = app(ReviewService::class);

        $placed = 0;
        $completed = 0;
        $reviewed = 0;
        $replied = 0;
        $addresses = 0;
        /** @var array<string, int> $why */
        $why = [];

        $areas = [
            ['Home', 'House 14, Street 7, Johar Town'],
            ['Work', 'Office 3, Main Boulevard, Gulberg'],
            ['Mum’s', 'House 88, Block C, Model Town'],
        ];

        foreach (range(1, 40) as $n) {
            $shopper = User::factory()->create([
                'name' => 'Shopper '.$n.' of '.Str::limit($tenant->business_name, 14, ''),
                'email' => Str::slug($tenant->slug)."-shopper{$n}@example.test",
                'phone' => '0345'.str_pad((string) (1000000 + $n), 7, '0', STR_PAD_LEFT),
            ]);

            // A PHONE HAS MORE THAN ONE ADDRESS ON IT. Home and work is the
            // ordinary case, and "which one is default" is a question that
            // only exists once there are two.
            foreach (array_slice($areas, 0, $n % 3 === 0 ? 2 : 1) as $k => [$label, $line]) {
                DB::table('customer_addresses')->insert([
                    'id' => (string) Str::uuid7(),
                    'user_id' => $shopper->id,
                    'label' => $label,
                    'address' => $line,
                    'city_id' => $city->id,
                    'is_default' => $k === 0,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                $addresses++;
            }

            auth()->setUser($shopper);
            $lines = [];
            foreach (range(1, random_int(1, 3)) as $l) {
                $pick = $productIds[array_rand($productIds)];
                $lines[] = [
                    'product_id' => $pick['product_id'],
                    'variant_id' => $pick['variant_id'],
                    'quantity' => random_int(1, 2),
                ];
            }

            try {
                // No pin on the address. A typed address with no coordinates
                // is deliberately NOT refused by the radius check — the shop
                // reads it and decides — and that is the ordinary case for
                // somebody who typed their street rather than dropping a
                // marker.
                $order = $orders->place(
                    customer: $shopper,
                    shop: $tenant,
                    data: [
                        'fulfillment_type' => $n % 4 === 0 ? 'pickup' : 'delivery',
                        'delivery_address' => $n % 4 === 0 ? null : $areas[0][1],
                        'payment_method' => $n % 3 === 0 ? 'paid' : 'cod',
                        'items' => $lines,
                    ],
                    staff: null,
                );
                $placed++;
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                continue;
            }

            auth()->setUser($owner);

            // Three in four are seen through. The rest are left mid-queue,
            // because an Orders screen whose every row is finished is a
            // screen nobody has to work.
            if ($n % 4 !== 1) {
                $path = $order->fulfillment_type->value === 'pickup'
                    ? ['confirmed', 'preparing', 'ready', 'completed']
                    : ['confirmed', 'preparing', 'out_for_delivery', 'completed'];

                foreach ($path as $step) {
                    try {
                        $order = $orders->advance($order->fresh(), OrderStatus::from($step));
                    } catch (\Throwable $e) {
                        $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                        break;
                    }
                }

                if ($order->fresh()->status === OrderStatus::Completed) {
                    $completed++;
                }
            }

            // ── What they thought of it ─────────────────────────────
            // Not everybody writes one, and the ones who do are not all
            // delighted: a shop whose every review is five stars has an
            // average nobody learns anything from, and the one-star replies
            // are the part of the screen that matters.
            if ($n % 3 === 0) {
                try {
                    $rating = [5, 5, 4, 3, 1][$n % 5];
                    $review = $reviews->upsert($shopper, $tenant, [
                        'rating' => $rating,
                        'comment' => [
                            5 => 'Fresh stock and quick delivery.',
                            4 => 'Good, but the rider took a while.',
                            3 => 'One item was missing from the bag.',
                            1 => 'Order arrived cold and nobody answered the phone.',
                        ][$rating] ?? null,
                    ]);
                    $reviewed++;

                    // A SHOP THAT ANSWERS. The reply box is the whole reason
                    // the owner can read these at all, and it had never been
                    // used in this world.
                    if ($rating <= 3) {
                        $reviews->reply($review, 'Sorry about that — please call us and we will put it right.');
                        $replied++;
                    }
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }
            }
        }

        auth()->setUser($owner);

        $charged = (int) DB::table('commission_charges')->where('tenant_id', $tenant->id)->count();

        $this->line(
            "  shoppers   40 accounts · {$addresses} addresses · {$placed} online orders"
            ." ({$completed} completed, {$charged} commissioned) · {$reviewed} reviews ({$replied} answered)"
        );
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    /**
     * THE BANK PAYS PART OF ITS OWN CARD'S BILL.
     *
     * A clothing shop runs "15% off on HBL credit cards, Fridays and
     * Saturdays, up to Rs 3,000". The bank funds it to put its card in the
     * customer's hand; the shop takes the full price less the bank's share.
     *
     * No fixture shop had the module, so `bank_card_offers` was empty, the
     * admin screen had never been opened on a row, and — more to the point —
     * no SALE had ever carried one. The whole question the feature answers
     * (which offer applies, to how much of the bill, capped at what) had
     * never been asked of a real basket.
     *
     * Only for the shops where it is true to life. A filling station's
     * margins do not survive a card promotion, and a mandi trader is paid in
     * cash and on account.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     * @param  Branch[]  $branches
     */
    /**
     * THE TABLETS ON THE COUNTER.
     *
     * `pos_devices` is the registry of machines allowed to sell — the thing
     * the offline window is measured against, the thing a lost tablet is
     * revoked from, and the thing `offline_days` reports on. It was empty on
     * every shop, so the usage figure that answers "you allow 3 days and one
     * of their tablets is at 5" has only ever had nought to report.
     *
     * Four states, because they are four different rows on that screen:
     *
     *   IN TOUCH   seen within the hour; the ordinary tablet
     *   A DAY OUT  inside the window, flagged and selling
     *   PAST IT    beyond the shop's offline_days — the one the figure is for
     *   REVOKED    stopped on purpose; NOT an outstanding device, and
     *              counting it as one would put a permanent red figure on a
     *              screen about tablets nobody is looking for
     *
     * The shadow counters carry real numbers too. A shop earns offline
     * selling by having its till price carts identically to the server for
     * long enough, and a registry of zeroes can never be read as "earned it"
     * or as "not yet".
     *
     * @param  Branch[]  $branches
     */
    private function theTills(Tenant $tenant, User $owner, array $branches): void
    {
        if (($tenant->features['pos'] ?? false) !== true) {
            return;
        }

        $registers = DB::table('registers')
            ->where('tenant_id', $tenant->id)
            ->get(['id', 'branch_id']);

        if ($registers->isEmpty()) {
            return;
        }

        $window = (int) ($tenant->limits['offline_days'] ?? 3);
        $made = 0;
        $outstanding = 0;

        foreach ($registers as $i => $register) {
            foreach ([0, 1] as $k) {
                $state = ($i * 2 + $k) % 4;

                $lastSeen = match ($state) {
                    0 => now()->subMinutes(random_int(2, 50)),
                    1 => now()->subDays(1)->subHours(random_int(1, 10)),
                    2 => now()->subDays($window + random_int(1, 3)),
                    default => now()->subDays(random_int(10, 40)),
                };

                $revoked = $state === 3;
                if ($state === 2) {
                    $outstanding++;
                }

                // A till that has priced thousands of carts and matched the
                // server every time is a till that has earned the window. One
                // that differed on a handful has not, and the difference has
                // to be visible as numbers rather than as a flag.
                $checked = $state === 3 ? 0 : random_int(400, 4000);
                $differed = $state === 2 ? random_int(1, 6) : 0;
                $skipped = (int) round($checked * 0.02);

                DB::table('pos_devices')->insert([
                    'id' => (string) Str::uuid7(),
                    'tenant_id' => $tenant->id,
                    'branch_id' => $register->branch_id,
                    'register_id' => $register->id,
                    'name' => ['Counter tablet', 'Back-up tablet'][$k],
                    // The device segment a slip number is built from. Server
                    // ALLOCATED, never four characters of a random uuid.
                    'code' => strtoupper(Str::random(4)),
                    'user_agent' => 'Mozilla/5.0 (Linux; Android 13) Chrome/120',
                    'platform' => 'android',
                    'last_seen_at' => $lastSeen,
                    'revoked_at' => $revoked ? now()->subDays(random_int(1, 9)) : null,
                    'revoked_by' => $revoked ? $owner->id : null,
                    'shadow_checked' => $checked,
                    'shadow_matched' => max(0, $checked - $differed - $skipped),
                    'shadow_skipped' => $skipped,
                    'shadow_differed' => $differed,
                    'shadow_since' => $checked > 0 ? now()->subDays(random_int(20, 90)) : null,
                    'created_at' => now()->subDays(random_int(30, 120)),
                    'updated_at' => now(),
                ]);
                $made++;
            }
        }

        $this->line("  tills      {$made} devices registered · {$outstanding} past the {$window}-day window");
    }

    private function theBanksOffer(Tenant $tenant, User $owner, array $branches, array $productIds): void
    {
        if (($tenant->features['bank_offers'] ?? false) !== true || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $branch = $branches[0];
        app(BranchContext::class)->set($branch);

        $banks = [];
        foreach ([['Habib Bank', 'HBL'], ['Meezan Bank', 'MEZN'], ['UBL', 'UBL']] as [$name, $code]) {
            $id = (string) Str::uuid7();
            DB::table('banks')->insert([
                'id' => $id, 'tenant_id' => $tenant->id, 'name' => $name,
                'short_code' => $code, 'is_active' => true,
                'created_by' => $owner->id, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $banks[$code] = $id;
        }

        /**
         * FOUR SHAPES, BECAUSE THE SERVICE HAS TO CHOOSE BETWEEN THEM.
         *
         * A shop with one offer never exercises `best()`. These overlap on
         * purpose — two HBL offers live at once — so the server has to pick,
         * and the one it picks has to be the one that helps the customer
         * most inside its own cap.
         */
        $offers = [
            ['HBL', 'HBL credit — 15% off, weekends', 'percent', 15, 3000, 3000, ['credit'], [5, 6]],
            ['HBL', 'HBL — flat Rs 500 over Rs 5,000', 'fixed', 500, 5000, null, ['credit', 'debit'], null],
            ['MEZN', 'Meezan — 10% off, any card', 'percent', 10, 2000, 1500, ['credit', 'debit'], null],
            // EXPIRED, and kept. A list that holds only live offers has never
            // shown the screen what a finished campaign looks like, and the
            // service has never had to leave one out.
            ['UBL', 'UBL Eid offer (ended)', 'percent', 20, 0, 5000, ['credit'], null],
        ];

        $made = 0;
        foreach ($offers as $i => [$bank, $label, $type, $value, $minSpend, $maxDiscount, $cards, $days]) {
            $ended = str_contains($label, 'ended');

            DB::table('bank_card_offers')->insert([
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'bank_id' => $banks[$bank],
                'label' => $label,
                'type' => $type,
                'value' => $value,
                'min_spend' => $minSpend,
                'max_discount' => $maxDiscount,
                'card_types' => json_encode($cards),
                'starts_on' => now()->subDays(60)->toDateString(),
                'ends_on' => $ended ? now()->subDays(20)->toDateString() : now()->addDays(90)->toDateString(),
                'days_of_week' => $days === null ? null : json_encode($days),
                'priority' => $i,
                'is_active' => true,
                'created_by' => $owner->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $made++;
        }

        // ── And some bills that actually took one ───────────────────
        $sale = app(CreateSaleAction::class);
        [$mustChoose] = $this->modifierRules($tenant);
        $taken = 0;
        $helped = 0.0;
        /** @var array<string, int> $why */
        $why = [];

        foreach (range(1, 30) as $n) {
            $line = [
                'branch_id' => $branch->id,
                'channel' => 'walk_in',
                'items' => $this->basket('retail', $productIds, $mustChoose, random_int(1, 3)),
                'bank_id' => $banks[['HBL', 'MEZN', 'UBL'][$n % 3]],
                'card_type' => $n % 4 === 0 ? 'debit' : 'credit',
                // PCI: the last four and nothing else, ever.
                'card_last4' => (string) random_int(1000, 9999),
                'created_by' => $owner->id,
            ];

            try {
                $due = $this->priceIt($sale, $line);
                if ($due === null) {
                    throw new \RuntimeException('could not price the basket');
                }

                $s = $sale->execute($line + ['payment_method' => 'card', 'amount_paid' => $due]);

                if ($s->bank_card_offer_id !== null) {
                    $taken++;
                    $helped += round((float) $due - (float) $s->total, 2);
                }
            } catch (\Throwable $e) {
                $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
            }
        }

        app(BranchContext::class)->clear();

        $this->line(
            "  bank cards {$made} offers across 3 banks · {$taken} of 30 bills took one"
            .($helped > 0 ? ' · '.number_format($helped, 2).' funded by the banks' : '')
        );
        foreach ($why as $message => $n) {
            $this->line("    refused ×{$n}  ".Str::limit($message, 92));
        }
    }

    private function theTill(Tenant $tenant, string $type, User $owner, array $branches, array $productIds): void
    {
        if (($tenant->features['pos'] ?? false) !== true || $productIds === []) {
            return;
        }

        auth()->setUser($owner);
        $sale = app(CreateSaleAction::class);
        $open = app(OpenCashSessionAction::class);
        $close = app(CloseCashSessionAction::class);
        $movement = app(RecordCashMovementAction::class);
        $day = app(CloseBusinessDayAction::class);
        [$mustChoose] = $this->modifierRules($tenant);

        $shifts = 0;
        $rung = 0;
        $short = 0;
        $over = 0;
        $exact = 0;
        /** @var array<string, int> $why */
        $why = [];

        foreach ($branches as $b => $branch) {
            app(BranchContext::class)->set($branch);

            $lane = Register::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branch->id,
                'name' => 'Lane 1',
                'code' => 'L1',
                'is_active' => true,
            ]);

            /**
             * SEVEN DAYS BEHIND, AND TODAY STILL RUNNING.
             *
             * `$d` reaches 0, and the last pass is deliberately NOT closed:
             * a shop is trading right now, and the Day & Banking screen opens
             * on its "Today" tab. Seeding only finished days left that tab —
             * the one a shopkeeper actually looks at — empty in a world of
             * ninety-one shifts, which a browser walk reported as a bug and
             * was simply a world where nobody had come in yet.
             *
             * An open shift under an open day is also the state the roll-up
             * refuses to close over, so the rule has something real to refuse.
             */
            for ($d = 7; $d >= 0; $d--) {
                // ONE OPEN SHIFT PER PERSON — the server says so
                // (SHIFT_ALREADY_OPEN), and it is right: a cashier cannot be
                // at two tills. So today is left running on the LAST branch
                // only; leaving it open on the first refused every shift of
                // every branch after it.
                $stillTrading = $d === 0 && $branch->is(end($branches));

                /**
                 * MOVE THE CLOCK, DO NOT BACKFILL THE ROWS.
                 *
                 * The first version opened a backdated day by hand and then
                 * opened a shift — and `OpenCashSessionAction` opens the day
                 * for ITSELF, on demand, with today's date, because "making
                 * the owner remember to start the day would strand a shop at
                 * 7am". So the shift joined today and the backdated day stood
                 * empty with a bank deposit hanging off it. The audit called
                 * it correctly: money banked on a day with no drawer.
                 *
                 * Travelling the clock makes every row downstream — the day,
                 * the shift, the sale, the movement, the slip — agree without
                 * a single `forceFill` after the fact, which is also the only
                 * way the arithmetic between them stays the product's and not
                 * the fixture's.
                 */
                $date = now()->subDays($d)->setTime(9, 0);
                if (! $stillTrading) {
                    CarbonImmutable::setTestNow($date);
                    Carbon::setTestNow($date);
                }

                try {
                    $book = $day->open($owner, $branch->id);
                    $session = $open->execute($owner, 10000, $lane);
                } catch (\Throwable $e) {
                    Carbon::setTestNow();
                    CarbonImmutable::setTestNow();
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;

                    continue;
                }

                // The sales of that day, rung INTO this drawer.
                $tookInCash = 0.0;
                foreach (range(1, random_int(8, 14)) as $k) {
                    $items = $this->basket($type, $productIds, $mustChoose, random_int(1, 3));

                    // Cash two times in three — the mix is what makes the
                    // declared-tender comparison mean anything. A card is
                    // charged the BILL: only cash can give change back, and
                    // the server refuses anything else (CHANGE_WITHOUT_CASH).
                    $method = $type === 'wholesale'
                        ? ($k % 3 === 0 ? 'cash' : ['card', 'bank_transfer'][$k % 2])
                        : ($k % 3 === 0 ? ['card', 'wallet'][$k % 2] : 'cash');
                    $line = [
                        'branch_id' => $branch->id,
                        'channel' => 'walk_in',
                        'items' => $items,
                        'cash_session_id' => $session->id,
                        'created_by' => $owner->id,
                    ];

                    try {
                        if ($method !== 'cash') {
                            $due = $this->priceIt($sale, $line);
                            if ($due === null) {
                                throw new \RuntimeException('could not price the basket');
                            }
                        }

                        $s = $sale->execute($line + [
                            'payment_method' => $method,
                            'amount_paid' => $method === 'cash' ? 250_000 : $due,
                        ]);
                        if ($method === 'cash') {
                            // What actually stayed in the drawer: the bill,
                            // less the change handed back.
                            $tookInCash += round((float) $s->total, 2);
                        }
                        $rung++;
                    } catch (\Throwable $e) {
                        $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                    }
                }

                // Three movements that each push the expectation a different way.
                foreach ([
                    ['type' => 'paid_out', 'amount' => random_int(200, 1500), 'reason' => 'Tea and lunch'],
                    ['type' => 'khata_in', 'amount' => random_int(500, 4000), 'reason' => 'Khata collected at the counter'],
                    ['type' => 'drop', 'amount' => random_int(2000, 8000), 'reason' => 'Dropped to the safe'],
                ] as $m) {
                    try {
                        $movement->execute($owner, $m, $session, false);
                    } catch (\Throwable $e) {
                        $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                    }
                }

                // THE COUNT. Four closes in five land on the money; the fifth
                // is out, in both directions, by the kind of amount a real
                // till is out by.
                if ($stillTrading) {
                    // Left open on purpose. No count, no close, no banking —
                    // the cashier is still standing there.
                    $shifts++;

                    continue;
                }

                $expected = (float) DrawerMath::for($session->fresh())['expected_cash'];
                $slip = $d % 5;
                $counted = match ($slip) {
                    0 => round($expected - random_int(50, 400), 2),
                    3 => round($expected + random_int(20, 200), 2),
                    default => $expected,
                };
                $slip === 0 ? $short++ : ($slip === 3 ? $over++ : $exact++);

                try {
                    $closed = $close->execute($session->fresh(), $counted, 'End of day', $owner->id, [
                        // What the cashier says the card terminal took. Equal
                        // to the real figure here: a declared-tender variance
                        // is a separate fault and seeding one by accident
                        // would make the real ones unfindable.
                        'declared_tenders' => DrawerMath::for($session->fresh())['tender_mix'],
                    ]);

                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                    Carbon::setTestNow();
                    CarbonImmutable::setTestNow();

                    continue;
                }

                // Most of the cash goes to the bank; the float stays.
                $banked = max(0, round($counted - 10000, 2));
                if ($banked > 0) {
                    DB::table('bank_deposits')->insert([
                        'id' => (string) Str::uuid7(),
                        'tenant_id' => $tenant->id,
                        'branch_id' => $branch->id,
                        'business_day_id' => $book->id,
                        'amount' => $banked,
                        'bank_name' => ['HBL', 'Meezan', 'UBL'][$d % 3],
                        'account_label' => 'Current',
                        'slip_number' => 'DEP-'.$date->format('ymd').'-'.($b + 1),
                        'deposited_at' => $date->copy()->setTime(21, 30),
                        'deposited_by' => $owner->id,
                        'created_by' => $owner->id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                try {
                    $day->close($owner, $book->fresh(), 'Closed off');
                } catch (\Throwable $e) {
                    $why[$e->getMessage()] = ($why[$e->getMessage()] ?? 0) + 1;
                }

                Carbon::setTestNow();
                CarbonImmutable::setTestNow();
                $shifts++;
            }
        }

        app(BranchContext::class)->set(null);
        // Belt and braces: a throw anywhere above must not leave the rest of
        // the seed running in last Tuesday.
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();

        $this->line(sprintf(
            '  the till   %d shifts · %d sales rung in · %d counted short, %d over, %d on the money',
            $shifts, $rung, $short, $over, $exact,
        ));
        arsort($why);
        foreach (array_slice($why, 0, 3, true) as $message => $n) {
            $this->line('             × '.$n.'  '.Str::limit($message, 80));
        }
    }

    /**
     * THE FOUR TABLES THE AUDIT KEPT REPORTING EMPTY.
     *
     * Customer groups, pack units, extra barcodes and tax groups. Every one
     * of them has screens, and every one of them had zero rows in all seven
     * load-test shops — so the whole price ladder in CreateSaleAction (group
     * level, pack factor, tax rate, then cart / coupon / promotion / points)
     * was only ever exercised at its simplest setting.
     *
     * They are not decoration. A group pins a trade customer to the wholesale
     * list and carries a members' discount; a pack sells a strip of ten and
     * draws ten base units off the shelf; a tax group is the rate the bill is
     * computed on. Each is a different way for the money to come out wrong.
     *
     * @param  array<int, array{product_id: string, variant_id: ?string}>  $productIds
     */
    private function priceLists(Tenant $tenant, array $productIds): void
    {
        $now = now();

        // ── TAX GROUPS, and the rate that is NOT the default ─────────
        //
        // Pakistan runs several: standard 17% / 18%, a reduced band, and
        // zero-rated staples. A shop with one rate never catches a total
        // computed on the wrong one.
        $taxGroups = [];
        foreach ([['Standard 18%', 18], ['Reduced 10%', 10], ['Zero-rated', 0]] as [$name, $rate]) {
            $taxGroups[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'name' => $name,
                'rate' => $rate,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        DB::table('tax_groups')->insert($taxGroups);

        // ── CUSTOMER GROUPS ──────────────────────────────────────────
        $groups = [
            ['Trade / wholesale', 'wholesale', 0],
            ['Members', 'retail', 5],
            ['Staff', 'retail', 15],
        ];
        $groupRows = [];
        foreach ($groups as [$name, $level, $discount]) {
            $groupRows[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'name' => $name,
                'price_level' => $level,
                'discount_percent' => $discount,
                'is_active' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }
        DB::table('customer_groups')->insert($groupRows);

        // One customer in three belongs to one, so the till meets a plain
        // walk-in, a member and a trade buyer in the same day.
        $customers = DB::table('customers')->where('tenant_id', $tenant->id)->pluck('id');
        foreach ($customers->chunk(200) as $chunk) {
            foreach ($chunk->values() as $n => $id) {
                if ($n % 3 !== 0) {
                    continue;
                }
                DB::table('customers')->where('id', $id)
                    ->update(['customer_group_id' => $groupRows[$n % count($groupRows)]['id']]);
            }
        }

        if ($productIds === []) {
            $this->line('  price lists '.count($taxGroups).' tax groups · '.count($groupRows).' customer groups');

            return;
        }

        // ── PACKS, EXTRA BARCODES, AND A TAX GROUP PER LINE ──────────
        //
        // Only products that hold stock and have no sizes: a pack and a
        // variant do not combine (a size carries its own price and stock),
        // and CreateSaleAction says so in words.
        /**
         * A RATE BELONGS TO EVERY ITEM; A PACK DOES NOT.
         *
         * The first version asked for stock-tracked products with no sizes
         * and used that one list for both — so a clothing shop, where every
         * single product has sizes, got "0 items rated", and so did a
         * restaurant and a service centre, whose items hold no stock. Tax has
         * nothing to do with either: a kurta is taxed and so is a haircut.
         *
         * Packs are the narrow case. A pack and a size do not combine (a size
         * carries its own price and stock) and CreateSaleAction says so.
         */
        $everything = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->pluck('price', 'id');

        $assigned = 0;
        $n = 0;
        foreach ($everything->keys()->chunk(500) as $chunk) {
            foreach ($chunk->values() as $k => $productId) {
                DB::table('products')->where('id', $productId)
                    ->update(['tax_group_id' => $taxGroups[($assigned + $k) % 3]['id']]);
            }
            $assigned += $chunk->count();
        }

        $plain = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->whereDoesntHave('variants')
            ->pluck('price', 'id');

        $units = [];
        $barcodes = [];
        foreach ($plain as $productId => $price) {
            $n++;

            // One in five is also sold by the pack.
            if ($n % 5 !== 0) {
                continue;
            }

            $factor = [6, 10, 12, 24][$n % 4];
            // A pack is cheaper per unit than a single — that is why anybody
            // buys one, and it is the discount a wrong `factor` destroys.
            $packPrice = round((float) $price * $factor * 0.92, 2);
            $units[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'product_id' => $productId,
                'name' => $factor >= 12 ? 'Box of '.$factor : 'Pack of '.$factor,
                'factor' => $factor,
                'price' => $packPrice,
                'barcode' => 'PK'.str_pad((string) $n, 10, '0', STR_PAD_LEFT),
                'sort_order' => 1,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            // A SECOND BARCODE ON THE SAME ITEM. Real shelves carry them —
            // the manufacturer's and the shop's own label — and a scanner
            // that only knows one of them sends the cashier hunting.
            $barcodes[] = [
                'id' => (string) Str::uuid7(),
                'tenant_id' => $tenant->id,
                'product_id' => $productId,
                'variant_id' => null,
                'barcode' => 'ALT'.str_pad((string) $n, 9, '0', STR_PAD_LEFT),
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        foreach (array_chunk($units, 500) as $c) {
            DB::table('product_units')->insert($c);
        }
        foreach (array_chunk($barcodes, 500) as $c) {
            DB::table('product_barcodes')->insert($c);
        }

        $this->line(sprintf(
            '  price lists %d tax groups (%d items rated) · %d customer groups · %d packs · %d extra barcodes',
            count($taxGroups), $assigned, count($groupRows), count($units), count($barcodes),
        ));
    }

    /**
     * What this basket comes to, according to the thing that decides.
     *
     * Rung for real inside a transaction and then rolled back, so the invoice
     * counter, the coupon's use, the stock movement and the customer charge
     * all unwind. The only thing that leaves is the number.
     *
     * Null when the basket cannot be sold at all (out of stock, a coupon that
     * does not apply) — the caller then falls back to a plain cash sale, the
     * same as a cashier would.
     *
     * @param  array<string, mixed>  $payload
     */
    private function priceIt(CreateSaleAction $action, array $payload): ?float
    {
        DB::beginTransaction();
        try {
            // Probed as CASH, not as credit: a khata tender larger than the
            // bill is refused ("cannot give cash change"), and the whole point
            // here is not knowing the bill yet.
            $probe = $action->execute($payload + [
                'payment_method' => 'cash',
                'amount_paid' => 100_000_000,
            ]);

            return round((float) $probe->total, 2);
        } catch (\Throwable $e) {
            return null;
        } finally {
            DB::rollBack();
        }
    }

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
    private function afterTheSale(Tenant $tenant, User $owner, array $branches, array $productIds): void
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
        $swap = app(ProcessExchangeAction::class);
        $void = app(CancelSaleAction::class);
        $done = 0;
        $swapped = 0;
        $voided = 0;
        $refunded = 0.0;
        /** @var array<string, int> $reasons */
        $reasons = [];

        /**
         * THREE DIFFERENT THINGS HAPPEN AFTER A SALE, AND ONLY ONE OF THEM
         * WAS EVER SEEDED.
         *
         *   RETURN    money goes back out of the drawer
         *   EXCHANGE  nothing goes back out: the credit funds a replacement,
         *             and the customer pays or is owed only the difference
         *   VOID      the sale never happened — every line restored, and the
         *             server REFUSES it once anything has been returned,
         *             because cancel restores all of them and the money and
         *             the stock would both move twice
         *
         * One fate per sale, assigned here rather than by three independent
         * modulos: a sale picked for both a return and a void would make the
         * refusal above look like a product fault every twelfth time.
         */
        foreach ($sales as $i => $sale) {
            if ($sale->items->isEmpty()) {
                continue;
            }

            $fate = match (true) {
                $i % 12 === 0 => 'return',
                $i % 17 === 0 => 'exchange',
                $i % 29 === 0 => 'void',
                default => null,
            };

            if ($fate === null) {
                continue;
            }

            app(BranchContext::class)->set(
                collect($branches)->firstWhere('id', $sale->branch_id) ?? $branches[0],
            );

            if ($fate === 'void') {
                // A VOID IS NOT A REFUND. The sale never happened: every line
                // goes back on the shelf, the money is undone, and anything
                // already returned makes it impossible — which the server
                // says, and which this fixture must not provoke by accident.
                try {
                    $void->execute($sale, 'Rung in error', 'mis_keyed');
                    $voided++;
                } catch (\Throwable $e) {
                    $reasons[$e->getMessage()] = ($reasons[$e->getMessage()] ?? 0) + 1;
                }

                continue;
            }

            $line = $sale->items->random();
            $qty = (float) $line->quantity;
            // Half the returns are PARTIAL — the case the refund rounding rule
            // exists for, and the one a "return the whole sale" fixture never
            // reaches.
            $back = $i % 24 === 0 || $qty <= 1 ? $qty : max(1, floor($qty / 2));

            if ($fate === 'exchange') {
                // THE WRONG SIZE, SWAPPED FOR THE RIGHT ONE. The returned
                // value funds the replacement; only the DIFFERENCE crosses
                // the counter, in either direction. Nothing in this fixture
                // had ever produced a sale paid for by a credit note.
                $replacement = $productIds[array_rand($productIds)];

                try {
                    $swap->execute($sale, [
                        'return_items' => [['sale_item_id' => $line->id, 'quantity' => $back]],
                        'items' => [[
                            'product_id' => $replacement['product_id'],
                            'variant_id' => $replacement['variant_id'],
                            'quantity' => 1,
                        ]],
                        // Whatever the replacement costs over the credit. A
                        // generous tender, because the difference is the
                        // server's answer and not the fixture's.
                        'payments' => [['method' => 'cash', 'amount' => 500_000]],
                        'reason' => 'Wrong size',
                    ]);
                    $swapped++;
                } catch (\Throwable $e) {
                    $reasons[$e->getMessage()] = ($reasons[$e->getMessage()] ?? 0) + 1;
                }

                continue;
            }

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

        $this->line(sprintf(
            '  returns    %d · %s refunded · %d exchanged · %d voided',
            $done, number_format($refunded, 2), $swapped, $voided,
        ));
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

        /**
         * ── TRANSFERS between branches ───────────────────────────────
         *
         * A SERVICE CANNOT BE PUT IN A VAN. The first run picked from the
         * whole catalogue and a service shop refused all six transfers with
         * "This item does not track inventory" — true, correct, and entirely
         * the seeder's fault. Only things that hold stock are moved.
         */
        $movable = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->pluck('id')
            ->flip();
        $shiftable = array_values(array_filter(
            $productIds,
            fn ($p) => $movable->has($p['product_id']),
        ));

        if (count($branches) > 1 && $shiftable !== []) {
            $moved = 0;
            foreach (range(1, 6) as $n) {
                $items = [];
                foreach ((array) array_rand($shiftable, min(4, count($shiftable))) as $k) {
                    $pick = $shiftable[$k];
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
        $hasCoupons = DB::table('coupons')->where('tenant_id', $tenant->id)->exists();

        /**
         * WHICH ITEMS COME IN A PACK.
         *
         * Seeding `product_units` is not the same as selling one. A pack line
         * carries `product_unit_id`, and that is what makes the till charge
         * the pack price and draw `factor` base units off the shelf instead
         * of one — the arithmetic that turns a strip of ten into ten tablets
         * gone. Rows that exist and are never rung test nothing.
         *
         * @var array<string, string> $packOf
         */
        $packOf = DB::table('product_units')
            ->where('tenant_id', $tenant->id)
            ->orderBy('sort_order')
            ->pluck('id', 'product_id')
            ->all();

        // "Spice level" is min_select 1, so a karahi rung without one is
        // refused — correctly, and 82 of the restaurant's 300 sales were.
        // Both sale loops read the same rule now; see modifierRules().
        [$mustChoose, $mayChoose] = $this->modifierRules($tenant);
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
            $items = $this->basket($type, $productIds, $mustChoose, random_int(1, 5));
            foreach ($items as $n => $line) {
                // HALF of what CAN be bought by the pack, is.
                //
                // Keyed on the BASKET, not on the line index: a condition on
                // the line index fired on a fifth of baskets and then only
                // when that line landed on one of the 1-in-5 products with a
                // pack — seven pack lines in three hundred sales, which is a
                // path walked rather than a path tested.
                if (! isset($line['variant_id']) && $i % 2 === 0 && isset($packOf[$line['product_id']])) {
                    $items[$n]['product_unit_id'] = $packOf[$line['product_id']];
                }

                // An optional add-on on every third line — extra cheese is
                // asked for about that often, and it is the only thing that
                // exercises a modifier carrying a PRICE.
                if ($n % 3 === 0 && isset($mayChoose[$line['product_id']])) {
                    $items[$n]['modifier_option_ids'] = array_merge(
                        $line['modifier_option_ids'] ?? [],
                        array_values($mayChoose[$line['product_id']]),
                    );
                }
            }

            /**
             * ONE SALE IN SIX IS ON THE BOOK.
             *
             * `payment_method: credit` against a named customer is the only
             * path that moves `customers.credit_balance`. Until this existed
             * the khata, the credit limit and every "who owes us" figure were
             * measured against a table of zeroes.
             *
             * ── WHAT `amount_paid` MEANS, WHICH IS NOT WHAT IT SOUNDS LIKE ──
             *
             * It is the TENDER, not the cash handed over. On a credit sale the
             * single tender is of method `credit`, so `amount_paid` is the
             * figure that goes ON THE BOOK — and the server refuses anything
             * under the full due (PAYMENT_INSUFFICIENT) and anything over it
             * ("a khata sale cannot give cash change").
             *
             * The first version of this read it the other way round and sent
             * 200, so EVERY credit sale in all seven shops was refused and the
             * line read `0 on the book`. A part-payment is two tenders — cash
             * for what crossed the counter, credit for the rest — which is
             * what `payments[]` is for.
             */
            $debtor = $customers !== [] && $i % 6 === 0
                ? $customers[$i % count($customers)]
                : null;

            // Every fifth basket arrives with a code — but only where the shop
            // HAS codes. `offers()` returns early without the promotions
            // module, and the first run then sent sixty baskets to a shop with
            // no coupon table and read back sixty "This coupon code is not
            // valid" refusals: a finding about the seeder, dressed as a
            // finding about the product.
            $coupon = $hasCoupons && $i % 5 === 0 ? ['SAVE10', 'FLAT200', 'WELCOME'][$i % 3] : null;

            $base = array_filter([
                'branch_id' => $branch->id,
                'channel' => 'walk_in',
                'customer_name' => $debtor?->name ?? ['Ahmed', 'Fatima', 'Bilal', 'Ayesha', 'Usman'][$i % 5],
                'customer_phone' => $debtor?->phone,
                'coupon_code' => $coupon,
                'items' => $items,
                'created_by' => $owner->id,
            ], fn ($v) => $v !== null);

            try {
                if ($debtor !== null) {
                    // THE EXACT BILL, PRICED BY THE SERVER AND THEN THROWN
                    // AWAY.
                    //
                    // A khata tender must equal the due to the paisa, and only
                    // CreateSaleAction knows what the due is — tax groups,
                    // group pricing, the live promotion and the coupon all
                    // move it. Working it out here would be a second pricer,
                    // which is the thing this seeder exists NOT to test.
                    //
                    // So the basket is rung once inside a transaction that is
                    // rolled back: the invoice counter, the coupon's use and
                    // the stock all unwind with it, and what survives is the
                    // number.
                    $due = $this->priceIt($action, $base);
                    if ($due === null) {
                        throw new \RuntimeException('could not price the basket');
                    }

                    // Half of them part-paid: cash across the counter and the
                    // rest on the book. That is the shape that catches a
                    // balance charged for the whole bill instead of the
                    // remainder.
                    $onCounter = $i % 12 === 0 ? 0.0 : min(200.0, round($due / 2, 2));
                    $payload = $base + [
                        'payment_method' => 'credit',
                        'amount_paid' => $due,
                        'payments' => $onCounter > 0
                            ? [
                                ['method' => 'cash', 'amount' => $onCounter],
                                ['method' => 'credit', 'amount' => round($due - $onCounter, 2)],
                            ]
                            : [['method' => 'credit', 'amount' => $due]],
                    ];
                } else {
                    /**
                     * A CARD IS CHARGED THE BILL; ONLY CASH GIVES CHANGE.
                     *
                     * This handed over 1,000,000 whatever the tender was, so
                     * every card sale recorded nine hundred thousand rupees
                     * of change — and `DrawerMath` takes change off the cash
                     * it took, which is how ninety-one shifts ended up with
                     * an average `cash_sales` of MINUS 2.78 million. The
                     * server refuses that now (CHANGE_WITHOUT_CASH); the
                     * seeder has to tender like a counter.
                     *
                     * Cash gets a round note above the bill, which is what a
                     * customer hands over and the only thing that exercises
                     * change at all. Three in four, because that is what a
                     * shop in this market takes.
                     */
                    // A MANDI TRADER DOES NOT PAY IN NOTES. A wholesale
                    // basket runs to two hundred thousand rupees, and the
                    // fifty-thousand note below was refused for being less
                    // than the total — correctly. Flip the mix there: three
                    // in four go by bank, which is how that trade settles.
                    $byCard = $type === 'wholesale' ? $i % 4 !== 0 : $i % 4 === 0;
                    if ($byCard) {
                        $due = $this->priceIt($action, $base);
                        if ($due === null) {
                            throw new \RuntimeException('could not price the basket');
                        }
                        $payload = $base + [
                            'payment_method' => ['card', 'wallet', 'bank_transfer'][$i % 3],
                            'amount_paid' => $due,
                        ];
                    } else {
                        $payload = $base + [
                            'payment_method' => 'cash',
                            // Big enough to cover any basket this fixture
                            // builds. The size does not distort the drawer —
                            // `cash_sales` is tendered MINUS change, so it
                            // lands on the bill whatever note was handed over
                            // — it only has to be enough not to be refused.
                            'amount_paid' => 250_000,
                        ];
                    }
                }

                $sale = $action->execute($payload);

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
