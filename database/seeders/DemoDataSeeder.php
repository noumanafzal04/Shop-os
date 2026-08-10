<?php

namespace Database\Seeders;

use App\Actions\Pos\CloseCashSessionAction;
use App\Actions\Pos\OpenCashSessionAction;
use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Enums\ReservationStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Category;
use App\Models\City;
use App\Models\Collection;
use App\Models\CustomerGroup;
use App\Models\Expense;
use App\Models\ExpenseBudget;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Promotion;
use App\Models\RecurringExpense;
use App\Models\Reservation;
use App\Models\Sale;
use App\Models\SubscriptionPayment;
use App\Models\Supplier;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
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

        $this->seedFavorites($customers, $tenants);
        $this->seedReservations($customers, $tenants);
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
            $this->seedSubscriptionPayments($tenant, $plan, $index);
        }

        $on = collect($tenant->refresh()->features ?? [])->filter()->keys()->implode(', ');
        $this->command?->info("  ✓ {$blueprint['name']} ({$blueprint['type']}, {$city->name}, {$plan->name}) — {$on}");

        return $tenant->refresh();
    }

    private function seedProducts(Tenant $tenant, array $items, string $businessType): void
    {
        $mainBranchId = Branch::withoutTenancy()
            ->where('tenant_id', $tenant->id)->where('is_default', true)->value('id');

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
            // (primary codes food/pharmacy + their legacy aliases).
            $itemType = match (true) {
                $coarse === 'service' => ItemTypes::SERVICE,
                in_array($businessType, ['food', 'restaurant'], true) => ItemTypes::FOOD,
                in_array($businessType, ['pharmacy', 'clinic'], true) => ItemTypes::MEDICINE,
                default => ItemTypes::PHYSICAL,
            };

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
                'price' => $item['price'],
                'cost' => $item['cost'] ?? null,
                'stock_quantity' => $item['stock'] ?? 0,
                'low_stock_threshold' => $item['low_at'] ?? null,
                // Food/made-to-order items pass 'track' => false.
                'track_inventory' => $item['track'] ?? ($coarse === 'product'),
                // Fuel and loose goods sell by volume/weight (fractional qty).
                'sold_by' => $item['sold_by'] ?? 'unit',
                'duration_minutes' => $item['duration'] ?? null,
            ]);

            // Phase 2: per-branch on-hand at Main mirrors the rollup.
            BranchStock::withoutTenancy()->create([
                'tenant_id' => $tenant->id, 'branch_id' => $mainBranchId,
                'product_id' => $product->id, 'variant_id' => null,
                'quantity' => $product->stock_quantity,
            ]);

            foreach ($item['variants'] ?? [] as $variant) {
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

        app(TenantContext::class)->set($tenant);
        auth()->setUser($owner);

        try {
            $session = app(OpenCashSessionAction::class)->execute($owner, 5000.0);

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
        return $this->madeToOrder([
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
            'Deals' => [
                ['Family Deal', 2999], ['Couple Deal', 1799], ['Solo Lunch Deal', 650], ['Party Platter', 4500], ['Ramzan Special', 1299],
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
        return $this->stocked([
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
