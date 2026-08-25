<?php

namespace Database\Seeders;

use App\Actions\Catalog\SyncComboItemsAction;
use App\Actions\Catalog\SyncProductUnitsAction;
use App\Actions\Catalog\SyncRecipeItemsAction;
use App\Actions\Demo\CreateDemoShopAction;
use App\Actions\Fuel\CloseForecourtShiftAction;
use App\Actions\Fuel\OpenForecourtShiftAction;
use App\Actions\Inventory\ApplyStockCountAction;
use App\Actions\Inventory\DisposeBatchAction;
use App\Actions\Inventory\RecordStockCountAction;
use App\Actions\Inventory\StartStockCountAction;
use App\Actions\Inventory\TransferStockAction;
use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Actions\Pos\RecordCashMovementAction;
use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Actions\Restaurant\AddTicketItemsAction;
use App\Actions\Restaurant\FireKitchenTicketAction;
use App\Actions\Restaurant\OpenTicketAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Enums\ReservationStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Bank;
use App\Models\BankDeposit;
use App\Models\Branch;
use App\Models\BranchSoldOut;
use App\Models\BranchStock;
use App\Models\BusinessDay;
use App\Models\Category;
use App\Models\City;
use App\Models\Collection;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\CustomerAddress;
use App\Models\CustomerGroup;
use App\Models\CustomerLedgerEntry;
use App\Models\CustomerVehicle;
use App\Models\DiningTable;
use App\Models\Enquiry;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelTank;
use App\Models\HardwareDevice;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\LoyaltyEntry;
use App\Models\Plan;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductSerial;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\Promotion;
use App\Models\RecipeItem;
use App\Models\RecurringExpense;
use App\Models\Register;
use App\Models\Reservation;
use App\Models\RestaurantTicket;
use App\Models\Rider;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\SaleItemSerial;
use App\Models\ShopRequest;
use App\Models\StockCount;
use App\Models\StockCountItem;
use App\Models\StockDisposal;
use App\Models\StockTransfer;
use App\Models\SubscriptionPayment;
use App\Models\Supplier;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WarrantyClaim;
use App\Services\PromotionService;
use App\Support\BarcodeNamespace;
use App\Support\ItemTypes;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Rich demo world:
 *   Customers : user1@app.com … user10@app.com            / password
 *   Owners    : tenant1@app.com … tenant9@app.com          / password
 *   One tenant per business type, spread across cities, mixed plans
 *   (Expense Manager only vs + Online Shop), full catalogs, sales,
 *   expenses, pending reservations, favorites.
 *
 * Idempotent: re-running never duplicates (keyed by slug/email; per-tenant
 * content only seeds when that tenant has none).
 */
class DemoDataSeeder extends Seeder
{
    public function run(): void
    {
        $cities = City::query()->where('is_active', true)->orderBy('name')->get();

        // A bespoke deal, so the panel has one to show: a chain that wanted its
        // own ceiling and its own price instead of climbing a rung.
        Plan::query()->updateOrCreate(
            ['code' => 'karahi-house-custom'],
            [
                'name' => 'Karahi House — custom',
                'description' => 'Negotiated for Karahi House: unlimited catalog, 20 GB of photos, 45-day grace.',
                'price' => 24000, 'billing_period_months' => 12, 'grace_period_days' => 45,
                'max_products' => null, 'max_storage_mb' => 20480, 'max_orders_month' => null,
                'is_active' => true, 'is_custom' => true,
            ],
        );

        $plans = Plan::query()->get()->keyBy('code');

        $customers = $this->seedCustomers();
        $tenants = [];

        foreach ($this->tenantBlueprints() as $i => $blueprint) {
            $tenants[] = $this->seedTenant(
                index: $i + 1,
                blueprint: $blueprint,
                city: $cities[$i % $cities->count()],
                plan: $plans[$blueprint['plan']],
            );
        }

        $this->seedStableDemoShop();

        $this->seedFavorites($customers, $tenants);
        $this->seedReservations($customers, $tenants);
        $this->seedAddresses($customers, $cities);
        $this->seedPlatformDesk($cities);
    }

    /**
     * The shop the local credentials actually open.
     *
     * `DemoTenantSeeder` creates Demo Mart with a fixed email and password so a
     * developer's login survives migrate:fresh — and gives it every module a
     * mart gets and nothing at all to put behind them. Every screen in that
     * shop was empty, which is the first thing anybody sees on a fresh install.
     *
     * Filled here rather than in DemoTenantSeeder because everything that
     * makes a shop worth looking at lives in this file, and a second copy of
     * it over there is a second copy to keep in step.
     */
    private function seedStableDemoShop(): void
    {
        $tenant = Tenant::query()->where('slug', 'demo-mart')->first();

        if ($tenant === null) {
            return;
        }

        $type = $tenant->business_type ?: 'mart';

        // The type's templates — expense categories above all. Without them
        // there is nothing for an expense to be filed under, so the whole
        // money block returns early and the shop has a catalog and no
        // cashbook. Its modules and limits are DemoTenantSeeder's decision,
        // though, so they are put back exactly as they were: this fills the
        // shop, it does not re-specify it.
        $features = $tenant->features;
        $limits = $tenant->limits;
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $type);
        $tenant->forceFill(['features' => $features, 'limits' => $limits])->save();

        $this->fillShop($tenant, [
            'name' => $tenant->business_name,
            'type' => $type,
            'items' => $this->catalogFor($type),
            'branches' => [],
        ], $tenant->plan, 0);

