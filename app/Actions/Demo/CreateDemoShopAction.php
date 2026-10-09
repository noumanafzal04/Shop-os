<?php

namespace App\Actions\Demo;

use App\Actions\Catalog\CreateProductAction;
use App\Actions\Tenant\CreateTenantAction;
use App\Models\Category;
use App\Models\City;
use App\Models\DiningTable;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ItemTypes;
use App\Support\TenantContext;
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
        private readonly CreateProductAction $createProduct,
    ) {}

    /** @return array{tenant: Tenant, owner: User} */
    public function execute(string $businessType): array
    {
        if (BusinessTypes::get($businessType) === null) {
            throw new \InvalidArgumentException("Unknown business type: {$businessType}");
        }

        // ── CREATED FROM OUTSIDE ANY TENANT ────────────────────────────
        //
        // `BelongsToTenant` scopes every read to whatever tenant is in context,
        // and this action's own `$tenant->users()->firstOrFail()` asks for the
        // NEW shop's owner. With somebody else's tenant in context that lookup
        // searches the wrong shop, finds nobody, and throws — a 404 out of a
        // public endpoint.
        //
        // The public route resolves no tenant, so a browser cannot get here
        // with one set. What CAN is anything that calls this action from
        // inside a tenant's request — and a process that reuses its container
        // between calls, which is how the suite met it. An action whose job is
        // to create a tenant must not read through another one's scope,
        // whoever calls it.
        //
        // Restored in `finally`: quietly emptying a caller's tenant context is
        // a trap for whatever runs next.
        $context = app(TenantContext::class);
        $was = $context->get();
        $context->clear();

        try {
            return $this->build($businessType);
        } finally {
            if ($was !== null) {
                $context->set($was);
            }
        }
    }

    /** @return array{tenant: Tenant, owner: User} */
    private function build(string $businessType): array
    {
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
                // NO PLAN, and that is now said rather than happened upon.
                //
                // This used to read `Plan::where('name', 'Premium')` — "the plan
                // that shows what the product actually does". Then that plan was
                // renamed Standard, the lookup found nothing, and every demo
                // since has been made with no plan at all. Nothing noticed,
                // because nothing it was for depends on it any more:
                //
                //   what a shop can DO is its own module list, proposed by its
                //   trade (see CreateTenantAction ①) — a plan stopped deciding
                //   that when plans became a price and a set of ceilings;
                //
                //   a plan's ceilings could only take something AWAY from
                //   somebody who came to try it;
                //
                //   and a plan is a thing somebody has paid for. A demo has
                //   paid nothing, so a demo that was KEPT arrived on the list
                //   already "subscribed" for a month nobody had recorded.
                //
                // So a demo is on no plan. Kept, it gets one from the admin who
                // keeps it — and that is the first payment on its ledger.
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
     * ── Made the way a shop makes them ───────────────────────────────────
     *
     * This used to write `products` rows by hand, and gave every one of them
     * `item_type = BusinessTypes::primary($businessType)` — the BUSINESS's
     * type, in the column for the ITEM's. A restaurant's dishes were typed
     * `food`, a chemist's medicines `pharmacy`, a salon's haircut `services`.
     * None of those is an item type. There are five, and they are
     * `ItemTypes`.
     *
     * Nothing refused it, because the column is a string. What it cost:
     *
     *   every screen that asks for a kind of item found none — a restaurant's
     *   menu filtered to dishes was empty, with five dishes in the shop;
     *
     *   the product form could not save any of them back ("item type cannot
     *   be changed", against a value it could not have chosen);
     *
     *   a haircut was a counted product with a hundred in stock, because the
     *   test for "is this a service" compared against the wrong word too.
     *
     * So the shelf goes on through `CreateProductAction` — the same door the
     * product form uses — with the type the trade is actually offered. It
     * also puts stock where the till looks (`branch_stock`) and gives a
     * medicine the batch and expiry it cannot be sold without, neither of
     * which a hand-written row can be trusted to remember.
     */
    private function stockTheShelf(Tenant $tenant, string $businessType): void
    {
        // What this trade is offered, as shipped. A books-only business is
        // offered nothing — it sells no items — and gets no shelf: three
        // "products" it had no screen to see or sell were three rows of junk.
        $itemType = BusinessTypes::itemTypesFor($businessType)[0] ?? null;
        if ($itemType === null) {
            return;
        }

        $context = app(TenantContext::class);
        $context->set($tenant);

        try {
            if (BusinessTypes::primary($businessType) === 'food') {
                $this->layTheRestaurant($tenant, $itemType);

                return;
            }

            $shelf = match (BusinessTypes::primary($businessType)) {
                'pharmacy' => [['Panadol 500mg', 45], ['Brufen 400mg', 120], ['Cough Syrup 120ml', 260], ['ORS Sachet', 35], ['Surgical Mask', 20]],
                'retail' => [['Cotton Shirt', 2400], ['Denim Jeans', 3800], ['Leather Belt', 1500], ['Sports Socks', 450], ['Canvas Shoes', 4200]],
                'services' => [['Haircut', 800], ['Beard Trim', 400], ['Head Massage', 1200], ['Facial', 2500], ['Hair Colour', 3500]],
                'automotive' => [['Tyre 195/65 R15', 14500], ['Engine Oil 4L', 6800], ['Air Filter', 1800], ['Wiper Blade', 950], ['Battery 12V', 18500]],
                'petroleum' => [['Petrol', 272], ['Diesel', 278], ['Engine Oil 1L', 1900], ['Coolant 1L', 850], ['Brake Fluid', 1100]],
                default => [['Sugar 1kg', 180], ['Tea 500g', 1150], ['Cooking Oil 1L', 620], ['Rice 5kg', 1750], ['Milk 1L', 220]],
            };

            foreach ($shelf as [$name, $price]) {
                $this->shelve($itemType, $name, $price);
            }
        } finally {
            // Left exactly as `build` expects it: no tenant in context.
            // `execute` puts the caller's own back afterwards.
            $context->clear();
        }
    }

    /**
     * One item, through the product form's own door.
     *
     * @param  array<string, mixed>  $extra
     */
    private function shelve(string $itemType, string $name, float $price, array $extra = []): void
    {
        $counts = ItemTypes::defaultTracksInventory($itemType);

        $this->createProduct->execute([
            'item_type' => $itemType,
            'name' => $name,
            'price' => $price,
            // Enough to make the margin readable, without pretending to be a
            // real shop's buying price.
            'cost' => round($price * 0.65, 2),
            'is_active' => true,
            ...($counts ? ['track_inventory' => true, 'stock_quantity' => 100] : []),
            // A medicine is sold from a LOT, first-expiring first. One with no
            // expiry is one the till has to refuse.
            ...($itemType === ItemTypes::MEDICINE
                ? ['opening_batch_number' => 'DEMO-01', 'expiry_date' => now()->addMonths(18)->toDateString()]
                : []),
            ...$extra,
        ]);
    }

    /**
     * A restaurant is a floor and a menu, not five dishes.
     *
     * The landing page offers this trade as "Tables, kitchen dockets,
     * dine-in" — and the shop it opened had no table in it. The floor screen
     * said "No tables yet", the kitchen had no stations to route to, and the
     * one thing the visitor had been promised was the one thing they could
     * not try.
     *
     * Still small: twelve tables in three rooms, nineteen dishes in six
     * sections, three stations. Enough that seating a table, sending an order
     * and watching it split between the grill and the tandoor is one minute's
     * work — which is the whole demonstration.
     */
    private function layTheRestaurant(Tenant $tenant, string $itemType): void
    {
        $tenant->forceFill([
            'settings' => [...($tenant->settings ?? []), 'kitchen_stations' => ['Grill', 'Tandoor', 'Bar']],
        ])->save();

        $menu = [
            'Karahi & Handi' => [['Chicken Karahi', 1450, 'Grill'], ['Mutton Karahi', 2650, 'Grill'], ['Chicken Handi', 1350, 'Grill'], ['Daal Makhni', 650, 'Grill']],
            'BBQ' => [['Chicken Tikka', 480, 'Grill'], ['Malai Boti', 780, 'Grill'], ['Seekh Kabab', 620, 'Grill'], ['Reshmi Kabab', 690, 'Grill']],
            'Rice' => [['Chicken Biryani', 550, 'Grill'], ['Mutton Pulao', 890, 'Grill']],
            'Breads' => [['Garlic Naan', 80, 'Tandoor'], ['Roghni Naan', 70, 'Tandoor'], ['Tandoori Roti', 30, 'Tandoor']],
            'Beverages' => [['Mineral Water', 80, 'Bar'], ['Fresh Lime', 220, 'Bar'], ['Mint Margarita', 320, 'Bar'], ['Doodh Patti', 150, 'Bar']],
            'Desserts' => [['Kheer', 250, 'Bar'], ['Gulab Jamun', 220, 'Bar']],
        ];

        $order = 0;
        foreach ($menu as $section => $dishes) {
            // `firstOrCreate`, by name. A new restaurant is already given the
            // sections every restaurant has, and a second "Desserts" beside
            // the first is two chips on the menu that do the same thing.
            $category = Category::query()->firstOrCreate(
                ['name' => $section],
                ['sort_order' => $order, 'is_active' => true],
            );
            $order++;

            foreach ($dishes as [$name, $price, $station]) {
                $this->shelve($itemType, $name, $price, [
                    'category_id' => $category->id,
                    'kitchen_station' => $station,
                ]);
            }
        }

        $rooms = ['Hall' => [['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], 4], 'Family' => [['F1', 'F2', 'F3'], 6], 'Rooftop' => [['R1', 'R2', 'R3'], 4]];
        $position = 0;
        foreach ($rooms as $room => [$names, $seats]) {
            foreach ($names as $name) {
                DiningTable::query()->create([
                    'name' => $name, 'area' => $room, 'seats' => $seats,
                    'sort_order' => $position++, 'is_active' => true,
                ]);
            }
        }
    }
}
