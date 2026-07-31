<?php

namespace Database\Seeders;

use App\Actions\Purchase\CreatePurchaseOrderAction;
use App\Actions\Purchase\ReceivePurchaseOrderAction;
use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
use App\Enums\ReservationStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Category;
use App\Models\City;
use App\Models\Collection;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Reservation;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\ItemTypes;
use App\Support\TenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
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
        $onlinePlan = Plan::query()->where('code', 'business-pos-online')->firstOrFail();
        $corePlan = Plan::query()->where('code', 'business-pos')->firstOrFail();

        $customers = $this->seedCustomers();
        $tenants = [];

        foreach ($this->tenantBlueprints() as $i => $blueprint) {
            $tenants[] = $this->seedTenant(
                index: $i + 1,
                blueprint: $blueprint,
                city: $cities[$i % $cities->count()],
                plan: $blueprint['online'] ? $onlinePlan : $corePlan,
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
                'online_shop_enabled' => $plan->online_shop_enabled,
                'status' => 'active',
                'setup_completed' => true,
                'address' => "{$blueprint['name']}, Main Market, {$city->name}",
                // Pin the shop near its city centre (deterministic jitter ±~2 km)
                'latitude' => $city->latitude !== null ? round($city->latitude + (($index % 5) - 2) * 0.008, 7) : null,
                'longitude' => $city->longitude !== null ? round($city->longitude + (($index % 7) - 3) * 0.008, 7) : null,
                'subscription_starts_at' => now()->subMonth(),
                'subscription_ends_at' => now()->addYear(),
                'delivery_fee' => $plan->online_shop_enabled ? 150 : 0,
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

        // Business-type templates (categories, expense categories, features).
        app(ApplyBusinessTypeDefaultsAction::class)->execute($tenant, $blueprint['type']);

        if (! Product::withoutTenancy()->where('tenant_id', $tenant->id)->exists()) {
            $this->seedProducts($tenant, $blueprint['items'], $blueprint['type']);
            $this->seedMarketingExtras($tenant);
            $this->seedCollections($tenant);
            $this->seedSales($tenant);
            $this->seedExpenses($tenant);
            $this->seedSubscriptionPayments($tenant, $plan, $index);
            if ($tenant->featureEnabled('inventory')) {
                $this->seedPurchases($tenant);
            }
        }

        $this->command?->info("  ✓ {$blueprint['name']} ({$blueprint['type']}, {$city->name}, ".($blueprint['online'] ? 'online shop' : 'expense manager').')');

        return $tenant->refresh();
    }

    private function seedProducts(Tenant $tenant, array $items, string $businessType): void
    {
        $mainBranchId = \App\Models\Branch::withoutTenancy()
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
            \App\Models\BranchStock::withoutTenancy()->create([
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
                \App\Models\BranchStock::withoutTenancy()->create([
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
        \App\Models\TaxGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'GST 17%'],
            ['rate' => 17, 'is_active' => true],
        );

        // A trade/wholesale tier + a VIP tier for tiered pricing demos.
        \App\Models\CustomerGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'Wholesale / Trade'],
            ['price_level' => 'wholesale', 'discount_percent' => null, 'is_active' => true],
        );
        \App\Models\CustomerGroup::withoutTenancy()->firstOrCreate(
            ['tenant_id' => $tenant->id, 'name' => 'VIP'],
            ['price_level' => 'retail', 'discount_percent' => 5, 'is_active' => true],
        );

        // Automatic order-wide discount over a minimum spend.
        \App\Models\Promotion::withoutTenancy()->firstOrCreate(
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
            \App\Models\Promotion::withoutTenancy()->firstOrCreate(
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

    private function seedExpenses(Tenant $tenant): void
    {
        $categories = ExpenseCategory::withoutTenancy()
            ->where('tenant_id', $tenant->id)
            ->take(4)
            ->get();

        foreach ($categories as $i => $category) {
            Expense::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'expense_category_id' => $category->id,
                'description' => "{$category->name} — ".now()->subDays($i * 2)->format('M j'),
                'amount' => [1500, 800, 2500, 400][$i % 4],
                'expense_date' => now()->subDays($i * 2)->toDateString(),
            ]);
        }
    }

    /**
     * A few months of billing history + varied subscription end dates so the
     * Super Admin billing screens show active / expiring-soon / expired.
     */
    private function seedSubscriptionPayments(Tenant $tenant, \App\Models\Plan $plan, int $index): void
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
            // Still add a nominal monthly fee for demo realism on paid-looking plans.
            $monthly = $plan->online_shop_enabled ? 3000 : 1500;
        } else {
            $monthly = (float) $plan->price;
        }

        // 3 past monthly payments.
        foreach (range(3, 1) as $monthsAgo) {
            $start = now()->subMonths($monthsAgo)->startOfMonth();
            \App\Models\SubscriptionPayment::query()->create([
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
        return [
            ['name' => 'Karahi House',          'type' => 'food',     'category' => 'restaurant',   'online' => true,  'items' => $this->catalogFor('food')],
            ['name' => 'FreshMart Grocery',     'type' => 'mart',     'category' => 'supermarket',  'online' => true,  'items' => $this->catalogFor('mart')],
            ['name' => 'MediPlus Pharmacy',     'type' => 'pharmacy', 'category' => 'medical_store','online' => false, 'items' => $this->catalogFor('pharmacy')],
            ['name' => 'Trendz Retail',         'type' => 'retail',   'category' => 'garments',     'online' => true,  'items' => $this->catalogFor('retail')],
            ['name' => 'GlowUp Salon & Studio', 'type' => 'services', 'category' => 'salon_beauty', 'online' => false, 'items' => $this->catalogFor('services')],
            ['name' => 'Highway Fuel Station',  'type' => 'petroleum', 'category' => 'petrol_pump', 'online' => false, 'items' => $this->catalogFor('petroleum')],
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
            default => [],
        };
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