        $on = collect($tenant->refresh()->features ?? [])->filter()->keys()->implode(', ');
        $this->command?->info("  ✓ {$tenant->business_name} (the stable local login) — {$on}");
    }

    /**
     * Where a delivery actually goes.
     *
     * Four demo orders existed and not one of them had an address behind it,
     * so the checkout's address picker and the rider's "where am I taking
     * this" both had nothing to show.
     *
     * @param  User[]  $customers
     * @param  \Illuminate\Support\Collection<int, City>  $cities
     */
    private function seedAddresses(array $customers, $cities): void
    {
        if ($cities->isEmpty()) {
            return;
        }

        $places = [
            ['Home', 'House 214, Street 7, Gulberg III'],
            ['Work', 'Office 4B, Second Floor, Business Arcade'],
            ['Parents', 'Flat 9, Al-Noor Apartments, Block C'],
        ];

        foreach ($customers as $i => $customer) {
            // Two each, so "default" means something: an address list of one
            // never shows what choosing between them looks like.
            foreach ([0, 1] as $n) {
                [$label, $line] = $places[($i + $n) % count($places)];
                $city = $cities[($i + $n) % $cities->count()];

                CustomerAddress::query()->firstOrCreate(
                    ['user_id' => $customer->id, 'label' => $label],
                    [
                        'address' => "{$line}, {$city->name}",
                        'city_id' => $city->id,
                        'latitude' => $city->latitude,
                        'longitude' => $city->longitude,
                        'is_default' => $n === 0,
                    ],
                );
            }
        }
    }

    /**
     * The platform's own inbox: people who asked to be shown around, and demo
     * shops asking to be kept.
     *
     * Both are admin screens that shipped in the last fortnight and neither
     * had a single row in the demo world — the newest thing an admin is shown
     * was an empty page.
     *
     * @param  \Illuminate\Support\Collection<int, City>  $cities
     */
    private function seedPlatformDesk($cities): void
    {
        foreach ([
            [Enquiry::WALKTHROUGH, 'Bilal Ahmed', 'bilal@karachigrocers.pk', '+923001234567',
                'Karachi Grocers', 'mart', 'Karachi', Enquiry::NEW, 2,
                'Two shops, thinking about a third. Want to see how stock moves between them.'],
            [Enquiry::WALKTHROUGH, 'Sana Malik', 'sana@thespicehouse.pk', '+923214445566',
                'The Spice House', 'food', 'Lahore', Enquiry::CONTACTED, 6,
                'Restaurant with dine-in and delivery. Mainly interested in the kitchen screen.'],
            [Enquiry::QUESTION, 'Dr. Faisal Rehman', 'faisal@rehmanpharmacy.pk', '+923339998877',
                'Rehman Pharmacy', 'pharmacy', 'Islamabad', Enquiry::NEW, 1,
                'Does the batch/expiry tracking handle split packs? We sell loose strips.'],
            [Enquiry::QUESTION, 'Adnan Sheikh', 'adnan@sheikhmotors.pk', null,
                'Sheikh Motors', 'automotive', 'Multan', Enquiry::CLOSED, 20,
                'Asked about importing an existing product list. Sent the CSV template.'],
        ] as [$kind, $name, $email, $phone, $business, $type, $city, $status, $daysAgo, $message]) {
            Enquiry::query()->firstOrCreate(
                ['email' => $email, 'kind' => $kind],
                [
                    'name' => $name,
                    'phone' => $phone,
                    'business_name' => $business,
                    'business_type' => $type,
                    'city' => $city,
                    // A walkthrough carries a PREFERENCE, not a booking — there
                    // is no calendar behind it and nothing is reserved.
                    'prefers_at' => $kind === Enquiry::WALKTHROUGH ? now()->addDays(2)->setTime(16, 0) : null,
                    'message' => $message,
                    'status' => $status,
                    'created_at' => now()->subDays($daysAgo),
                    'updated_at' => now()->subDays($daysAgo),
                ],
            );
        }

        // Two shops somebody spun up from the landing page, one of which wants
        // to keep what it has built. Made through the real action so they age
        // out and sweep away exactly like a visitor's would.
        if (Tenant::query()->where('is_demo', true)->exists()) {
            return;
        }

        try {
            foreach (['mart', 'food'] as $i => $type) {
                ['tenant' => $tenant, 'owner' => $owner] = app(CreateDemoShopAction::class)->execute($type);

                if ($i > 0) {
                    continue;
                }

                ShopRequest::query()->create([
                    'tenant_id' => $tenant->id,
                    'contact_name' => $owner->name,
                    'contact_email' => $owner->email,
                    'contact_phone' => '+923005551234',
                    'note' => 'Been using it all afternoon and the staff have picked it up. We would like to keep this shop.',
                    'status' => ShopRequest::PENDING,
                    'requested_at' => now()->subHours(3),
                ]);
            }
        } catch (\Throwable $e) {
            $this->command?->warn("    demo-shop desk skipped: {$e->getMessage()}");
        }
    }

    // ─────────────────────────────────────────────────────────────────

    /** @return User[] */
    private function seedCustomers(): array
    {
        $customers = [];

        foreach (range(1, 10) as $i) {
            $customers[] = User::query()->updateOrCreate(
                ['email' => "user{$i}@app.com"],
                [
                    'name' => "Demo User {$i}",
                    'phone' => sprintf('+9230000010%02d', $i),
                    'password' => 'password',
                    'role' => UserRole::Customer,
                    'status' => UserStatus::Active,
                    'email_verified_at' => now(),
                ],
            );
        }

        return $customers;
    }

    private function seedTenant(int $index, array $blueprint, City $city, Plan $plan): Tenant
    {
        $tenant = Tenant::query()->updateOrCreate(
            ['slug' => Str::slug($blueprint['name'])],
            [
                'business_name' => $blueprint['name'],
                'email' => "tenant{$index}@app.com",
                'phone' => sprintf('+9230000020%02d', $index),
                'business_category' => $blueprint['category'],
                'city_id' => $city->id,
                'plan_id' => $plan->id,
                'status' => 'active',
                'setup_completed' => true,
                'address' => "{$blueprint['name']}, Main Market, {$city->name}",
                // Pin the shop near its city centre (deterministic jitter ±~2 km)
                'latitude' => $city->latitude !== null ? round($city->latitude + (($index % 5) - 2) * 0.008, 7) : null,
                'longitude' => $city->longitude !== null ? round($city->longitude + (($index % 7) - 3) * 0.008, 7) : null,
                'subscription_starts_at' => now()->subMonth(),
                'subscription_ends_at' => now()->addYear(),
                'delivery_fee' => ($blueprint['modules']['delivery'] ?? false) ? 150 : 0,
            ],
        );

        User::query()->updateOrCreate(
            ['email' => "tenant{$index}@app.com"],
            [
                'tenant_id' => $tenant->id,
                'name' => "{$blueprint['name']} Owner",
                'password' => 'password',
                'role' => UserRole::ShopOwner,
                'status' => UserStatus::Active,
                'email_verified_at' => now(),
            ],
        );

        // Business-type templates: categories, expense categories, and the
        // module set the type proposes.
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $blueprint['type']);

        // Then what this particular shop was actually given. Same three steps
        // an admin walks through on the create screen — type, then modules,
        // then the size of the business — so the demo world shows the model
        // rather than just the data: MediPlus delivers without an online store,
        // Karachi Books & Ledgers runs the cashbook and nothing else, and both
        // sit on the same plans as everyone else.
        $tenant->applyModules($blueprint['modules']);
        $tenant->assignLimits($blueprint['limits']);

        $this->fillShop($tenant, $blueprint, $plan, $index);

        $on = collect($tenant->refresh()->features ?? [])->filter()->keys()->implode(', ');
        $this->command?->info("  ✓ {$blueprint['name']} ({$blueprint['type']}, {$city->name}, {$plan->name}) — {$on}");

        return $tenant->refresh();
    }

    /**
     * Everything a shop CONTAINS, given a shop that already exists.
     *
     * Split out of seedTenant so it can be run against a tenant this seeder did
     * not create — specifically `demo-mart`, the stable local login that
     * DemoTenantSeeder makes and nothing ever filled. It had every module on
     * and not one row behind any of them, so the credentials printed in this
     * file's own docblock opened an empty shop.
     */
    private function fillShop(Tenant $tenant, array $blueprint, ?Plan $plan, int $index): void
    {
        // A books-only tenant never gets a catalog, so "has no products" can't
        // be the marker for "not seeded yet" — it would re-seed its expenses on
        // every run. Either kind of content counts as done.
        $seeded = Product::withoutTenancy()->where('tenant_id', $tenant->id)->exists()
            || Expense::withoutTenancy()->where('tenant_id', $tenant->id)->exists();

        // Branches are structure, not content — a shop that gained a second
        // branch after its first seed should still get it.
        $this->seedExtraBranches($tenant, $blueprint['branches'] ?? []);

        if (! $seeded) {
            $this->seedProducts($tenant, $blueprint['items'], $blueprint['type']);
            $this->seedMarketingExtras($tenant);
            $this->seedCollections($tenant);
            $this->seedSales($tenant);
            // Moved ahead of the money block: this is what creates the shop's
            // supplier, and an expense that names no supplier cannot show the
            // supplier picker the expense form now has.
            if ($tenant->featureEnabled('inventory')) {
                $this->seedPurchases($tenant);
            }
            $this->seedRecurringExpenses($tenant);
            $this->seedExpenses($tenant);
            $this->seedIncome($tenant);
            $this->seedBudgets($tenant);
            $this->seedReturns($tenant);
            $this->seedShift($tenant);
            if ($plan !== null) {
                $this->seedSubscriptionPayments($tenant, $plan, $index);
            }
        }

        // Equipment is structure too — see the block above seedDineIn — so it
        // sits outside the content guard and an older demo world gains it on
        // the next run. AFTER the catalog, though, and not beside the branches
        // above: a tank names the fuel it holds and a tab names the dish on it,
        // and seeded any earlier both simply found nothing and returned.
        $this->seedKitchen($tenant);
        $this->seedDineIn($tenant);
        $this->seedForecourt($tenant);
        $this->seedSerialCounter($tenant);
        $this->seedGarage($tenant);
        $this->seedKhataAndPoints($tenant);
        $this->seedSizedSale($tenant);
        $this->seedShopOps($tenant);
    }

    private function seedProducts(Tenant $tenant, array $items, string $businessType): void
    {
        $mainBranchId = Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('is_default', true)->value('id');

        // BarcodeNamespace asks the shop whether a code is already taken, and
        // that question is tenant-scoped. Everything else here says
        // withoutTenancy() and passes tenant_id by hand, so the context is set
        // for the one helper that needs it rather than the whole seeder.
        app(TenantContext::class)->set($tenant);
        $barcodeSeq = 1;

        foreach ($items as $item) {
            $category = Category::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->where('name', $item['category'] ?? '')
                ->first();
            // Catalog category not in the business-type defaults → create it.
            if ($category === null && ! empty($item['category'])) {
                $category = Category::withoutTenancy()->create([
                    'tenant_id' => $tenant->id, 'name' => $item['category'], 'sort_order' => 99,
                ]);
            }

            $coarse = $item['type'] ?? 'product';
            // Derive the richer item_type from the business + coarse type
            // (primary codes food/pharmacy + their legacy aliases). A catalog
            // row may name it outright, which is how a restaurant's Deals come
            // out as DEALS: `isCombo()` reads item_type and nothing else, so a
            // deal seeded as an ordinary dish has components nothing will read.
            $itemType = $item['item_type'] ?? match (true) {
                $coarse === 'service' => ItemTypes::SERVICE,
                in_array($businessType, ['food', 'restaurant'], true) => ItemTypes::FOOD,
                in_array($businessType, ['pharmacy', 'clinic'], true) => ItemTypes::MEDICINE,
                default => ItemTypes::PHYSICAL,
            };

            $variants = $item['variants'] ?? [];

            // A SHOP SCANS THINGS. Not one demo product carried a code, so the
            // single most-used control on the till — the scanner box — had
            // nothing to find, and per-size codes (the reason ProductBarcode
            // has a variant_id at all) had never been written by anything.
            // Only tracked goods get one: nobody scans a karahi or a haircut.
            $scannable = $coarse === 'product' && ($item['track'] ?? true);
            $barcode = $scannable ? $this->demoBarcode($barcodeSeq++) : null;

            $product = Product::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'category_id' => $category?->id,
                'type' => $coarse,
                'item_type' => $itemType,
                'name' => $item['name'],
                'description' => $item['description'] ?? null,
                'sku' => $item['sku'] ?? null,
                'brand' => $item['brand'] ?? null,
                'unit' => $item['unit'] ?? null,
                'barcode' => $barcode,
                'price' => $item['price'],
                'cost' => $item['cost'] ?? null,
                // A product WITH sizes holds no stock of its own — see
                // Product::stockOnHand(), which sums the variants instead. A
                // parent left holding its own figure is counted twice.
                'stock_quantity' => $variants === [] ? ($item['stock'] ?? 0) : 0,
                'low_stock_threshold' => $item['low_at'] ?? null,
                'tracks_serial' => $item['serialized'] ?? false,
                'warranty_months' => $item['warranty'] ?? null,
                // Food/made-to-order items pass 'track' => false.
                'track_inventory' => $item['track'] ?? ($coarse === 'product'),
                // Fuel and loose goods sell by volume/weight (fractional qty).
                'sold_by' => $item['sold_by'] ?? 'unit',
                'duration_minutes' => $item['duration'] ?? null,
                'visible_in_marketplace' => $item['visible'] ?? true,
            ]);

            // Phase 2: per-branch on-hand at Main mirrors the rollup.
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $tenant->id, 'branch_id' => $mainBranchId,
                'product_id' => $product->id, 'variant_id' => null,
                'quantity' => $product->stock_quantity,
            ]);

            foreach ($variants as $variant) {
                $created = $product->variants()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $variant['name'],
                    'sku' => $variant['sku'] ?? null,
                    'price' => $variant['price'],
                    'cost' => $variant['cost'] ?? null,
                    'stock_quantity' => $variant['stock'] ?? 0,
                    'low_stock_threshold' => $variant['low_at'] ?? null,
                ]);
                BranchStock::withoutTenancy()->create([
                    'tenant_id' => $tenant->id, 'branch_id' => $mainBranchId,
                    'product_id' => $product->id, 'variant_id' => $created->id,
                    'quantity' => $created->stock_quantity,
                ]);

                // Through the real writer, not an insert: BarcodeNamespace is
                // where "one code, one thing on the shelf" is decided, and a
                // seeder that writes rows behind it is a second path that can
                // seed a clash the product screen would have refused.
                if ($scannable) {
                    BarcodeNamespace::assign($product, $created, [
                        'barcode' => $this->demoBarcode($barcodeSeq++),
                    ]);
                }
            }

            foreach ($item['modifiers'] ?? [] as $gi => $g) {
                $group = $product->modifierGroups()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $g['name'],
                    'type' => $g['type'] ?? 'modifier',
                    'min_select' => $g['min'] ?? 0,
                    'max_select' => $g['max'] ?? 1,
                    'sort_order' => $gi,
                ]);
                foreach ($g['options'] as $oi => $o) {
                    $group->options()->create([
                        'tenant_id' => $tenant->id,
                        'name' => $o[0],
                        'price_delta' => $o[1],
                        'sort_order' => $oi,
                    ]);
                }
            }
        }

        app(TenantContext::class)->clear();
    }

    /**
     * An in-store code. The 200-299 prefix range is reserved by GS1 for exactly
     * this — codes a shop prints for itself — so a demo barcode can never
     * collide with a real product's EAN if somebody scans one at a demo till.
     */
    private function demoBarcode(int $seq): string
    {
        return '200'.str_pad((string) $seq, 10, '0', STR_PAD_LEFT);
    }

    /**
     * Demo supplier + purchases: one fully-received PO (stock in) and one
     * open ordered PO with a partial payment — exercises the real pipeline.
     */
    /**
     * Reusable tax group + a couple of automatic promotions (incl. a BOGO) so a
     * fresh --seed has data to exercise the tax and promotion modules.
     */
    private function seedMarketingExtras(Tenant $tenant): void
    {
        TaxGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'GST 17%'],
            ['rate' => 17, 'is_active' => true],
        );

        // A trade/wholesale tier + a VIP tier for tiered pricing demos.
        CustomerGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'Wholesale / Trade'],
            ['price_level' => 'wholesale', 'discount_percent' => null, 'is_active' => true],
        );
        CustomerGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'VIP'],
            ['price_level' => 'retail', 'discount_percent' => 5, 'is_active' => true],
        );

        // Automatic order-wide discount over a minimum spend.
        Promotion::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'Weekend 10% Off'],
            ['type' => 'percent', 'value' => 10, 'scope' => 'order', 'min_spend' => 500, 'is_active' => true, 'priority' => 1],
        );

        // Buy-1-get-1 on the first category that actually has ≥2 products.
        $categoryId = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->whereNotNull('category_id')
            ->groupBy('category_id')
            ->havingRaw('COUNT(*) >= 2')
            ->value('category_id');
        if ($categoryId !== null) {
            Promotion::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => 'Buy 1 Get 1 Free'],
                ['type' => 'bogo', 'value' => 0, 'scope' => 'category', 'category_id' => $categoryId,
                    'buy_qty' => 1, 'get_qty' => 1, 'get_discount_pct' => 100, 'is_active' => false, 'priority' => 2],
            );
        }
    }

    private function seedPurchases(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant);

        $products = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('track_inventory', true)
            ->doesntHave('variants')
            ->take(3)
            ->get();
        if ($products->isEmpty()) {
            return;
        }

        $supplier = Supplier::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'name' => 'Prime Distributors',
            'contact_person' => 'Kamran',
            'phone' => '+92321'.random_int(1000000, 9999999),
            'whatsapp' => '+92321'.random_int(1000000, 9999999),
        ]);

        $lines = fn () => $products->map(fn ($p) => [
            'product_id' => $p->id,
            'quantity' => 20,
            'unit_cost' => (float) ($p->cost ?? max(1, (float) $p->price * 0.7)),
        ])->all();

        // Received PO — moves stock in via the real receive action.
        $received = app(CreatePurchaseOrderAction::class)->execute([
            'supplier_id' => $supplier->id, 'order_date' => now()->subDays(20)->toDateString(),
            'status' => 'ordered', 'items' => $lines(),
        ]);
        // Medicines can only be received into a DATED lot (FEFO + expired-stock
        // fence). Build a receive map that dates every line a year out so a
        // pharmacy demo tenant seeds without tripping EXPIRY_REQUIRED.
        $received->load('items');
        $receiveMap = [];
        foreach ($received->items as $item) {
            $product = $item->product_id !== null
                ? Product::withoutTenancy()->find($item->product_id)
                : null;
            $receiveMap[$item->id] = [
                'quantity' => $item->outstanding(), // all outstanding, as the default receive does
                'expiry_date' => $product?->requiresExpiry() ? now()->addYear()->toDateString() : null,
            ];
        }
        app(ReceivePurchaseOrderAction::class)->execute($received, $receiveMap);
        app(RecordSupplierPaymentAction::class)->execute($supplier, [
            'amount' => round((float) $received->fresh()->total * 0.6, 2),
            'method' => 'bank_transfer', 'purchase_order_id' => $received->id,
        ]);

        // Open PO awaiting delivery.
        app(CreatePurchaseOrderAction::class)->execute([
            'supplier_id' => $supplier->id, 'order_date' => now()->subDays(2)->toDateString(),
            'expected_date' => now()->addDays(3)->toDateString(),
            'status' => 'ordered', 'items' => $lines(),
        ]);
    }

    /**
     * Two demo collections (Popular, Deals) filled with the first items —
     * shows the FoodPanda-style display sections in the marketplace.
     */
    private function seedCollections(Tenant $tenant): void
    {
        $items = Product::withoutTenancy()->where('tenant_id', $tenant->id)->take(6)->get();
        if ($items->isEmpty()) {
            return;
        }

        foreach ([['Popular', 'popular'], ['Deals', 'deals']] as $i => [$name, $slug]) {
            $collection = Collection::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'name' => $name,
                'slug' => $slug,
                'sort_order' => $i,
            ]);
            // Popular → first 3, Deals → next 3 (overlap fine for a demo).
            $slice = $items->slice($i * 3, 3)->values();
            $sync = [];
            foreach ($slice as $j => $item) {
                $sync[$item->id] = ['tenant_id' => $tenant->id, 'sort_order' => $j];
            }
            if ($sync) {
                $collection->items()->sync($sync);
            }
        }
    }

    /**
     * A few real sales through the REAL sale pipeline (invoice numbers,
     * stock movements, snapshots) spread over the past week.
     */
    private function seedSales(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant);

        $sellable = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where(fn ($q) => $q->where('track_inventory', false)->orWhere('stock_quantity', '>', 3))
            ->doesntHave('variants')
            ->take(3)
            ->get();

        foreach ($sellable as $dayOffset => $product) {
            try {
                $sale = app(CreateSaleAction::class)->execute([
                    'channel' => ['walk_in', 'phone', 'whatsapp'][$dayOffset % 3],
                    'customer_name' => ['Ahmed', 'Fatima', 'Bilal'][$dayOffset % 3],
                    'customer_phone' => ['+923001112233', '+923004445566', '+923007778899'][$dayOffset % 3],
                    'items' => [[
                        'product_id' => $product->id,
                        'quantity' => $product->track_inventory ? 2 : 1,
                    ]],
                    'payment_method' => 'cash',
                    'amount_paid' => (float) $product->price * ($product->track_inventory ? 2 : 1),
                ]);

                // Spread across the week so reports/series have shape.
                $sale->forceFill([
                    'sold_at' => now()->subDays($dayOffset)->subHours(random_int(1, 8)),
                ])->save();
            } catch (\Throwable) {
                // Stock edge — skip quietly, demo data only.
            }
        }

        app(TenantContext::class)->clear();
    }

    // ── The money block ──────────────────────────────────────────────
    //
    // The demo world used to stop after the catalog and a few sales: no
    // refund, no income, no budget, no schedule, no closed shift. Five
    // features had shipped against columns nothing in the demo ever filled,
    // so the only way to see any of them was to type the data in by hand —
    // and the branch-scope work could not be shown at all, because a refund
    // never existed.

    /**
     * Two schedules, so the list has both states. The active one is what puts
     * a "scheduled" badge on an expense below: two rent rows inside one month
     * read as a double entry until something says one of them was posted by a
     * standing order.
     */
    private function seedRecurringExpenses(Tenant $tenant): void
    {
        $rent = $this->expenseCategoryNamed($tenant, ['Rent', 'Shop Rent', 'Rent & Utilities']);
        $other = $this->expenseCategoryNamed($tenant, ['Utilities', 'Electricity', 'Bills', 'Internet']);

        if ($rent === null) {
            return;
        }

        $branchId = $this->mainBranchId($tenant);
        $supplierId = Supplier::withoutTenancy()->where('tenant_id', $tenant->id)->value('id');

        RecurringExpense::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'branch_id' => $branchId,
            'expense_category_id' => $rent->id,
            'supplier_id' => $supplierId,
            'description' => 'Monthly shop rent',
            'amount' => 45000,
            'payment_method' => 'bank_transfer',
            'frequency' => 'monthly',
            'next_due_on' => now()->startOfMonth()->addMonth()->toDateString(),
            'last_posted_on' => now()->startOfMonth()->toDateString(),
            'is_active' => true,
            'notes' => 'Standing order, paid on the 1st.',
        ]);

        if ($other !== null) {
            // Paused rather than deleted: a schedule the shop stopped for the
            // summer is a state the list has to render, and "active" looks like
            // the only one when every row is.
            RecurringExpense::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branchId,
                'expense_category_id' => $other->id,
                'description' => 'Generator diesel top-up',
                'amount' => 12000,
                'payment_method' => 'cash',
                'frequency' => 'weekly',
                'next_due_on' => now()->addWeek()->toDateString(),
                'is_active' => false,
                'notes' => 'Paused — mains supply stabilised.',
            ]);
        }
    }

    private function seedExpenses(Tenant $tenant): void
    {
        $categories = ExpenseCategory::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->take(4)
            ->get();

        if ($categories->isEmpty()) {
            return;
        }

        $branches = $this->branchIds($tenant);
        $supplierId = Supplier::withoutTenancy()->where('tenant_id', $tenant->id)->value('id');
        $ownerId = $this->ownerOf($tenant)?->id;
        $schedule = RecurringExpense::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('is_active', true)->first();

        foreach ($categories as $i => $category) {
            Expense::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                // Round-robin so a two-branch shop has spend on both sides. A
                // branch filter that silently returns everything is invisible
                // when every row belongs to the only branch there is.
                'branch_id' => $branches[$i % count($branches)] ?? null,
                'expense_category_id' => $category->id,
                // Only some expenses have a supplier — a utility bill has none,
                // and a picker that is filled on every row never shows its empty
                // state.
                'supplier_id' => $i === 0 ? $supplierId : null,
                'description' => "{$category->name} — ".now()->subDays($i * 2)->format('M j'),
                'amount' => [1500, 800, 2500, 400][$i % 4],
                'payment_method' => ['cash', 'bank_transfer', 'cash', 'card'][$i % 4],
                'expense_date' => now()->subDays($i * 2)->toDateString(),
                'notes' => $i === 1 ? 'Paid against invoice #4471.' : null,
                'created_by' => $ownerId,
            ]);
        }

        // The posted instance of the standing order, which is the row that
        // carries the badge.
        if ($schedule !== null) {
            Expense::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $schedule->branch_id,
                'expense_category_id' => $schedule->expense_category_id,
                'supplier_id' => $schedule->supplier_id,
                'recurring_expense_id' => $schedule->id,
                'description' => $schedule->description,
                'amount' => $schedule->amount,
                'payment_method' => $schedule->payment_method,
                'expense_date' => now()->startOfMonth()->toDateString(),
                'created_by' => $ownerId,
            ]);
        }
    }

    /**
     * The other side of the book. Income had a receipt column and no way to
     * fill it, so the side an owner is most likely to be challenged on was the
     * side with no evidence attached — one row here carries a real file so the
     * link actually opens.
     */
    private function seedIncome(Tenant $tenant): void
    {
        $categories = IncomeCategory::withoutTenancy()
            ->where('tenant_id', $tenant->id)->take(3)->get();

        if ($categories->isEmpty()) {
            return;
        }

        $branches = $this->branchIds($tenant);
        $ownerId = $this->ownerOf($tenant)?->id;

        $rows = [
            ['Owner investment', 80000, 'bank_transfer', $this->demoReceiptPath()],
            ['Scrap and packaging sold', 4200, 'cash', null],
            ['Refund from supplier', 15500, 'bank_transfer', null],
        ];

        foreach ($rows as $i => [$description, $amount, $method, $attachment]) {
            Income::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branches[$i % count($branches)] ?? null,
                'income_category_id' => $categories[$i % $categories->count()]->id,
                'description' => $description,
                'amount' => $amount,
                'payment_method' => $method,
                'income_date' => now()->subDays($i * 3 + 1)->toDateString(),
                'attachment_path' => $attachment,
                'created_by' => $ownerId,
            ]);
        }
    }

    /**
     * Both shapes a budget takes — a standing ceiling that applies every month,
     * and a dated row that overrides it for one. Then one category is retired
     * while still holding spend, which is the case the Budgets tab used to drop:
     * close a category mid-month and real money vanished off the screen.
     */
    private function seedBudgets(Tenant $tenant): void
    {
        $categories = ExpenseCategory::withoutTenancy()
            ->where('tenant_id', $tenant->id)->take(4)->get();

        if ($categories->count() < 2) {
            return;
        }

        $branchId = $this->mainBranchId($tenant);
        $ownerId = $this->ownerOf($tenant)?->id;

        // Standing ceiling: no month.
        ExpenseBudget::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'branch_id' => $branchId,
            'expense_category_id' => $categories[0]->id,
            'amount' => 60000,
            'month' => null,
            'created_by' => $ownerId,
        ]);

        // This month only — the annual-licence shape.
        ExpenseBudget::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'branch_id' => $branchId,
            'expense_category_id' => $categories[1]->id,
            'amount' => 25000,
            'month' => now()->startOfMonth()->toDateString(),
            'created_by' => $ownerId,
        ]);

        // A retired category that still has spend against it this month. The
        // budget row survives it deliberately: accounting for money already
        // spent is not the same as inviting more to be planned against it.
        if ($categories->count() >= 3) {
            $retired = $categories[2];

            ExpenseBudget::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branchId,
                'expense_category_id' => $retired->id,
                'amount' => 10000,
                'month' => now()->startOfMonth()->toDateString(),
                'created_by' => $ownerId,
            ]);

            $retired->forceFill(['is_active' => false])->save();
        }
    }

    /**
     * One partial refund, through the real action so stock goes back and the
     * ledger sees a credit — a hand-written row would restock nothing and prove
     * nothing. Runs as the owner because the action stamps `created_by` from
     * the authenticated user.
     */
    private function seedReturns(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null) {
            return;
        }

        $sale = Sale::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->with('items')
            ->latest('sold_at')
            ->first();

        $line = $sale?->items->first();
        if ($sale === null || $line === null) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            app(ProcessSaleReturnAction::class)->execute($sale, [
                // Partial, not whole: a full refund and a part refund take
                // different paths through the over-return guard, and the part
                // one is the path with arithmetic in it.
                'items' => [['sale_item_id' => $line->id, 'quantity' => 1]],
                'reason' => 'Customer changed their mind',
                'refund_method' => 'cash',
            ]);
        } catch (\Throwable) {
            // Stock or over-return edge — demo data only.
        }

        app('auth')->forgetGuards();
        app(TenantContext::class)->clear();
    }

    /**
     * A shift that was opened and counted out, so `Day & banking → Shifts` has
     * something in it. Closed short by 250 on purpose: a drawer that balances
     * exactly every time never shows what the variance column is for.
     */
    private function seedShift(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null || ! $tenant->featureEnabled('pos')) {
            return;
        }

        // A lane to stand at. Register-less is a supported mode and every demo
        // shift was running in it, so the Registers screen was empty and no
        // session could name where it was rung.
        $this->seedRegisters($tenant);

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            $lane = Register::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->orderBy('code')
                ->first();

            $session = app(OpenCashSessionAction::class)->execute($owner, 5000.0, $lane);

            // Money leaves a drawer for reasons that are not sales, and the
            // close has to account for them. One of each direction, so the
            // Z-report shows the arithmetic rather than just the takings.
            foreach ([
                ['type' => 'expense_out', 'amount' => 450, 'reason' => 'Tea and snacks for the floor staff'],
                ['type' => 'income_in', 'amount' => 1200, 'reason' => 'Change brought from the safe'],
            ] as $movement) {
                try {
                    app(RecordCashMovementAction::class)->execute($owner, $movement, $session->refresh());
                } catch (\Throwable) {
                    // A movement type this shop does not use — skip it.
                }
            }

            app(CloseCashSessionAction::class)->execute(
                $session->refresh(),
                max(0.0, round((float) $session->refresh()->expected_cash - 250, 2)),
                'Counted at close — 250 short, till roll checked.',
                $owner->id,
            );
        } catch (\Throwable) {
            // A shop with no register configured, or a day already closed.
        }

        app('auth')->forgetGuards();
        app(TenantContext::class)->clear();
    }

    /**
     * The lanes a shop rings on, and the hardware bolted to them.
     *
     * Capped by the register limit the shop was actually assigned — a demo
     * that quietly exceeds its own plan is showing the limit not working.
     */
    private function seedRegisters(Tenant $tenant): void
    {
        if (! $tenant->featureEnabled('pos')) {
            return;
        }

        $allowed = (int) ($tenant->limits['registers'] ?? 1);
        $wanted = max(1, min(2, $allowed));
        $branchId = $this->mainBranchId($tenant);

        $lanes = [];
        foreach (range(1, $wanted) as $i) {
            $lanes[] = Register::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'code' => 'R'.$i],
                ['branch_id' => $branchId, 'name' => 'Counter '.$i, 'is_active' => true],
            );
        }

        // Hardware is CONFIGURATION, not traffic: a printer is declared once
        // and lives on the register. Seeded so Settings → Hardware shows the
        // shape of the registry rather than an empty page.
        $counter = $lanes[0] ?? null;
        if ($counter === null) {
            return;
        }

        foreach ([
            ['receipt_printer', 'Counter printer', 'Epson', 'TM-T82', 'network', '192.168.1.50:9100', true],
            ['barcode_scanner', 'Handheld scanner', 'Zebra', 'DS2208', 'keyboard_wedge', null, true],
            ['cash_drawer', 'Till drawer', 'Posiflex', 'CR-4000', 'printer_kick', null, true],
        ] as [$type, $name, $brand, $model, $connection, $value, $default]) {
            HardwareDevice::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'register_id' => $counter->id, 'type' => $type],
                [
                    'name' => $name, 'brand' => $brand, 'model' => $model,
                    'connection_type' => $connection, 'connection_value' => $value,
                    'is_default' => $default, 'is_active' => true,
                ],
            );
        }
    }

    // ── Equipment ────────────────────────────────────────────────────
    //
    // A floor plan and a forecourt are what a module HAS, not what a shop did
    // with it — the same reason branches are seeded outside the content guard.
    // Both of these were missing entirely: Karahi House was GIVEN dine-in with
    // nothing to seat, and Highway Fuel was given the forecourt with no tank,
    // so `OpenForecourtShiftAction` answered NO_FORECOURT_CONFIGURED and the
    // whole module was unreachable in the demo world. A module that is on and
    // empty does not read as unconfigured, it reads as broken.

    /**
     * A floor a waiter can actually work: tables in three areas, one tab
     * already running with its docket on the pass, and one still being keyed.
     *
     * The two tabs are deliberately in different states, because the kitchen
     * board and the floor answer different questions — one shows what has been
     * FIRED, the other what is merely OPEN, and a demo with only one of them
     * cannot show the difference.
     */
    private function seedDineIn(Tenant $tenant): void
    {
        if (! $tenant->featureEnabled('dine_in')) {
            return;
        }

        $owner = $this->ownerOf($tenant);
        if ($owner === null) {
            return;
        }

        $branchId = $this->mainBranchId($tenant);
        $sort = 0;

        foreach ([
            ['Ground Floor', ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], 4],
            ['Family Hall', ['F1', 'F2', 'F3', 'F4'], 6],
            ['Terrace', ['TR1', 'TR2', 'TR3'], 2],
        ] as [$area, $names, $seats]) {
            foreach ($names as $name) {
                DiningTable::withoutTenancy()->updateOrCreate(
                    ['tenant_id' => $tenant->id, 'name' => $name],
                    [
                        'area' => $area, 'seats' => $seats, 'sort_order' => $sort++,
                        'is_active' => true, 'branch_id' => $branchId,
                    ],
                );
            }
        }

        // Tabs are content, not structure. Seeded only into a restaurant that
        // has never had one — never injected into a demo somebody is using.
        $everHadATab = RestaurantTicket::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->withTrashed()
            ->exists();

        if ($everHadATab) {
            return;
        }

        $dishes = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('is_active', true)
            ->orderBy('name')
            ->take(5)
            ->get();

        if ($dishes->count() < 4) {
            return;
        }

        $tables = DiningTable::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->orderBy('sort_order')
            ->take(4)
            ->get();

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            // Table three: ordered, fired, waiting on the kitchen.
            $fired = app(OpenTicketAction::class)->execute([
                'dining_table_id' => $tables[2]->id,
                'guest_count' => 4,
                'customer_name' => 'Walk-in',
            ]);
            app(AddTicketItemsAction::class)->execute($fired, [
                'items' => [
                    ['product_id' => $dishes[0]->id, 'quantity' => 2],
                    ['product_id' => $dishes[1]->id, 'quantity' => 1],
                    ['product_id' => $dishes[2]->id, 'quantity' => 4],
                ],
            ]);
            app(FireKitchenTicketAction::class)->execute($fired);

            // Family hall: seated and still choosing — nothing on the pass yet.
            $keying = app(OpenTicketAction::class)->execute([
                'dining_table_id' => $tables[3]->id,
                'guest_count' => 6,
                'customer_name' => 'Anwar family',
            ]);
            app(AddTicketItemsAction::class)->execute($keying, [
                'items' => [
                    ['product_id' => $dishes[3]->id, 'quantity' => 2],
                    ['product_id' => $dishes[4]->id, 'quantity' => 3],
                ],
            ]);
        } catch (\Throwable $e) {
            $this->command?->warn("    dine-in demo skipped: {$e->getMessage()}");
        }

        app('auth')->forgetGuards();
        app(TenantContext::class)->clear();
    }

    /**
     * What a dish is made of, what a deal contains, and what ran out tonight.
     *
     * Three features that had shipped against empty tables. Each one is here
     * in BOTH shapes, because the shapes are what the recent work was about:
     *
     *   · a recipe for the dish, and a recipe that OVERRIDES it for one size
     *     (RecipeFor: a Large is made differently, not additionally);
     *   · a deal of plain items, and a deal that NAMES A SIZE — which a deal
     *     containing a sized item is required to do, and could not do at all
     *     until recently;
     *   · a whole dish 86'd, and a single SIZE 86'd — the large wings are off,
     *     the six-piece is still on.
     */
    private function seedKitchen(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant);

        try {
            $owner = $this->ownerOf($tenant);

            $named = fn (string $name): ?Product => Product::query()->where('name', $name)->first();
            $size = fn (?Product $p, string $name): ?ProductVariant => $p?->variants()->where('name', $name)->first();

            $biryani = $named('Chicken Biryani');
            if ($biryani === null || RecipeItem::query()->exists()) {
                return;
            }

            $ing = fn (string $name, float $qty, ?ProductVariant $variant = null): ?array => ($p = $named($name)) === null
                ? null
                : ['ingredient_product_id' => $p->id, 'quantity' => $qty, 'variant_id' => $variant?->id];

            // Rows a missing ingredient would have left as nulls are dropped
            // rather than sent — SyncRecipeItemsAction would refuse the lot.
            $rows = fn (array $maybe): array => array_values(array_filter($maybe));

            $recipes = [
                // The dish, in its ordinary single portion …
                [$biryani, $rows([
                    $ing('Chicken (raw)', 0.25), $ing('Basmati Rice', 0.3), $ing('Cooking Oil', 0.05),
                    $ing('Onion', 0.1), $ing('Yogurt', 0.08), $ing('Biryani Masala', 0.05),
                    // … and the family size, which is not four singles.
                    $ing('Chicken (raw)', 0.9, $size($biryani, 'Family')),
                    $ing('Basmati Rice', 1.1, $size($biryani, 'Family')),
                    $ing('Cooking Oil', 0.18, $size($biryani, 'Family')),
                    $ing('Onion', 0.35, $size($biryani, 'Family')),
                    $ing('Yogurt', 0.3, $size($biryani, 'Family')),
                    $ing('Biryani Masala', 0.15, $size($biryani, 'Family')),
                ])],
                [$named('Chicken Karahi Full'), $rows([
                    $ing('Chicken (raw)', 1.0), $ing('Tomato', 0.4),
                    $ing('Cooking Oil', 0.15), $ing('Ginger Garlic Paste', 0.05),
                ])],
                [$named('Chicken Karahi Half'), $rows([
                    $ing('Chicken (raw)', 0.5), $ing('Tomato', 0.2),
                    $ing('Cooking Oil', 0.08), $ing('Ginger Garlic Paste', 0.03),
                ])],
                [$named('Mutton Pulao'), $rows([
                    $ing('Mutton (raw)', 0.3), $ing('Basmati Rice', 0.3), $ing('Cooking Oil', 0.06), $ing('Onion', 0.12),
                ])],
            ];

            $coffee = $named('Cold Coffee');
            if ($coffee !== null) {
                $recipes[] = [$coffee, $rows([
                    $ing('Fresh Milk', 0.2), $ing('Coffee Powder', 0.02), $ing('Sugar', 0.03),
                    $ing('Vanilla Ice Cream Tub', 0.05),
                    $ing('Fresh Milk', 0.3, $size($coffee, 'Large')),
                    $ing('Coffee Powder', 0.03, $size($coffee, 'Large')),
                    $ing('Sugar', 0.04, $size($coffee, 'Large')),
                    $ing('Vanilla Ice Cream Tub', 0.08, $size($coffee, 'Large')),
                ])];
            }

            $wings = $named('Chicken Wings');
            if ($wings !== null) {
                $recipes[] = [$wings, $rows([
                    $ing('Chicken Wings (raw)', 0.35), $ing('Cooking Oil', 0.05),
                    $ing('Chicken Wings (raw)', 0.7, $size($wings, '12 pcs')),
                    $ing('Cooking Oil', 0.09, $size($wings, '12 pcs')),
                ])];
            }

            $shake = $named('Mango Shake');
            if ($shake !== null) {
                $recipes[] = [$shake, $rows([
                    $ing('Fresh Milk', 0.2), $ing('Mango Pulp', 0.15), $ing('Sugar', 0.02),
                ])];
            }

            foreach ($recipes as [$dish, $items]) {
                if ($dish !== null && $items !== []) {
                    app(SyncRecipeItemsAction::class)->execute($dish, $items);
                }
            }

            // ── The deals ────────────────────────────────────────────
            $part = fn (string $name, float $qty, ?string $sizeName = null): ?array => ($p = $named($name)) === null
                ? null
                : [
                    'component_product_id' => $p->id,
                    'quantity' => $qty,
                    // A component that comes in sizes MUST name one, which is
                    // the rule that made a deal with a sized item unsellable
                    // before anything could express it.
                    'variant_id' => $sizeName !== null ? $size($p, $sizeName)?->id : null,
                ];

            foreach ([
                ['Family Deal', [
                    $part('Chicken Karahi Full', 1), $part('Chicken Biryani', 1, 'Family'),
                    $part('Soft Drink 500ml', 4), $part('Gulab Jamun', 4),
                ]],
                ['Couple Deal', [
                    $part('Butter Chicken', 1), $part('Chicken Biryani', 1, 'Single'),
                    $part('Garlic Bread', 1), $part('Mint Margarita', 2),
                ]],
                ['Solo Lunch Deal', [
                    $part('Zinger Burger', 1), $part('Loaded Fries', 1), $part('Soft Drink 500ml', 1),
                ]],
            ] as [$dealName, $parts]) {
                $deal = $named($dealName);
                $parts = $rows($parts);
                if ($deal !== null && $parts !== []) {
                    app(SyncComboItemsAction::class)->execute($deal, $parts);
                }
            }

            // ── Eighty-six ───────────────────────────────────────────
            $branchId = $this->mainBranchId($tenant);
            $off = function (?Product $product, ?ProductVariant $variant) use ($tenant, $branchId, $owner): void {
                if ($product === null) {
                    return;
                }
                BranchSoldOut::withoutTenancy()->firstOrCreate(
                    ['branch_id' => $branchId, 'product_id' => $product->id, 'variant_id' => $variant?->id],
                    ['tenant_id' => $tenant->id, 'sold_out_at' => now()->subHours(3), 'sold_out_by' => $owner?->id],
                );
            };

            $off($named('Fish Fry'), null);            // the whole dish is off
            $off($wings, $size($wings, '12 pcs'));      // only the large is off
        } catch (\Throwable $e) {
            $this->command?->warn("    kitchen demo skipped: {$e->getMessage()}");
        } finally {
            app(TenantContext::class)->clear();
        }
    }

    /**
     * A forecourt that exists: a tank per grade, two pumps, a nozzle from every
     * pump to every tank, and one reconciled shift behind the live one.
     *
     * The tanks start dipped at exactly the litres the catalog says are in
     * stock, because on day one the book and the stick agree — a demo that
     * opens with an unexplained variance teaches the operator to ignore the
     * variance column, which is the one number the whole module exists for.
     * One tank is then closed 12 litres short, so the column has something
     * true to show.
     */
    private function seedForecourt(Tenant $tenant): void
    {
        if (! $tenant->featureEnabled('fuel')) {
            return;
        }

        $owner = $this->ownerOf($tenant);
        if ($owner === null) {
            return;
        }

        $branchId = $this->mainBranchId($tenant);

        $categoryId = Category::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->where('name', 'Fuel')
            ->value('id');

        $fuels = Product::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->when($categoryId !== null, fn ($q) => $q->where('category_id', $categoryId))
            ->where('sold_by', 'weight')
            ->orderBy('name')
            ->get();

        if ($fuels->isEmpty()) {
            return;
        }

        $tanks = [];
        foreach ($fuels as $i => $fuel) {
            $tanks[] = FuelTank::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => 'Tank '.($i + 1)],
                [
                    'branch_id' => $branchId,
                    'product_id' => $fuel->id,
                    'capacity_litres' => 20000,
                    'current_dip_litres' => (float) $fuel->stock_quantity,
                    'dead_stock_litres' => 500,
                    'is_active' => true,
                ],
            );
        }

        $pumps = [];
        foreach (['Pump 1', 'Pump 2'] as $i => $name) {
            $pumps[] = FuelPump::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $name],
                ['branch_id' => $branchId, 'code' => 'P'.($i + 1), 'is_active' => true],
            );
        }

        // Every pump reaches every grade, which is what a forecourt of this
        // size looks like and — more usefully — is the shape that catches a
        // reconciliation bug: two nozzles drawing on ONE tank.
        foreach ($pumps as $pi => $pump) {
            foreach ($tanks as $ti => $tank) {
                FuelNozzle::withoutTenancy()->firstOrCreate(
                    ['tenant_id' => $tenant->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id],
                    [
                        'name' => 'N'.($pi + 1).'-'.($ti + 1),
                        // A totaliser that has been counting for a while. Fixed
                        // rather than random so a re-seed reads the same.
                        'current_reading' => 120000 + ($pi * 10000) + ($ti * 1000),
                        'is_active' => true,
                    ],
                );
            }
        }

        $everRanAShift = ForecourtShift::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->withTrashed()
            ->exists();

        if ($everRanAShift) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            // Yesterday's shift, opened and reconciled.
            $closed = app(OpenForecourtShiftAction::class)->execute($owner, [
                'branch_id' => $branchId,
                'notes' => 'Night shift.',
            ]);
            $closed->forceFill(['opened_at' => now()->subDay()])->save();

            $readings = [];
            $soldByTank = [];
            foreach ($closed->refresh()->readings as $reading) {
                $nozzle = FuelNozzle::withoutTenancy()->find($reading->fuel_nozzle_id);
                $sold = 180.0;   // a quiet night, per hose
                $test = 5.0;     // the morning calibration draw, returned to tank
                $readings[] = [
                    'fuel_nozzle_id' => $reading->fuel_nozzle_id,
                    'closing_reading' => (float) $reading->opening_reading + $sold + $test,
                    'test_litres' => $test,
                ];
                if ($nozzle !== null) {
                    $soldByTank[$nozzle->fuel_tank_id] = ($soldByTank[$nozzle->fuel_tank_id] ?? 0) + $sold;
                }
            }

            $dips = [];
            foreach ($closed->refresh()->dips as $i => $dip) {
                // Book = opening − metered. The first tank comes up 12 litres
                // short of it, which is what a real forecourt looks like.
                $book = (float) $dip->opening_dip - ($soldByTank[$dip->fuel_tank_id] ?? 0);
                $dips[] = [
                    'fuel_tank_id' => $dip->fuel_tank_id,
                    'closing_dip' => round($i === 0 ? $book - 12 : $book, 3),
                ];
            }

            app(CloseForecourtShiftAction::class)->execute($owner, $closed, [
                'readings' => $readings,
                'dips' => $dips,
                'notes' => 'Counted at change-over.',
            ]);

            // And today's, running.
            app(OpenForecourtShiftAction::class)->execute($owner, [
                'branch_id' => $branchId,
                'notes' => 'Day shift.',
            ]);
        } catch (\Throwable $e) {
            $this->command?->warn("    forecourt demo skipped: {$e->getMessage()}");
        }

        app('auth')->forgetGuards();
        app(TenantContext::class)->clear();
    }

    // ── Trade depth ──────────────────────────────────────────────────
    //
    // Everything below had shipped against a table nothing in the demo world
    // ever filled: serials, warranty claims, vehicles, trade-ins, khata and
    // points. The screens existed and were empty, which is indistinguishable
    // from broken to anyone being shown the product.

    /**
     * A shop that hands over a NUMBERED unit: serials received into stock, one
     * sold with its serial captured, and two claims at the warranty desk — one
     * still open, one already resolved.
     */
    private function seedSerialCounter(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null || ! $tenant->featureEnabled('inventory')) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            if (ProductSerial::query()->exists()) {
                return;
            }

            $serialized = Product::query()->where('tracks_serial', true)->orderBy('name')->take(3)->get();
            if ($serialized->isEmpty()) {
                return;
            }

            $supplier = Supplier::query()->firstOrCreate(
                ['name' => 'Metro Electronics Supply'],
                ['tenant_id' => $tenant->id, 'contact_person' => 'Junaid', 'phone' => '+923219876543'],
            );

            // Serial-on-receive, through the real receive: a serial that
            // appears without a delivery behind it is exactly the row the
            // registry exists to make impossible.
            $po = app(CreatePurchaseOrderAction::class)->execute([
                'supplier_id' => $supplier->id,
                'order_date' => now()->subDays(12)->toDateString(),
                'status' => 'ordered',
                'items' => $serialized->map(fn (Product $p) => [
                    'product_id' => $p->id,
                    'quantity' => 4,
                    'unit_cost' => (float) ($p->cost ?? max(1, (float) $p->price * 0.7)),
                ])->all(),
            ]);

            $po->load('items');
            $map = [];
            $sellable = null;
            foreach ($po->items as $line) {
                $product = Product::query()->whereKey($line->product_id)->first();
                $stub = strtoupper(Str::substr(preg_replace('/[^A-Za-z]/', '', (string) $product?->name) ?: 'SN', 0, 3));
                $serials = [];
                foreach (range(1, 4) as $n) {
                    $serials[] = $stub.'-'.now()->format('y').'-'.str_pad((string) $n, 4, '0', STR_PAD_LEFT);
                }
                $map[$line->id] = ['quantity' => $line->outstanding(), 'serials' => $serials];
                $sellable ??= ['product' => $product, 'serial' => $serials[0]];
            }
            app(ReceivePurchaseOrderAction::class)->execute($po, $map);

            if ($sellable === null || $sellable['product'] === null) {
                return;
            }

            // One goes out of the door with its number on the receipt.
            $sale = app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'customer_name' => 'Hamza Iqbal',
                'customer_phone' => '+923331234567',
                'items' => [[
                    'product_id' => $sellable['product']->id,
                    'quantity' => 1,
                    'serials' => [$sellable['serial']],
                ]],
                'payment_method' => 'cash',
                'amount_paid' => (float) $sellable['product']->price,
            ]);
            $sale->forceFill(['sold_at' => now()->subDays(9)])->save();

            // …and comes back. A claim carries what was true AT BOOK-IN, so it
            // is copied off the sold unit rather than recomputed later.
            $record = SaleItemSerial::query()->where('serial', $sellable['serial'])->latest('sold_at')->first();
            $branchId = $this->mainBranchId($tenant);

            WarrantyClaim::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branchId,
                'sale_item_serial_id' => $record?->id,
                'serial' => $sellable['serial'],
                'product_name' => $record?->product_name ?? $sellable['product']->name,
                'fault' => 'Will not hold charge — dies after ten minutes.',
                'customer_name' => 'Hamza Iqbal',
                'customer_phone' => '+923331234567',
                'was_under_warranty' => (bool) $record?->isUnderWarranty(),
                'warranty_expires_at' => $record?->warranty_expires_at,
                'created_by' => $owner->id,
            ]);

            // A unit the shop never sold — the customer with a receipt from
            // somewhere else. The desk still records what it is holding.
            WarrantyClaim::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'branch_id' => $branchId,
                'serial' => 'UNKNOWN-88213',
                'product_name' => 'Unknown item',
                'fault' => 'Screen flickers.',
                'customer_name' => 'Sadia Noor',
                'customer_phone' => '+923005556677',
                'was_under_warranty' => false,
                'resolution' => 'repaired',
                'resolution_note' => 'Loose ribbon reseated at the bench.',
                'resolved_at' => now()->subDays(2),
                'resolved_by' => $owner->id,
                'created_by' => $owner->id,
            ]);
        } catch (\Throwable $e) {
            $this->command?->warn("    serial demo skipped: {$e->getMessage()}");
        } finally {
            app('auth')->forgetGuards();
            app(TenantContext::class)->clear();
        }
    }

    /**
     * A garage's own record: the cars it works on, and a job billed against
     * one with the customer's old battery taken in part exchange.
     *
     * A trade-in is a TENDER, not a discount — the scrap enters stock and pays
     * for part of the bill. Seeding it as a discount would have shown the
     * wrong model of the feature to anyone reading the demo.
     */
    private function seedGarage(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null || $tenant->business_type !== 'automotive') {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            if (CustomerVehicle::query()->exists()) {
                return;
            }

            $vehicles = [
                ['ABC-123', 'Toyota', 'Corolla GLi', 2019, 'White', '195/65 R15', 84210],
                ['LEB-4471', 'Honda', 'City Aspire', 2021, 'Silver', '185/65 R15', 41980],
                ['KHI-9902', 'Suzuki', 'Cultus VXL', 2018, 'Blue', '165/65 R14', 112400],
            ];

            $first = null;
            foreach ($vehicles as [$reg, $make, $model, $year, $colour, $tyre, $odo]) {
                $customer = Customer::query()->firstOrCreate(
                    ['phone' => '+9233'.random_int(10000000, 99999999)],
                    ['tenant_id' => $tenant->id, 'name' => 'Owner of '.$reg],
                );

                $vehicle = CustomerVehicle::query()->create([
                    'tenant_id' => $tenant->id,
                    'customer_id' => $customer->id,
                    'registration' => $reg,
                    'make' => $make, 'model' => $model, 'year' => $year,
                    'colour' => $colour, 'tyre_size' => $tyre,
                    'odometer' => $odo, 'odometer_at' => now()->subWeeks(2)->toDateString(),
                    'is_active' => true,
                ]);

                $first ??= ['vehicle' => $vehicle, 'customer' => $customer];
            }

            $battery = Product::query()->where('name', 'like', '%Battery%')->where('type', 'product')->first();
            $fitting = Product::query()->where('type', 'service')->first();

            if ($battery === null || $first === null) {
                return;
            }

            $items = [['product_id' => $battery->id, 'quantity' => 1]];
            if ($fitting !== null) {
                $items[] = ['product_id' => $fitting->id, 'quantity' => 1];
            }

            $allowance = 2500.0;
            $bill = (float) $battery->price + (float) ($fitting->price ?? 0);

            app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'customer_id' => $first['customer']->id,
                'customer_name' => $first['customer']->name,
                'vehicle_id' => $first['vehicle']->id,
                'odometer' => $first['vehicle']->odometer + 620,
                'items' => $items,
                'trade_ins' => [[
                    'product_id' => $battery->id,
                    'quantity' => 1,
                    'unit_allowance' => $allowance,
                    'description' => 'Old 12V battery, scrap',
                ]],
                'payment_method' => 'cash',
                'amount_paid' => max(0.0, $bill - $allowance),
            ]);
        } catch (\Throwable $e) {
            $this->command?->warn("    garage demo skipped: {$e->getMessage()}");
        } finally {
            app('auth')->forgetGuards();
            app(TenantContext::class)->clear();
        }
    }

    /**
     * The two things a counter remembers about a regular: what they owe, and
     * what they have earned.
     *
     * Both are ledgers rather than columns — a balance that can be edited is a
     * balance nobody can explain — so the demo posts real entries through the
     * customer's own methods and lets the balances fall out of them.
     */
    private function seedKhataAndPoints(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null || ! $tenant->featureEnabled('pos')) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            if (CustomerLedgerEntry::query()->exists() || LoyaltyEntry::query()->exists()) {
                return;
            }

            $product = Product::query()
                ->where(fn ($q) => $q->where('track_inventory', false)->orWhere('stock_quantity', '>', 5))
                ->doesntHave('variants')
                ->where('type', 'product')
                ->first();

            if ($product === null) {
                return;
            }

            // ── The khata ────────────────────────────────────────────
            $onCredit = Customer::query()->firstOrCreate(
                ['phone' => '+923008881122'],
                ['tenant_id' => $tenant->id, 'name' => 'Rashid General Store'],
            );
            $onCredit->forceFill(['credit_limit' => 50000])->save();

            // A khata sale is not an UNPAID sale — the bill is settled in full
            // by a tender that happens to be the customer's account, and it may
            // not overshoot either: the counter cannot hand back cash change
            // against a debt. So the amount has to be the REAL total.
            //
            // Which the seeder must not compute for itself. Price × quantity
            // was wrong in six of the eight demo shops, because the demo world
            // also seeds an automatic 10%-over-500 promotion and the till
            // applies it. Ask the same service the POS asks and the answer is
            // right in a shop with promotions and in a shop without.
            $line = [['product_id' => $product->id, 'quantity' => 3]];
            $gross = round((float) $product->sellingPrice() * 3, 2);
            $best = app(PromotionService::class)->preview($line, $tenant->timezone);
            $onAccount = round($gross - (float) ($best['discount'] ?? 0), 2);

            $sale = app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'customer_id' => $onCredit->id,
                'customer_name' => $onCredit->name,
                'customer_phone' => $onCredit->phone,
                'items' => $line,
                'payment_method' => 'credit',
                'amount_paid' => $onAccount,
            ]);
            $sale->forceFill(['sold_at' => now()->subDays(6)])->save();

            // Part paid a few days later — which is what a khata IS: the
            // balance is the difference between two entries, never a figure
            // somebody typed.
            $owed = (float) $onCredit->refresh()->credit_balance;
            if ($owed > 0) {
                $onCredit->recordCreditPayment(
                    round($owed * 0.4, 2),
                    'cash',
                    'Handed over at the counter',
                    'Part payment against running khata.',
                );
            }

            // ── The points ───────────────────────────────────────────
            $regular = Customer::query()->firstOrCreate(
                ['phone' => '+923009994455'],
                ['tenant_id' => $tenant->id, 'name' => 'Ayesha Siddiqui'],
            );

            $earned = app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'customer_id' => $regular->id,
                'customer_name' => $regular->name,
                'customer_phone' => $regular->phone,
                'items' => [['product_id' => $product->id, 'quantity' => 2]],
                'payment_method' => 'cash',
                'amount_paid' => (float) $product->price * 2,
            ]);
            $earned->forceFill(['sold_at' => now()->subDays(4)])->save();

            // Whether the sale above awarded any depends on the shop's own
            // loyalty settings, so the demo tops the balance up rather than
            // assuming — and then spends some of it, because a points screen
            // that only ever counts up never shows what redemption looks like.
            if ((int) $regular->refresh()->loyalty_points < 400) {
                $regular->earnPoints(400, null, 'Opening balance carried over from the old card.');
            }
            $regular->redeemPoints(150, null, 'Redeemed against a purchase at the counter.');
        } catch (\Throwable $e) {
            $this->command?->warn("    khata demo skipped: {$e->getMessage()}");
        } finally {
            app('auth')->forgetGuards();
            app(TenantContext::class)->clear();
        }
    }

    /**
     * One sale that rings a SIZE.
     *
     * Both `seedSales` and `seedPurchases` say `doesntHave('variants')` — they
     * were written before sizes existed and skip anything that has them — so
     * no varianted line has ever appeared in a demo sale. Every report that
     * breaks down by size therefore had nothing to break down.
     */
    private function seedSizedSale(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null || ! $tenant->featureEnabled('pos')) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            if (SaleItem::query()->whereNotNull('variant_id')->exists()) {
                return;
            }

            $variant = ProductVariant::query()
                ->where('is_active', true)
                ->whereHas('product', fn ($q) => $q->where('is_active', true))
                ->orderByDesc('stock_quantity')
                ->first();

            if ($variant === null) {
                return;
            }

            $product = Product::query()->whereKey($variant->product_id)->first();
            if ($product === null) {
                return;
            }

            // A tracked size with no stock cannot be sold, and should not be —
            // the demo asks for one it can actually ring.
            if ($product->track_inventory && (float) $variant->stock_quantity < 1) {
                return;
            }

            $sale = app(CreateSaleAction::class)->execute([
                'channel' => 'walk_in',
                'customer_name' => 'Nadia Rehman',
                'customer_phone' => '+923212223344',
                'items' => [[
                    'product_id' => $product->id,
                    'variant_id' => $variant->id,
                    'quantity' => 1,
                ]],
                'payment_method' => 'cash',
                'amount_paid' => (float) $variant->price,
            ]);
            $sale->forceFill(['sold_at' => now()->subDays(3)])->save();
        } catch (\Throwable $e) {
            $this->command?->warn("    sized-sale demo skipped: {$e->getMessage()}");
        } finally {
            app('auth')->forgetGuards();
            app(TenantContext::class)->clear();
        }
    }

    /**
     * The shelf, the safe and the paperwork: lots with real dates, packs, a
     * transfer between branches, a stock count that found a variance, a lot
     * written off, coupons, a bank deposit and the riders who deliver.
     *
     * Each of these is a screen that existed with nothing on it.
     */
    private function seedShopOps(Tenant $tenant): void
    {
        $owner = $this->ownerOf($tenant);
        if ($owner === null) {
            return;
        }

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            $this->seedCoupons($tenant);
            $this->seedBanking($tenant, $owner);
            $this->seedRiders($tenant);
            $this->seedPacks($tenant);
            $this->seedLots($tenant, $owner);
            $this->seedTransfer($tenant, $owner);
            $this->seedStockCount($tenant, $owner);
        } catch (\Throwable $e) {
            $this->command?->warn("    shop-ops demo skipped: {$e->getMessage()}");
        } finally {
            app('auth')->forgetGuards();
            app(TenantContext::class)->clear();
        }
    }

    /** A code a customer types, and a code the shop hands out on a flyer. */
    private function seedCoupons(Tenant $tenant): void
    {
        if (! $tenant->featureEnabled('pos')) {
            return;
        }

        Coupon::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'code' => 'WELCOME10'],
            [
                'type' => 'percent', 'value' => 10, 'min_spend' => 1000, 'max_discount' => 500,
                'usage_limit' => 100, 'used_count' => 0,
                'starts_at' => now()->subMonth(), 'expires_at' => now()->addMonths(2),
                'is_active' => true,
            ],
        );

        // Expired on purpose: a coupon list where everything works never shows
        // what the expiry column is for.
        Coupon::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'code' => 'EIDFLAT250'],
            [
                'type' => 'fixed', 'value' => 250, 'min_spend' => 2000,
                'usage_limit' => 50, 'used_count' => 18,
                'starts_at' => now()->subMonths(3), 'expires_at' => now()->subWeeks(2),
                'is_active' => true,
            ],
        );
    }

    /** Where the day's cash goes when it leaves the drawer. */
    private function seedBanking(Tenant $tenant, User $owner): void
    {
        if (! $tenant->featureEnabled('pos')) {
            return;
        }

        foreach ([['Meezan Bank', 'MEBL'], ['Habib Bank', 'HBL']] as [$name, $code]) {
            Bank::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $name],
                ['short_code' => $code, 'is_active' => true],
            );
        }

        if (BankDeposit::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return;
        }

        BankDeposit::withoutTenancy()->create([
            'tenant_id' => $tenant->id,
            'branch_id' => $this->mainBranchId($tenant),
            'business_day_id' => BusinessDay::withoutTenancy()
                ->where('tenant_id', $tenant->id)->latest('opened_at')->value('id'),
            'amount' => 25000,
            'bank_name' => 'Meezan Bank',
            'account_label' => 'Current — 0201',
            'slip_number' => 'DEP-'.now()->format('ymd').'-01',
            'deposited_at' => now()->subDay()->setTime(17, 40),
            'deposited_by' => $owner->id,
            'notes' => 'Yesterday’s takings, walked to the branch.',
        ]);
    }

    /** Somebody has to carry the order. */
    private function seedRiders(Tenant $tenant): void
    {
        if (! $tenant->featureEnabled('delivery')) {
            return;
        }

        foreach ([['Imran Ali', '+923451112233'], ['Zeeshan Haider', '+923454445566']] as [$name, $phone]) {
            Rider::withoutTenancy()->firstOrCreate(
                ['tenant_id' => $tenant->id, 'phone' => $phone],
                ['name' => $name, 'is_active' => true],
            );
        }
    }

    /**
     * Packs. A shop buys a case and sells a piece, and the till has to price
     * both off one stock figure.
     */
    private function seedPacks(Tenant $tenant): void
    {
        if (! in_array($tenant->business_type, ['mart', 'pharmacy'], true)) {
            return;
        }

        if (ProductUnit::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return;
        }

        $products = Product::query()
            ->where('track_inventory', true)
            ->doesntHave('variants')
            ->orderBy('name')
            ->take(2)
            ->get();

        $seq = 900;
        foreach ($products as $product) {
            app(SyncProductUnitsAction::class)->execute($product, [
                [
                    'name' => 'Pack of 6', 'factor' => 6,
                    'price' => round((float) $product->price * 6 * 0.95, 2),
                    'barcode' => $this->demoBarcode($seq++),
                ],
                [
                    'name' => 'Case of 24', 'factor' => 24,
                    'price' => round((float) $product->price * 24 * 0.9, 2),
                    'barcode' => $this->demoBarcode($seq++),
                ],
            ]);
        }
    }

    /**
     * The dates on the box.
     *
     * A pharmacy's whole inventory question is WHICH LOT, and only the three
     * items on the demo purchase order had one — so FEFO had nothing to order,
     * the near-expiry count on the dashboard was always zero, and the expiry
     * alerts had nothing to speak about. A tyre has the other half of the same
     * problem: it does not expire, it AGES, and its date is a DOT code.
     */
    private function seedLots(Tenant $tenant, User $owner): void
    {
        if (! $tenant->featureEnabled('inventory')) {
            return;
        }

        $branchId = $this->mainBranchId($tenant);
        $tyreish = $tenant->business_type === 'automotive';

        // HAS THIS PASS ALREADY RUN? Not "does the shop have any lot" — the
        // received purchase order writes lots of its own, so that question is
        // already true on the first run and this would never fire. And not the
        // per-product `whereDoesntHave` below either: that is a fine filter and
        // a useless guard, because on the next run it simply picks the next
        // eight products without lots. The seeder promises a re-run changes
        // nothing, and this one grew the world by eight items a time.
        if (ProductBatch::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->withTrashed()
            ->where('batch_number', 'like', 'LOT-%')
            ->exists()) {
            return;
        }

        // Only items that carry no lot yet, and each item's lots sum to the
        // stock already on hand — inventing quantity here would make the batch
        // page and the stock figure disagree on day one.
        $needsLot = Product::query()
            ->where('track_inventory', true)
            ->where('stock_quantity', '>', 0)
            ->doesntHave('variants')
            ->when($tenant->business_type === 'pharmacy', fn ($q) => $q->where('item_type', ItemTypes::MEDICINE))
            // A tyre's date is the point of the whole feature, so the tyres are
            // chosen in the QUERY. Filtering after take() picked six products
            // by name and then threw four of them away, which is how a demo
            // ends up with two dated tyres and a shop full of undated ones.
            ->when($tyreish, fn ($q) => $q->where(fn ($w) => $w
                ->where('name', 'like', '%Tyre%')
                ->orWhere('name', 'like', '%/% R%')))
            ->whereDoesntHave('batches')
            ->orderBy('name')
            ->take($tenant->business_type === 'pharmacy' ? 24 : 8)
            ->get();

        $expired = null;

        foreach ($needsLot as $i => $product) {
            $onHand = (float) $product->stock_quantity;
            if ($onHand <= 0) {
                continue;
            }

            // A spread, not one date: comfortable, and inside the alert window.
            // The pharmacy dashboard's near-expiry count is only a real number
            // when the shelf actually holds a range.
            $months = [18, 11, 2, 7][$i % 4];

            // EXACTLY ONE lot in the shop is past its date, and it does not
            // stay: it is written off at the bottom of this method.
            //
            // Expired stock left sitting is not "a bit of realism" — the
            // expired-quantity fence in InventoryService subtracts it from
            // what may be sold, so a product whose only lot has expired cannot
            // be rung at all. Seeded eleven of those first time round: eleven
            // demo products that refused to sell and looked broken doing it.
            $lots = $i === 0 && $onHand >= 4
                ? [[round($onHand * 0.7, 3), $months], [round($onHand * 0.3, 3), -2]]
                : [[$onHand, $months]];

            foreach ($lots as $n => [$qty, $ageMonths]) {
                $built = now()->subMonths(max(1, 24 - $ageMonths));

                $batch = ProductBatch::withoutTenancy()->create([
                    'tenant_id' => $tenant->id,
                    'branch_id' => $branchId,
                    'product_id' => $product->id,
                    'batch_number' => 'LOT-'.str_pad((string) ($i + 1), 3, '0', STR_PAD_LEFT).chr(65 + $n),
                    // A tyre does not expire; it ages. The date it carries is
                    // the week it was BUILT, printed as a DOT code.
                    'expiry_date' => $tyreish ? null : now()->addMonths($ageMonths)->toDateString(),
                    'dot_code' => $tyreish
                        ? str_pad((string) (int) $built->format('W'), 2, '0', STR_PAD_LEFT).$built->format('y')
                        : null,
                    'manufactured_on' => $tyreish ? $built->startOfWeek()->toDateString() : null,
                    'quantity' => $qty,
                    'cost' => $product->cost,
                ]);

                if ($ageMonths < 0) {
                    $expired = $batch;
                }
            }
        }

        if (StockDisposal::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return;
        }

        // In the bin. Money already lost.
        if ($expired !== null) {
            app(DisposeBatchAction::class)->execute($owner, $expired, [
                'disposition' => StockDisposal::WRITTEN_OFF,
                'reason' => $tyreish ? 'damaged' : 'expired',
                'notes' => 'Found at the back of the shelf during the count.',
            ]);
        }

        // Sent back for credit. Money NOT lost yet — and the two are never
        // summed, which is the entire reason the disposition column exists.
        $supplier = Supplier::query()->first();
        $returnable = ProductBatch::query()
            ->where('quantity', '>', 0)
            ->orderBy('quantity')
            ->first();

        if ($supplier !== null && $returnable !== null) {
            app(DisposeBatchAction::class)->execute($owner, $returnable, [
                'disposition' => StockDisposal::RETURNED,
                'reason' => 'damaged',
                'supplier_id' => $supplier->id,
                'credit_expected' => round((float) $returnable->quantity * (float) ($returnable->cost ?? 0), 2),
                'notes' => 'Cartons crushed in transit — collected by the rep.',
            ]);
        }
    }

    /** Stock moving between two of a chain's own branches. */
    private function seedTransfer(Tenant $tenant, User $owner): void
    {
        $branches = $this->branchIds($tenant);
        if (count($branches) < 2) {
            return;
        }

        if (StockTransfer::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return;
        }

        $movable = Product::query()
            ->where('track_inventory', true)
            ->where('stock_quantity', '>', 12)
            ->doesntHave('variants')
            ->take(2)
            ->get();

        if ($movable->isEmpty()) {
            return;
        }

        app(TransferStockAction::class)->execute($tenant, [
            'from_branch_id' => $branches[0],
            'to_branch_id' => $branches[1],
            'notes' => 'Topping up the new branch before the weekend.',
            'items' => $movable->map(fn (Product $p) => [
                'product_id' => $p->id,
                'quantity' => 5,
            ])->all(),
        ]);
    }

    /**
     * A count that found something.
     *
     * Scoped to one category rather than the whole shop, because that is how a
     * count is actually run — an aisle at a time — and a 50-line sheet with
     * three figures on it reads as an abandoned count rather than a finished
     * one.
     */
    private function seedStockCount(Tenant $tenant, User $owner): void
    {
        if (! $tenant->featureEnabled('inventory')) {
            return;
        }

        if (StockCount::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            return;
        }

        $categoryId = Product::query()
            ->where('track_inventory', true)
            ->whereNotNull('category_id')
            ->groupBy('category_id')
            ->havingRaw('COUNT(*) >= 3')
            ->value('category_id');

        if ($categoryId === null) {
            return;
        }

        $count = app(StartStockCountAction::class)->execute($owner, $tenant->id, [
            'branch_id' => $this->mainBranchId($tenant),
            'scope' => 'category',
            'category_id' => $categoryId,
            'blind' => true,
            'notes' => 'Monthly count — one aisle.',
        ]);

        $lines = StockCountItem::query()
            ->where('stock_count_id', $count->id)
            ->orderBy('product_name')
            ->take(4)
            ->get();

        // Two shelves that matched, one short and one over. A count where
        // everything agrees proves nothing about the variance column.
        $offsets = [0, 0, -2, 1];

        app(RecordStockCountAction::class)->execute($owner, $count, $lines->values()->map(fn ($line, $i) => [
            'item_id' => $line->id,
            'counted_quantity' => max(0, (float) $line->expected_quantity + $offsets[$i % 4]),
        ])->all());

        app(ApplyStockCountAction::class)->execute($owner, $count->refresh(), 'Applied after recount of the two odd lines.');
    }

    // ── Money-block helpers ──────────────────────────────────────────

    private function ownerOf(Tenant $tenant): ?User
    {
        return User::query()
            ->where('tenant_id', $tenant->id)
            ->where('role', UserRole::ShopOwner)
            ->first();
    }

    private function mainBranchId(Tenant $tenant): ?string
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('is_default', true)->value('id');
    }

    /** @return list<string> */
    private function branchIds(Tenant $tenant): array
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('is_default')
            ->pluck('id')
            ->all();
    }

    private function expenseCategoryNamed(Tenant $tenant, array $names): ?ExpenseCategory
    {
        return ExpenseCategory::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->whereIn('name', $names)
            ->first()
            ?? ExpenseCategory::withoutTenancy()->where('tenant_id', $tenant->id)->first();
    }

    /**
     * A real file on the public disk, written once and shared by every demo
     * tenant. A path pointing at nothing would render a broken link, which
     * demonstrates the opposite of what the receipt feature does.
     */
    private function demoReceiptPath(): string
    {
        $path = 'demo/receipt.svg';

        if (! Storage::disk('public')->exists($path)) {
            Storage::disk('public')->put($path, <<<'SVG'
            <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
              <rect width="320" height="200" fill="#ffffff"/>
              <rect x="0.5" y="0.5" width="319" height="199" fill="none" stroke="#d4d4d8"/>
              <text x="24" y="52" font-family="monospace" font-size="17" fill="#18181b">DEMO RECEIPT</text>
              <line x1="24" y1="68" x2="296" y2="68" stroke="#d4d4d8"/>
              <text x="24" y="98" font-family="monospace" font-size="13" fill="#3f3f46">Owner investment</text>
              <text x="24" y="122" font-family="monospace" font-size="13" fill="#3f3f46">Bank transfer</text>
              <text x="24" y="158" font-family="monospace" font-size="19" fill="#18181b">PKR 80,000</text>
            </svg>
            SVG);
        }

        return $path;
    }

    private function seedExtraBranches(Tenant $tenant, array $names): void
    {
        foreach ($names as $i => $name) {
            Branch::withoutTenancy()->updateOrCreate(
                ['tenant_id' => $tenant->id, 'name' => $name],
                [
                    'code' => 'BR'.str_pad((string) ($i + 2), 2, '0', STR_PAD_LEFT),
                    'is_default' => false,
                    'is_active' => true,
                    'address' => "{$name}, {$tenant->business_name}",
                    'city_id' => $tenant->city_id,
                ],
            );
        }
    }

    /**
     * A few months of billing history + varied subscription end dates so the
     * Super Admin billing screens show active / expiring-soon / expired.
     */
    private function seedSubscriptionPayments(Tenant $tenant, Plan $plan, int $index): void
    {
        // Give tenants varied expiry so the "expiring soon" / "expired"
        // buckets are populated: index 3 expires soon, index 6 expired.
        $endsAt = match (true) {
            $index === 3 => now()->addDays(4),   // expiring soon
            $index === 6 => now()->subDays(3),   // expired (grace/read-only)
            default => now()->addMonths(random_int(1, 6)),
        };
        $tenant->forceFill(['subscription_ends_at' => $endsAt])->save();

        // Skip a ledger row for the free (price 0) plan.
        if ((float) $plan->price <= 0) {
            // Still add a nominal fee for demo realism on the free tiers, so
            // the billing screens have a ledger to show.
            $monthly = match ($plan->code) {
                'enterprise' => 6000,
                'premium' => 3000,
                default => 1500,
            };
        } else {
            $monthly = (float) $plan->price;
        }

        // 3 past monthly payments.
        foreach (range(3, 1) as $monthsAgo) {
            $start = now()->subMonths($monthsAgo)->startOfMonth();
            SubscriptionPayment::query()->create([
                'tenant_id' => $tenant->id,
                'plan_id' => $plan->id,
                'plan_name' => $plan->name,
                'amount' => $monthly,
                'method' => ['cash', 'bank_transfer', 'card'][$monthsAgo % 3],
                'reference' => 'DEMO-'.strtoupper(substr($tenant->slug, 0, 4)).'-'.$monthsAgo,
                'period_start' => $start->toDateString(),
                'period_end' => $start->copy()->endOfMonth()->toDateString(),
                'paid_at' => $start,
            ]);
        }
    }

    /** @param User[] $customers @param Tenant[] $tenants */
    private function seedFavorites(array $customers, array $tenants): void
    {
        $online = array_values(array_filter($tenants, fn (Tenant $t) => $t->sellsOnline()));

        foreach (array_slice($customers, 0, 6) as $i => $customer) {
            $shop = $online[$i % count($online)];

            DB::table('customer_favorites')->updateOrInsert(
                ['user_id' => $customer->id, 'tenant_id' => $shop->id],
                ['id' => (string) Str::uuid7(), 'created_at' => now(), 'updated_at' => now()],
            );
        }
    }

    /** @param User[] $customers @param Tenant[] $tenants */
    private function seedReservations(array $customers, array $tenants): void
    {
        $reservable = array_values(array_filter(
            $tenants,
            fn (Tenant $t) => $t->sellsOnline() && $t->featureEnabled('reservations'),
        ));

        foreach (array_slice($reservable, 0, 3) as $i => $shop) {
            $product = Product::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->where('type', 'product')
                ->where('stock_quantity', '>', 1)
                ->first();

            if ($product === null) {
                continue;
            }

            $exists = Reservation::withoutTenancy()
                ->where('tenant_id', $shop->id)
                ->where('status', ReservationStatus::Pending)
                ->exists();

            if ($exists) {
                continue;
            }

            Reservation::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'customer_id' => $customers[$i]->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'unit_price' => $product->price,
                'quantity' => 1,
                'status' => ReservationStatus::Pending,
                'notes' => 'Will pick up this evening',
                'expires_at' => now()->addHours(24),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────

    /**
     * One tenant per PRIMARY business type, each on a fitting plan, each with a
     * 50-item type-appropriate catalog (see catalogFor).
     *   Owners: tenant1@app.com … tenant5@app.com / password
     */
    private function tenantBlueprints(): array
    {
        // Each shop names its PLAN (what it pays and how much it may hold), the
        // MODULES it was actually given, and the LIMITS assigned to it. The
        // three are independent on purpose, and the demo world is picked to
        // show that they are:
        //
        //   · MediPlus is on Basic, has no online store, and still delivers —
        //     the pharmacy that takes orders on the phone.
        //   · Highway Fuel and Sahil Tyre are both plain Basic shops and each
        //     keeps its trade module (forecourt, workshop labour).
        //   · Karachi Books runs the cashbook alone with no catalog and no
        //     till, on the same Basic plan as everybody else — the case that
        //     used to need a plan of its own.
        //   · Karahi House is on a bespoke plan: a chain that negotiated its
        //     own ceiling rather than climbing to Enterprise.
        return [
            ['name' => 'Karahi House', 'type' => 'food', 'category' => 'restaurant',
                'plan' => 'karahi-house-custom', 'items' => $this->catalogFor('food'),
                'modules' => ['marketplace' => true, 'delivery' => true, 'dine_in' => true],
                'limits' => ['branches' => 4, 'staff' => 30, 'registers' => 6]],

            ['name' => 'FreshMart Grocery', 'type' => 'mart', 'category' => 'supermarket',
                'plan' => 'premium', 'items' => $this->catalogFor('mart'),
                'modules' => ['marketplace' => true, 'delivery' => true],
                'limits' => ['branches' => 3, 'staff' => 20, 'registers' => 5]],

            ['name' => 'MediPlus Pharmacy', 'type' => 'pharmacy', 'category' => 'medical_store',
                'plan' => 'basic', 'items' => $this->catalogFor('pharmacy'),
                'modules' => ['marketplace' => false, 'delivery' => true],
                'limits' => ['branches' => 2, 'staff' => 6, 'registers' => 2]],

            ['name' => 'Trendz Retail', 'type' => 'retail', 'category' => 'garments',
                'plan' => 'premium', 'items' => $this->catalogFor('retail'),
                'modules' => ['marketplace' => true, 'delivery' => true, 'reservations' => true],
                'limits' => ['branches' => 2, 'staff' => 10, 'registers' => 3]],

            ['name' => 'GlowUp Salon & Studio', 'type' => 'services', 'category' => 'salon_beauty',
                'plan' => 'basic', 'items' => $this->catalogFor('services'),
                'modules' => [],
                'limits' => ['branches' => 1, 'staff' => 8, 'registers' => 1]],

            ['name' => 'Highway Fuel Station', 'type' => 'petroleum', 'category' => 'petrol_pump',
                'plan' => 'basic', 'items' => $this->catalogFor('petroleum'),
                'modules' => ['fuel' => true],
                'limits' => ['branches' => 1, 'staff' => 12, 'registers' => 2]],

            ['name' => 'Sahil Tyre & Auto', 'type' => 'automotive', 'category' => 'tyre_shop',
                'plan' => 'basic', 'items' => $this->catalogFor('automotive'),
                'modules' => [],
                'limits' => ['branches' => 1, 'staff' => 6, 'registers' => 1]],

            ['name' => 'Karachi Books & Ledgers', 'type' => 'finance', 'category' => 'agency',
                'plan' => 'basic', 'items' => [],
                'modules' => [],
                'limits' => ['branches' => 1, 'staff' => 4]],

            // The only multi-branch shop in the demo world, and the reason it
            // exists: every money screen scopes by branch, and with one branch
            // per tenant a scoping bug looks exactly like a working one. Its
            // sales, expenses and refunds are spread across both.
            ['name' => 'Metro Chain Superstore', 'type' => 'mart', 'category' => 'supermarket',
                'plan' => 'enterprise', 'items' => $this->catalogFor('mart'),
                'modules' => ['marketplace' => true, 'delivery' => true],
                'branches' => ['Gulshan Branch', 'Korangi Branch'],
                'limits' => ['branches' => 12, 'staff' => 120, 'registers' => 24]],
        ];
    }

    /** A 50-item catalog tuned to the business type. */
    private function catalogFor(string $type): array
    {
        return match ($type) {
            'food' => $this->foodCatalog(),
            'mart' => $this->martCatalog(),
            'pharmacy' => $this->pharmacyCatalog(),
            'retail' => $this->retailCatalog(),
            'services' => $this->servicesCatalog(),
            'petroleum' => $this->petroleumCatalog(),
            'automotive' => $this->automotiveCatalog(),
            default => [],
        };
    }

    /**
     * A tyre and auto shop: goods and labour on the same invoice. Tyres carry
     * their size in the name because that is how a customer asks for one, and
     * fitting/balancing are service lines with no stock behind them.
     */
    private function automotiveCatalog(): array
    {
        $items = [];

        foreach ([
            ['General 185/65 R15', 14500, 'Tyres'], ['General 195/65 R15', 15800, 'Tyres'],
            ['Yokohama 205/55 R16', 22500, 'Tyres'], ['Dunlop 155/70 R13', 9800, 'Tyres'],
            ['Bridgestone 215/60 R17', 28900, 'Tyres'], ['Panther 145/70 R12', 7200, 'Tyres'],
            ['CEAT 165/65 R14', 11200, 'Tyres'], ['MRF 175/70 R13', 10400, 'Tyres'],
        ] as [$name, $price, $category]) {
            $items[] = [
                'name' => $name, 'category' => $category, 'price' => $price,
                'cost' => (int) round($price * 0.78), 'stock' => random_int(4, 40),
                'low_at' => 4, 'unit' => 'Piece', 'brand' => explode(' ', $name)[0],
            ];
        }

        foreach ([
            ['Osaka S-70 Battery (12V 70Ah)', 24500, 'Batteries'],
            ['Exide 55Ah Battery', 18900, 'Batteries'],
            ['AGS Washer 100Ah', 33500, 'Batteries'],
            ['Tube 13"', 950, 'Tubes & Rims'],
            ['Alloy Rim 15" (set of 4)', 42000, 'Tubes & Rims'],
            ['Shell Helix 5W-30 (4L)', 8400, 'Lubricants & Oils'],
            ['ZIC X7 10W-40 (4L)', 7200, 'Lubricants & Oils'],
            ['Brake Pads — Corolla (front)', 5600, 'Spare Parts'],
            ['Air Filter — Civic', 2400, 'Spare Parts'],
            ['Wiper Blade Pair', 1800, 'Accessories'],
            ['Car Mat Set', 3200, 'Accessories'],
        ] as [$name, $price, $category]) {
            $items[] = [
                'name' => $name, 'category' => $category, 'price' => $price,
                'cost' => (int) round($price * 0.75), 'stock' => random_int(3, 30),
                'low_at' => 3, 'unit' => 'Piece',
            ];
        }

        // Labour: billed by the job, nothing to count in a store room.
        foreach ([
            ['Tyre Fitting (per wheel)', 250, 15], ['Wheel Balancing (per wheel)', 350, 20],
            ['Wheel Alignment', 1500, 45], ['Puncture Repair', 400, 20],
            ['Battery Fitting & Check', 500, 20], ['Oil Change (labour)', 800, 30],
            ['AC Gas Refill', 4500, 60], ['Suspension Check', 1200, 40],
        ] as [$name, $price, $minutes]) {
            $items[] = [
                'name' => $name, 'category' => 'Labour & Services', 'type' => 'service',
                'price' => $price, 'track' => false, 'unit' => 'Job', 'duration' => $minutes,
            ];
        }

        return $items;
    }

    /**
     * A fuel station: fuel sold by the litre (fractional), lubricants + auto
     * accessories + tyres + a forecourt mart (all stocked), and the wash /
     * service bay as service lines.
     */
    private function petroleumCatalog(): array
    {
        // Fuel — sold by the litre, thin margin, large tank stock.
        $fuel = [];
        foreach ([['Petrol (Super)', 290], ['Hi-Octane', 320], ['Diesel (HSD)', 285]] as [$name, $price]) {
            $fuel[] = [
                'name' => $name, 'category' => 'Fuel', 'price' => $price,
                'cost' => (int) round($price * 0.95), 'stock' => random_int(3000, 8000),
                'low_at' => 1000, 'sold_by' => 'weight', 'unit' => 'Litre',
            ];
        }

        $goods = $this->stocked([
            'Lubricants & Oils' => [
                ['Engine Oil 1L (5W-30)', 1800], ['Engine Oil 4L (10W-40)', 6500],
                ['Gear Oil 1L', 1400], ['Brake Fluid 500ml', 700], ['Coolant 1L', 900],
            ],
            'Auto Accessories' => [
                ['Wiper Blade', 850], ['Air Freshener', 350], ['Car Shampoo 1L', 650],
                ['Microfiber Cloth', 300], ['Phone Mount', 1200],
            ],
            'Tyres & Batteries' => [
                ['Tubeless Tyre 13"', 12000], ['Car Battery 45Ah', 16500], ['Valve Cap Set', 200],
            ],
            'Convenience Store' => [
                ['Mineral Water 1.5L', 100], ['Soft Drink Can', 120], ['Energy Drink', 250],
                ['Chips', 100], ['Chocolate Bar', 150],
            ],
        ]);

        $services = $this->serviceItems([
            'Services' => [
                ['Car Wash (Standard)', 500, 30], ['Car Wash (Premium)', 1200, 60],
                ['Oil Change Service', 800, 45], ['Tyre Fitting', 300, 20],
            ],
        ]);

        return array_merge($fuel, $goods, $services);
    }

    /** Tracked physical goods: cost ≈ 62% of price, healthy stock, low-at 10. */
    private function stocked(array $groups): array
    {
        $out = [];
        foreach ($groups as $category => $rows) {
            foreach ($rows as [$name, $price]) {
                $out[] = [
                    'name' => $name, 'category' => $category, 'price' => $price,
                    'cost' => (int) round($price * 0.62),
                    'stock' => random_int(15, 140), 'low_at' => 10,
                ];
            }
        }

        return $out;
    }

    /**
     * Attach SIZES to named rows of a flat catalog.
     *
     * The seeder has had a variant reader since the first import and nothing
     * ever wrote one, so `product_variants` was empty in every demo shop —
     * the same reader-with-no-writer shape that left variant barcodes unused.
     * Everything built on sizes (the picker, per-size 86, per-size recipes, a
     * deal that names a size) had no demo data to stand on.
     *
     * A size keeps the item's MARGIN rather than its cost: a Large that costs
     * the shop the same as a Regular is not a bigger drink.
     *
     * @param  array<string, list<array{0:string,1:int|float,2?:int}>>  $spec  name => [[size, price, stock?], …]
     */
    private function sized(array $items, array $spec): array
    {
        foreach ($items as $i => $item) {
            $rows = $spec[$item['name']] ?? null;
            if ($rows === null) {
                continue;
            }

            $ratio = ($item['price'] ?? 0) > 0 ? (float) ($item['cost'] ?? 0) / (float) $item['price'] : 0.0;

            $items[$i]['variants'] = array_map(fn (array $r) => [
                'name' => $r[0],
                'price' => $r[1],
                'cost' => $ratio > 0 ? (int) round($r[1] * $ratio) : null,
                'stock' => $r[2] ?? 0,
                'low_at' => $item['low_at'] ?? null,
            ], $rows);
        }

        return $items;
    }

    /**
     * Attach MODIFIER GROUPS to named rows — "how would you like it".
     *
     * The third reader in this file that nothing ever wrote to: a restaurant
     * demo could not show a spice level or an add-on, which for a till is one
     * of the two things the item screen is FOR.
     *
     * @param  array<string, list<array{0:string,1:string,2:int,3:int,4:list<array{0:string,1:int|float}>}>>  $spec
     */
    private function withModifiers(array $items, array $spec): array
    {
        foreach ($items as $i => $item) {
            $groups = $spec[$item['name']] ?? null;
            if ($groups === null) {
                continue;
            }

            $items[$i]['modifiers'] = array_map(fn (array $g): array => [
                'name' => $g[0], 'type' => $g[1], 'min' => $g[2], 'max' => $g[3], 'options' => $g[4],
            ], $groups);
        }

        return $items;
    }

    /**
     * Mark named rows as SERIALIZED — every piece carries its own number.
     *
     * Retail only, which is where the feature is fenced: a shop that sells
     * phones hands over a specific IMEI, and the warranty desk and the
     * per-serial return both start from that row existing.
     */
    private function serialized(array $items, array $names, int $warrantyMonths): array
    {
        foreach ($items as $i => $item) {
            if (in_array($item['name'], $names, true)) {
                $items[$i]['serialized'] = true;
                $items[$i]['warranty'] = $warrantyMonths;
            }
        }

        return $items;
    }

    /**
     * Kitchen stock: what a dish is MADE of. Tracked, priced per unit, and
     * kept off the menu — a customer ordering a biryani should not be offered
     * a kilo of raw chicken. rows = [name, price, unit].
     */
    private function ingredientItems(array $rows): array
    {
        $out = [];
        foreach ($rows as [$name, $price, $unit]) {
            $out[] = [
                'name' => $name, 'category' => 'Ingredients', 'price' => $price,
                'cost' => (int) round($price * 0.8), 'stock' => random_int(20, 90),
                'low_at' => 10, 'unit' => $unit, 'visible' => false,
                'sold_by' => in_array($unit, ['KG', 'Litre'], true) ? 'weight' : 'unit',
            ];
        }

        return $out;
    }

    /** Made-to-order items (food): no stock tracking, food-margin cost. */
    private function madeToOrder(array $groups): array
    {
        $out = [];
        foreach ($groups as $category => $rows) {
            foreach ($rows as [$name, $price]) {
                $out[] = [
                    'name' => $name, 'category' => $category, 'price' => $price,
                    'cost' => (int) round($price * 0.4), 'track' => false,
                ];
            }
        }

        return $out;
    }

    /** Service items: type=service, a duration, no stock. rows = [name, price, minutes]. */
    private function serviceItems(array $groups): array
    {
        $out = [];
        foreach ($groups as $category => $rows) {
            foreach ($rows as [$name, $price, $duration]) {
                $out[] = [
                    'name' => $name, 'category' => $category, 'type' => 'service',
                    'price' => $price, 'duration' => $duration,
                ];
            }
        }

        return $out;
    }

    private function foodCatalog(): array
    {
        $menu = $this->madeToOrder([
            'Starters' => [
                ['Chicken Samosa', 120], ['Spring Rolls', 180], ['Garlic Bread', 250], ['Chicken Wings', 450],
                ['Loaded Fries', 400], ['Vegetable Pakora', 150], ['Chicken Corn Soup', 300], ['Hot & Sour Soup', 320],
                ['Nachos Supreme', 480], ['Mozzarella Sticks', 420],
            ],
            'Main Course' => [
                ['Chicken Biryani', 450], ['Beef Biryani', 500], ['Mutton Pulao', 650], ['Chicken Karahi Half', 900],
                ['Chicken Karahi Full', 1700], ['Beef Nihari', 550], ['Butter Chicken', 780], ['Daal Makhani', 400],
                ['Palak Paneer', 520], ['Seekh Kebab Plate', 600], ['Chapli Kebab', 350], ['Chicken Handi', 850],
                ['Fish Fry', 700], ['Grilled Chicken', 680], ['Zinger Burger', 550],
            ],
            'Beverages' => [
                ['Soft Drink 500ml', 120], ['Fresh Lime', 180], ['Mango Shake', 300], ['Cold Coffee', 350],
                ['Kashmiri Chai', 220], ['Green Tea', 150], ['Mineral Water', 80], ['Sweet Lassi', 200],
                ['Fresh Orange Juice', 320], ['Mint Margarita', 280],
            ],
            'Desserts' => [
                ['Gulab Jamun', 180], ['Kheer', 220], ['Vanilla Ice Cream', 150], ['Chocolate Brownie', 350],
                ['Cheesecake Slice', 420], ['Ras Malai', 250], ['Fruit Trifle', 300], ['Molten Lava Cake', 380],
                ['Kulfa', 200], ['Gajar Halwa', 260],
            ],
        ]);

        // A menu with SIZES. Half and Full karahi are already two products
        // above, which is the shape a restaurant used before sizes existed and
        // is left alone deliberately — these four show the other shape, where
        // one dish is ordered in more than one size and the till has to ask.
        $menu = $this->sized($menu, [
            'Chicken Biryani' => [['Single', 450], ['Family', 1600]],
            'Chicken Wings' => [['6 pcs', 450], ['12 pcs', 850]],
            'Cold Coffee' => [['Regular', 350], ['Large', 450]],
            'Mango Shake' => [['Regular', 300], ['Large', 400]],
        ]);

        $menu = $this->withModifiers($menu, [
            'Zinger Burger' => [
                ['Spice level', 'modifier', 1, 1, [['Mild', 0], ['Hot', 0], ['Extra Hot', 0]]],
                ['Add-ons', 'addon', 0, 3, [['Extra Cheese', 80], ['Extra Patty', 250], ['Jalapenos', 60]]],
            ],
            'Chicken Karahi Full' => [
                ['Bread', 'addon', 0, 6, [['Roti', 30], ['Naan', 60], ['Garlic Naan', 110], ['Paratha', 90]]],
                ['Make it', 'modifier', 1, 1, [['Regular', 0], ['Extra Spicy', 0], ['Less Oil', 0]]],
            ],
            'Cold Coffee' => [
                ['Sugar', 'modifier', 1, 1, [['No Sugar', 0], ['Regular', 0], ['Extra Sweet', 0]]],
                ['Add', 'addon', 0, 2, [['Extra Shot', 120], ['Whipped Cream', 90]]],
            ],
            'Grilled Chicken' => [
                ['Sauce', 'addon', 0, 2, [['BBQ', 50], ['Garlic Mayo', 50], ['Hot Sauce', 50]]],
            ],
        ]);

        // The deals are DEALS. `Product::isCombo()` reads item_type and nothing
        // else, so a deal seeded as an ordinary dish is a bundle whose
        // components no screen will ever look for.
        $deals = array_map(
            fn (array $row): array => $row + ['item_type' => ItemTypes::DEAL],
            $this->madeToOrder([
                'Deals' => [
                    ['Family Deal', 2999], ['Couple Deal', 1799], ['Solo Lunch Deal', 650], ['Party Platter', 4500], ['Ramzan Special', 1299],
                ],
            ]),
        );

        // And what the kitchen consumes. Without a single ingredient in the
        // catalog, `RecipeCost` had nothing to price: every food margin in the
        // demo world was the flat 40% that madeToOrder() types in, and the
        // recipe screens had nothing to show at all.
        $ingredients = $this->ingredientItems([
            ['Chicken (raw)', 900, 'KG'], ['Mutton (raw)', 2200, 'KG'],
            ['Basmati Rice', 520, 'KG'], ['Cooking Oil', 620, 'Litre'],
            ['Yogurt', 320, 'KG'], ['Onion', 120, 'KG'], ['Tomato', 150, 'KG'],
            ['Ginger Garlic Paste', 380, 'KG'], ['Biryani Masala', 260, 'Pack'],
            ['Fresh Milk', 220, 'Litre'], ['Coffee Powder', 850, 'Pack'],
            ['Sugar', 180, 'KG'], ['Mango Pulp', 700, 'KG'],
            ['Vanilla Ice Cream Tub', 900, 'Litre'], ['Chicken Wings (raw)', 1100, 'KG'],
        ]);

        return array_merge($menu, $deals, $ingredients);
    }

    private function martCatalog(): array
    {
        return $this->stocked([
            'Food & Beverages' => [
                ['Basmati Rice 5kg', 2400], ['Cooking Oil 1L', 620], ['Sugar 1kg', 180], ['Wheat Flour 10kg', 1300],
                ['Tea 950g', 1450], ['Red Chilli Powder 200g', 260], ['Turmeric 200g', 180], ['Salt 800g', 60],
                ['Chana Daal 1kg', 320], ['White Beans 1kg', 400], ['Ketchup 1L', 480], ['Vinegar 800ml', 220],
                ['Cooking Oil 5L', 2800], ['Basmati Rice 1kg', 520], ['Instant Noodles Pack', 350],
            ],
            'Household' => [
                ['Dishwash Liquid', 350], ['Laundry Detergent 1kg', 650], ['Floor Cleaner 1L', 420], ['Toilet Cleaner', 320],
                ['Garbage Bags 30pc', 280], ['Air Freshener', 380], ['Steel Scrubber', 90], ['Tissue Box', 250],
                ['Aluminium Foil', 300], ['Matchbox Pack', 60],
            ],
            'Personal Care' => [
                ['Shampoo 400ml', 480], ['Bath Soap Pack', 320], ['Toothpaste 150g', 250], ['Toothbrush', 120],
                ['Hand Wash', 350], ['Face Wash', 420], ['Body Lotion', 550], ['Shaving Cream', 380],
                ['Hair Oil 200ml', 300], ['Deodorant', 480],
            ],
            'Snacks' => [
                ['Potato Chips Family', 150], ['Biscuits Pack', 120], ['Chocolate Bar', 200], ['Namkeen 250g', 180],
                ['Popcorn', 100], ['Juice Box', 90], ['Wafer Rolls', 160], ['Salted Peanuts', 140],
            ],
            'Dairy' => [
                ['Fresh Milk 1L', 220], ['Yogurt 1kg', 320], ['Butter 200g', 480], ['Cheese Slices', 550],
                ['Cream 200ml', 260], ['Eggs Dozen', 340], ['Paneer 250g', 400],
            ],
        ]);
    }

    private function pharmacyCatalog(): array
    {
        return $this->stocked([
            'Medicines' => [
                ['Panadol 500mg', 30], ['Disprin', 20], ['Brufen 400mg', 45], ['Augmentin 625mg', 350], ['Ponstan Forte', 60],
                ['Flagyl 400mg', 80], ['Risek 20mg', 250], ['Nexium 40mg', 320], ['Panadol Extra', 50], ['Calpol Syrup', 90],
                ['Ventolin Inhaler', 450], ['Amoxil 500mg', 180], ['Septran DS', 70], ['Loprin 75mg', 40], ['Concor 5mg', 220],
                ['Glucophage 500mg', 120], ['Zyrtec 10mg', 160], ['Arinac Forte', 85], ['Neurobion Tablets', 240], ['Surbex Z', 380],
            ],
            'Supplements' => [
                ['Vitamin C 1000mg', 450], ['Calcium D3', 520], ['Omega 3 Fish Oil', 780], ['Multivitamin', 650], ['Vitamin D3 Sachet', 90],
                ['Iron Folic', 280], ['Zinc Tablets', 320], ['Protein Powder', 3200], ['Biotin', 590], ['Magnesium', 480],
            ],
            'Medical Supplies' => [
                ['Surgical Mask Box', 350], ['Hand Sanitizer 500ml', 320], ['Digital Thermometer', 850], ['BP Monitor', 4500],
                ['Glucometer', 3200], ['Cotton Roll', 120], ['Bandage Roll', 90], ['First Aid Kit', 1200],
            ],
            'Baby Care' => [
                ['Baby Diapers M 40pc', 1450], ['Baby Wipes', 320], ['Baby Lotion', 380], ['Baby Shampoo', 420],
                ['Feeding Bottle', 550], ['Baby Formula 400g', 1600],
            ],
            'Personal Care' => [
                ['Antiseptic Liquid', 280], ['Sunblock SPF50', 780], ['Lip Balm', 220], ['Moisturizer', 480],
                ['Medicated Soap', 180], ['Hair Removal Cream', 350],
            ],
        ]);
    }

    private function retailCatalog(): array
    {
        $items = $this->stocked([
            'Garments' => [
                ['Classic T-Shirt', 1200], ['Polo Shirt', 1600], ['Denim Jeans', 3500], ['Formal Shirt', 2400],
                ['Hoodie Premium', 4200], ['Summer Kurti', 2200], ['Ladies Abaya', 4500], ['Kids T-Shirt', 800],
                ['Cotton Trousers', 2200], ['Winter Jacket', 6500], ['Waistcoat', 3200], ['Shalwar Kameez', 3800],
            ],
            'Footwear' => [
                ['Street Sneakers', 6500], ['Leather Loafers', 5500], ['Casual Sandals', 1800], ['Sports Joggers', 4500],
                ['Peshawari Chappal', 2800], ['Kids Shoes', 1500], ['Formal Shoes', 4800], ['Slippers', 600],
            ],
            'Electronics' => [
                ['Bluetooth Speaker', 3500], ['Power Bank 10000mAh', 2800], ['LED Bulb 12W', 350], ['Extension Cord', 650],
                ['USB Fan', 900], ['Wall Clock', 1200], ['Dry Iron', 2400], ['Electric Kettle', 3200],
                ['Hair Dryer', 2800], ['Table Lamp', 1500],
            ],
            'Mobile & Accessories' => [
                ['Phone Cover', 450], ['Tempered Glass', 300], ['USB-C Cable', 350], ['Fast Charger', 1200],
                ['Wired Earphones', 600], ['Wireless Earbuds', 3500], ['Car Charger', 550], ['Selfie Stick', 800],
                ['Memory Card 32GB', 1100], ['Phone Stand', 400],
            ],
            'Cosmetics' => [
                ['Matte Lipstick', 650], ['Foundation', 1200], ['Kajal', 250], ['Nail Polish', 200], ['Face Powder', 850],
                ['Mascara', 700], ['Perfume 50ml', 2500], ['Body Spray', 480], ['Makeup Kit', 3500], ['Eyeliner', 350],
            ],
        ]);

        // A garment shop's whole stock question is per SIZE: the rail is not
        // out of shirts, it is out of Large. Stock lives on the sizes here and
        // the parent holds none — Product::stockOnHand() sums them.
        $items = $this->sized($items, [
            'Classic T-Shirt' => [['S', 1200, 12], ['M', 1200, 20], ['L', 1300, 15], ['XL', 1400, 6]],
            'Polo Shirt' => [['S', 1600, 8], ['M', 1600, 14], ['L', 1700, 11], ['XL', 1800, 4]],
            'Hoodie Premium' => [['M', 4200, 6], ['L', 4400, 9], ['XL', 4600, 3]],
            'Denim Jeans' => [['30', 3500, 5], ['32', 3500, 11], ['34', 3600, 8], ['36', 3700, 4]],
            'Summer Kurti' => [['S', 2200, 7], ['M', 2200, 13], ['L', 2300, 9]],
            'Street Sneakers' => [['39', 6500, 3], ['40', 6500, 6], ['41', 6600, 8], ['42', 6600, 5], ['43', 6700, 2]],
            'Formal Shoes' => [['40', 4800, 4], ['41', 4800, 7], ['42', 4900, 5], ['43', 5000, 2]],
        ]);

        // The pieces that leave the shop with a number on them.
        return $this->serialized($items, [
            'Bluetooth Speaker', 'Power Bank 10000mAh', 'Wireless Earbuds',
            'Dry Iron', 'Electric Kettle', 'Hair Dryer',
        ], 12);
    }

    private function servicesCatalog(): array
    {
        $services = $this->serviceItems([
            'Hair Services' => [
                ['Haircut (Gents)', 800, 30], ['Haircut (Ladies)', 1500, 45], ['Hair Color Full', 3500, 90],
                ['Hair Highlights', 4500, 120], ['Beard Trim', 400, 15], ['Hair Wash & Blow Dry', 1200, 40],
                ['Kids Haircut', 500, 20], ['Hair Straightening', 6000, 150], ['Head Massage', 900, 30], ['Hair Spa', 2500, 60],
            ],
            'Skin & Beauty' => [
                ['Deluxe Facial', 2500, 60], ['Basic Facial', 1500, 45], ['Threading', 300, 15], ['Full Arms Waxing', 800, 30],
                ['Manicure', 1200, 40], ['Pedicure', 1500, 45], ['Bridal Makeup', 15000, 180], ['Party Makeup', 6000, 90],
            ],
            'Spa' => [
                ['Full Body Massage', 4000, 90], ['Foot Reflexology', 2000, 45], ['Hot Stone Massage', 5000, 75],
                ['Steam Bath', 1500, 30], ['Body Scrub', 3000, 60], ['Aroma Therapy', 3500, 60], ['Back Massage', 1800, 40],
            ],
            'Packages' => [
                ['Bridal Package', 25000, 300], ['Groom Package', 8000, 150], ['Monthly Grooming', 5000, 60],
                ['Spa Day Package', 9000, 180], ['Couple Spa', 12000, 150],
            ],
        ]);

        $retail = $this->stocked([
            'Retail Products' => [
                ['Pro Shampoo', 850], ['Hair Serum', 1200], ['Hair Wax', 650], ['Pro Face Wash', 900], ['Pro Moisturizer', 1100],
                ['Pro Sunblock', 1300], ['Argan Hair Oil', 1500], ['Beard Oil', 800], ['Nail Polish Kit', 600], ['Makeup Remover', 550],
                ['Hair Mask', 1400], ['Pro Conditioner', 950], ['Pro Body Lotion', 1050], ['Signature Perfume', 3500], ['Comb Set', 350],
                ['Pro Hair Dryer', 4500], ['Hair Straightener', 5500], ['Trimmer', 3200], ['Towel Set', 1200], ['Cosmetic Bag', 900],
            ],
        ]);

        return array_merge($services, $retail);
    }
}
