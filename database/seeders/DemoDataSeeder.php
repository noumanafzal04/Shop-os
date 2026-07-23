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
        foreach ($items as $item) {
            $category = Category::withoutTenancy()
                ->where('tenant_id', $tenant->id)
                ->where('name', $item['category'] ?? '')
                ->first();

            $coarse = $item['type'] ?? 'product';
            // Derive the richer item_type from the business + coarse type.
            $itemType = match (true) {
                $coarse === 'service' => ItemTypes::SERVICE,
                $businessType === 'restaurant' => ItemTypes::FOOD,
                $businessType === 'pharmacy' => ItemTypes::MEDICINE,
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
                'duration_minutes' => $item['duration'] ?? null,
            ]);

            foreach ($item['variants'] ?? [] as $variant) {
                $product->variants()->create([
                    'tenant_id' => $tenant->id,
                    'name' => $variant['name'],
                    'sku' => $variant['sku'] ?? null,
                    'price' => $variant['price'],
                    'cost' => $variant['cost'] ?? null,
                    'stock_quantity' => $variant['stock'] ?? 0,
                    'low_stock_threshold' => $variant['low_at'] ?? null,
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
        app(ReceivePurchaseOrderAction::class)->execute($received);
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

    private function tenantBlueprints(): array
    {
        return [
            [
                'name' => 'Fashion Hub', 'type' => 'retail', 'category' => 'garments', 'online' => true,
                'items' => [
                    ['name' => 'Classic T-Shirt', 'category' => 'General', 'sku' => 'FH-TS-01', 'price' => 1200, 'cost' => 700, 'stock' => 40, 'low_at' => 10,
                        'variants' => [
                            ['name' => 'Black / M', 'sku' => 'FH-TS-01-BM', 'price' => 1200, 'cost' => 700, 'stock' => 15],
                            ['name' => 'Black / L', 'sku' => 'FH-TS-01-BL', 'price' => 1200, 'cost' => 700, 'stock' => 12],
                            ['name' => 'White / M', 'sku' => 'FH-TS-01-WM', 'price' => 1100, 'cost' => 650, 'stock' => 3, 'low_at' => 5],
                        ]],
                    ['name' => 'Denim Jeans', 'category' => 'General', 'sku' => 'FH-DJ-02', 'price' => 3500, 'cost' => 2100, 'stock' => 25, 'low_at' => 5],
                    ['name' => 'Hoodie Premium', 'category' => 'General', 'sku' => 'FH-HD-03', 'price' => 4200, 'cost' => 2600, 'stock' => 4, 'low_at' => 5],
                    ['name' => 'Sneakers Street', 'category' => 'General', 'sku' => 'FH-SN-04', 'price' => 6500, 'cost' => 4200, 'stock' => 18, 'low_at' => 4],
                    ['name' => 'Summer Kurti', 'category' => 'General', 'sku' => 'FH-KU-05', 'price' => 2200, 'cost' => 1300, 'stock' => 0, 'low_at' => 3],
                    ['name' => 'Baseball Cap', 'category' => 'General', 'sku' => 'FH-CP-06', 'price' => 800, 'cost' => 400, 'stock' => 60],
                ],
            ],
            [
                'name' => 'Daily Needs Grocery', 'type' => 'grocery', 'category' => 'grocery', 'online' => true,
                'items' => [
                    ['name' => 'Basmati Rice 5kg', 'category' => 'Food & Beverages', 'sku' => 'GR-RC-01', 'price' => 2400, 'cost' => 2050, 'stock' => 80, 'low_at' => 20],
                    ['name' => 'Cooking Oil 1L', 'category' => 'Food & Beverages', 'sku' => 'GR-OL-02', 'price' => 620, 'cost' => 540, 'stock' => 120, 'low_at' => 30],
                    ['name' => 'Fresh Milk 1L', 'category' => 'Dairy', 'sku' => 'GR-MK-03', 'price' => 220, 'cost' => 190, 'stock' => 45, 'low_at' => 15],
                    ['name' => 'Dishwash Liquid', 'category' => 'Household', 'sku' => 'GR-DW-04', 'price' => 350, 'cost' => 260, 'stock' => 12, 'low_at' => 15],
                    ['name' => 'Potato Chips Family', 'category' => 'Snacks', 'sku' => 'GR-CH-05', 'price' => 150, 'cost' => 110, 'stock' => 200],
                    ['name' => 'Shampoo Sachet Box', 'category' => 'Personal Care', 'sku' => 'GR-SH-06', 'price' => 480, 'cost' => 380, 'stock' => 0, 'low_at' => 10],
                    ['name' => 'Green Tea 100 Bags', 'category' => 'Food & Beverages', 'sku' => 'GR-GT-07', 'price' => 550, 'cost' => 430, 'stock' => 35],
                ],
            ],
            [
                'name' => 'City Care Pharmacy', 'type' => 'pharmacy', 'category' => 'pharmacy', 'online' => false,
                'items' => [
                    ['name' => 'Paracetamol 500mg (strip)', 'category' => 'Medicines', 'sku' => 'PH-PC-01', 'price' => 60, 'cost' => 42, 'stock' => 300, 'low_at' => 50],
                    ['name' => 'Vitamin C 1000mg', 'category' => 'Supplements', 'sku' => 'PH-VC-02', 'price' => 450, 'cost' => 330, 'stock' => 40, 'low_at' => 10],
                    ['name' => 'Digital Thermometer', 'category' => 'Medical Supplies', 'sku' => 'PH-TH-03', 'price' => 850, 'cost' => 600, 'stock' => 15, 'low_at' => 5],
                    ['name' => 'Baby Diapers M (36)', 'category' => 'Baby Care', 'sku' => 'PH-BD-04', 'price' => 1650, 'cost' => 1350, 'stock' => 22, 'low_at' => 8],
                    ['name' => 'Hand Sanitizer 250ml', 'category' => 'Personal Care', 'sku' => 'PH-HS-05', 'price' => 280, 'cost' => 190, 'stock' => 4, 'low_at' => 10],
                ],
            ],
            [
                'name' => 'Glamour Salon', 'type' => 'salon', 'category' => 'salon', 'online' => false,
                'items' => [
                    ['name' => 'Haircut (Gents)', 'category' => 'Hair Services', 'type' => 'service', 'price' => 800, 'duration' => 30],
                    ['name' => 'Hair Color Full', 'category' => 'Hair Services', 'type' => 'service', 'price' => 3500, 'duration' => 90],
                    ['name' => 'Facial Deluxe', 'category' => 'Skin Services', 'type' => 'service', 'price' => 2500, 'duration' => 60],
                    ['name' => 'Beard Trim', 'category' => 'Hair Services', 'type' => 'service', 'price' => 400, 'duration' => 15],
                    ['name' => 'Argan Hair Oil', 'category' => 'Retail Products', 'sku' => 'SL-AO-01', 'price' => 1200, 'cost' => 750, 'stock' => 18, 'low_at' => 5],
                ],
            ],
            [
                'name' => 'Speedy Auto Workshop', 'type' => 'workshop', 'category' => 'car workshop', 'online' => false,
                'items' => [
                    ['name' => 'Oil Change Service', 'category' => 'Services', 'type' => 'service', 'price' => 1500, 'duration' => 45],
                    ['name' => 'Full Tuning', 'category' => 'Services', 'type' => 'service', 'price' => 6000, 'duration' => 180],
                    ['name' => 'Engine Oil 4L', 'category' => 'Oils & Fluids', 'sku' => 'WS-EO-01', 'price' => 4800, 'cost' => 3900, 'stock' => 25, 'low_at' => 6],
                    ['name' => 'Brake Pads (set)', 'category' => 'Spare Parts', 'sku' => 'WS-BP-02', 'price' => 3200, 'cost' => 2200, 'stock' => 10, 'low_at' => 4],
                    ['name' => 'Air Filter', 'category' => 'Spare Parts', 'sku' => 'WS-AF-03', 'price' => 900, 'cost' => 550, 'stock' => 3, 'low_at' => 5],
                ],
            ],
            [
                'name' => 'FixIt Computer Repair', 'type' => 'service', 'category' => 'computer repair', 'online' => false,
                'items' => [
                    ['name' => 'Laptop Checkup', 'category' => 'Services', 'type' => 'service', 'price' => 1000, 'duration' => 60],
                    ['name' => 'OS Installation', 'category' => 'Services', 'type' => 'service', 'price' => 1500, 'duration' => 90],
                    ['name' => 'Screen Replacement (labour)', 'category' => 'Services', 'type' => 'service', 'price' => 2000, 'duration' => 120],
                    ['name' => 'Data Recovery Basic', 'category' => 'Services', 'type' => 'service', 'price' => 3500, 'duration' => 240],
                ],
            ],
            [
                'name' => 'Mega Distributors', 'type' => 'wholesale', 'category' => 'wholesale distributor', 'online' => true,
                'items' => [
                    ['name' => 'Sugar 50kg Bag', 'category' => 'General Stock', 'sku' => 'WD-SG-01', 'price' => 8500, 'cost' => 8100, 'stock' => 60, 'low_at' => 15],
                    ['name' => 'Flour 20kg Bag', 'category' => 'General Stock', 'sku' => 'WD-FL-02', 'price' => 2900, 'cost' => 2700, 'stock' => 90, 'low_at' => 20],
                    ['name' => 'Beverage Crate (24)', 'category' => 'General Stock', 'sku' => 'WD-BV-03', 'price' => 1450, 'cost' => 1300, 'stock' => 150, 'low_at' => 30],
                    ['name' => 'Soap Carton (72)', 'category' => 'General Stock', 'sku' => 'WD-SP-04', 'price' => 5200, 'cost' => 4700, 'stock' => 8, 'low_at' => 10],
                ],
            ],
            [
                'name' => 'Readers Corner', 'type' => 'books', 'category' => 'bookshop', 'online' => true,
                'items' => [
                    ['name' => 'O-Level Physics Notes', 'category' => 'Books', 'sku' => 'BK-PH-01', 'price' => 950, 'cost' => 600, 'stock' => 30, 'low_at' => 8],
                    ['name' => 'Urdu Novel Bestseller', 'category' => 'Books', 'sku' => 'BK-UN-02', 'price' => 1250, 'cost' => 850, 'stock' => 20, 'low_at' => 5],
                    ['name' => 'A4 Register 200pg', 'category' => 'Stationery', 'sku' => 'BK-RG-03', 'price' => 320, 'cost' => 210, 'stock' => 100, 'low_at' => 25],
                    ['name' => 'Gel Pen Box (12)', 'category' => 'Stationery', 'sku' => 'BK-GP-04', 'price' => 540, 'cost' => 360, 'stock' => 45],
                    ['name' => 'Water Colors Set', 'category' => 'Art Supplies', 'sku' => 'BK-WC-05', 'price' => 780, 'cost' => 520, 'stock' => 2, 'low_at' => 5],
                ],
            ],
            [
                'name' => 'BuildRight Hardware', 'type' => 'hardware', 'category' => 'hardware', 'online' => true,
                'items' => [
                    ['name' => 'Hammer Steel Grip', 'category' => 'Tools', 'sku' => 'HW-HM-01', 'price' => 1150, 'cost' => 780, 'stock' => 25, 'low_at' => 6],
                    ['name' => 'Drill Machine 13mm', 'category' => 'Tools', 'sku' => 'HW-DR-02', 'price' => 9500, 'cost' => 7200, 'stock' => 8, 'low_at' => 3],
                    ['name' => 'PVC Pipe 1in (ft)', 'category' => 'Plumbing', 'sku' => 'HW-PP-03', 'price' => 95, 'cost' => 70, 'stock' => 500, 'low_at' => 100],
                    ['name' => 'Wall Paint White 4L', 'category' => 'Paint', 'sku' => 'HW-WP-04', 'price' => 3400, 'cost' => 2650, 'stock' => 14, 'low_at' => 5],
                    ['name' => 'Extension Socket 5m', 'category' => 'Electrical', 'sku' => 'HW-ES-05', 'price' => 1250, 'cost' => 900, 'stock' => 0, 'low_at' => 5],
                ],
            ],
            [
                // Food shop: sells online with delivery, menu items are NOT
                // stock-tracked ('track' => false) — always available.
                'name' => 'Cheesy Slice Pizza', 'type' => 'restaurant', 'category' => 'pizza', 'online' => true,
                'items' => [
                    ['name' => 'Chicken Tikka Pizza', 'category' => 'Pizzas', 'track' => false, 'price' => 1200, 'cost' => 500,
                        'description' => 'Loaded with spicy chicken tikka, capsicum and mozzarella.',
                        'variants' => [
                            ['name' => 'Small 7"', 'price' => 800],
                            ['name' => 'Medium 9"', 'price' => 1200],
                            ['name' => 'Large 12"', 'price' => 1700],
                        ],
                        'modifiers' => [
                            ['name' => 'Crust', 'type' => 'modifier', 'min' => 1, 'max' => 1, 'options' => [
                                ['Original', 0], ['Thin', 0], ['Stuffed', 250],
                            ]],
                            ['name' => 'Extra Toppings', 'type' => 'addon', 'min' => 0, 'max' => 5, 'options' => [
                                ['Extra Cheese', 150], ['Jalapeños', 80], ['Extra Chicken', 200], ['Olives', 100],
                            ]],
                        ],
                    ],
                    ['name' => 'Fajita Pizza', 'category' => 'Pizzas', 'track' => false, 'price' => 1300, 'cost' => 550,
                        'variants' => [
                            ['name' => 'Small 7"', 'price' => 850],
                            ['name' => 'Medium 9"', 'price' => 1300],
                            ['name' => 'Large 12"', 'price' => 1800],
                        ],
                    ],
                    ['name' => 'Zinger Burger', 'category' => 'Burgers', 'track' => false, 'price' => 550, 'cost' => 250],
                    ['name' => 'Loaded Fries', 'category' => 'Starters', 'track' => false, 'price' => 450, 'cost' => 180],
                    ['name' => 'Family Deal (2 Pizzas + Drink)', 'category' => 'Deals', 'track' => false, 'price' => 2999, 'cost' => 1400],
                    ['name' => 'Soft Drink 500ml', 'category' => 'Beverages', 'track' => false, 'price' => 120, 'cost' => 70],
                    ['name' => 'Chocolate Lava Cake', 'category' => 'Desserts', 'track' => false, 'price' => 350, 'cost' => 150],
                ],
            ],
        ];
    }
}
