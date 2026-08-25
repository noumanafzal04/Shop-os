<?php

namespace App\Actions\Demo;

use App\Actions\Tenant\CreateTenantAction;
use App\Models\City;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\BusinessTypes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * A WORKING SHOP OF YOUR OWN, FOR A DAY.
 *
 * The landing page's "Try the demo" hands each visitor their own tenant rather
 * than sitting them all in one shared sandbox. A shared demo is renamed to
 * nonsense within a day, and two visitors ringing sales at once make each
 * other's figures meaningless — the thing being demonstrated stops working
 * precisely because it is being demonstrated.
 *
 * ── This is NOT the demo seeder, and the difference is the point ────────
 *
 * `DemoDataSeeder` and `migrate:fresh` remain forbidden on production, and
 * nothing here calls them. That rule exists because those two rewrite the whole
 * install; this creates ONE tenant and touches nothing outside it. A scoped
 * creation and a wholesale reseed are different operations that happen to share
 * a word.
 *
 * ── What a demo shop may not do ────────────────────────────────────────
 *
 * It is a real row in the real database, so the fences are real too:
 *
 *   - `is_demo` keeps it out of `marketplaceVisible()`, so no customer can
 *     order dinner from a shop that will not exist tomorrow;
 *   - `demo_expires_at` is absolute from creation, so the banner can print a
 *     time rather than "expires soon", and `PruneDemoShops` clears it away;
 *   - the owner's password is random and never shown. A demo is entered by the
 *     token this action returns and by nothing else, so an abandoned shop
 *     cannot be signed back into after somebody else has been handed one.
 */
class CreateDemoShopAction
{
    /**
     * How long a demo lives.
     *
     * A day, measured from creation rather than from last use. Two hours loses
     * the shopkeeper who looks at eleven between customers and wants to show
     * their brother in the evening; a week keeps abandoned shops for nothing,
     * since anybody still interested on day three has already given you an
     * email. And a sliding window cannot be printed on a banner truthfully — a
     * tab left open would keep a shop alive for ever.
     */
    public const HOURS = 24;

    public function __construct(
        private readonly CreateTenantAction $createTenant,
        private readonly InventoryService $inventory,
    ) {}

    /** @return array{tenant: Tenant, owner: User} */
    public function execute(string $businessType): array
    {
        if (BusinessTypes::get($businessType) === null) {
            throw new \InvalidArgumentException("Unknown business type: {$businessType}");
        }

        return DB::transaction(function () use ($businessType): array {
            $label = BusinessTypes::get($businessType)['label'] ?? 'Shop';
            $name = "{$label} Demo ".strtoupper(Str::random(4));

            $tenant = $this->createTenant->execute([
                'business_name' => $name,
                'business_type' => $businessType,
                'city_id' => City::query()->where('is_active', true)->value('id'),
                'owner' => [
                    'name' => 'Demo Owner',
                    'email' => 'demo-'.Str::lower(Str::random(12)).'@demo.cartze.shop',
                    // Random and thrown away. There is no password to leak
                    // because nobody is ever told one.
                    'password' => Hash::make(Str::random(40)),
                ],
                // The plan that shows what the product actually does. Demoing
                // the cheapest tier would demonstrate the least of it.
                'plan_id' => Plan::query()->where('name', 'Premium')->value('id'),
            ]);

            $tenant->forceFill([
                'is_demo' => true,
                'demo_expires_at' => now()->addHours(self::HOURS),
                // Skip the setup wizard: somebody who came to see a till should
                // meet a till, not a form asking for their address.
                'setup_completed' => true,
            ])->save();

            $this->stockTheShelf($tenant, $businessType);

            /** @var User $owner */
            $owner = $tenant->users()->firstOrFail();

            return ['tenant' => $tenant->refresh(), 'owner' => $owner];
        });
    }

    /**
     * Enough on the shelf to ring a sale, in this trade's own words.
     *
     * Small on purpose. A visitor is here for two minutes and needs a catalogue
     * they can read, and every row written here is a row the prune clears later.
     *
     * Stock goes on through `InventoryService`, NOT by writing
     * `stock_quantity`. That column is a rollup; the till sells from
     * `branch_stock`, and a demo whose every item shows "out of stock" would
     * demonstrate the opposite of the thing it exists to demonstrate.
     */
    private function stockTheShelf(Tenant $tenant, string $businessType): void
    {
        $shelf = match ($businessType) {
            'food' => [['Chicken Karahi', 1450], ['Garlic Naan', 80], ['Mineral Water', 80], ['Chicken Biryani', 550], ['Kheer', 250]],
            'pharmacy' => [['Panadol 500mg', 45], ['Brufen 400mg', 120], ['Cough Syrup 120ml', 260], ['ORS Sachet', 35], ['Surgical Mask', 20]],
            'retail' => [['Cotton Shirt', 2400], ['Denim Jeans', 3800], ['Leather Belt', 1500], ['Sports Socks', 450], ['Canvas Shoes', 4200]],
            'services' => [['Haircut', 800], ['Beard Trim', 400], ['Head Massage', 1200], ['Facial', 2500], ['Hair Colour', 3500]],
            'automotive' => [['Tyre 195/65 R15', 14500], ['Engine Oil 4L', 6800], ['Air Filter', 1800], ['Wiper Blade', 950], ['Battery 12V', 18500]],
            'petroleum' => [['Petrol', 272], ['Diesel', 278], ['Engine Oil 1L', 1900], ['Coolant 1L', 850], ['Brake Fluid', 1100]],
            'finance' => [['Consultation', 5000], ['Tax Filing', 15000], ['Book-keeping (month)', 25000]],
            default => [['Sugar 1kg', 180], ['Tea 500g', 1150], ['Cooking Oil 1L', 620], ['Rice 5kg', 1750], ['Milk 1L', 220]],
        };

        $primary = BusinessTypes::primary($businessType);
        $tracked = $primary !== 'service';

        foreach ($shelf as [$productName, $price]) {
            /** @var Product $product */
            $product = Product::withoutTenancy()->create([
                'tenant_id' => $tenant->id,
                'type' => $tracked ? 'product' : 'service',
                'item_type' => $primary,
                'name' => $productName,
                'price' => $price,
                // Enough to make the margin readable, without pretending to be
                // a real shop's buying price.
                'cost' => round($price * 0.65, 2),
                'track_inventory' => $tracked,
                'stock_quantity' => 0,
                'is_active' => true,
            ]);

            if ($tracked) {
                $this->inventory->adjust([
                    'product_id' => $product->id,
                    'type' => 'set',
                    'new_quantity' => 100,
                    'reason' => 'Demo shop opening stock',
                ]);
            }
        }
    }
}
