<?php

namespace App\Support;

/**
 * The module registry — every capability a shop can be given, with the
 * dependencies between them.
 *
 * Modules belong to the TENANT, not to a plan. A plan is what a business pays
 * and how much it may hold; what it can actually DO is decided once, when the
 * admin creates it: the business type proposes a sensible set, the admin
 * adjusts it, and it stays that way until an admin changes it. Nothing else —
 * no renewal, no upgrade, no plan switch — may rewrite it behind their back.
 *
 * These are the same keys stored in `tenants.features` and enforced by
 * Tenant::featureEnabled() throughout the app.
 */
class Modules
{
    /**
     * key => [label, description, group, depends]
     *
     * `depends` is a hard requirement, not a hint: a module whose dependency is
     * off cannot function, so normalize() switches it off rather than leaving a
     * screen that loads and then fails at the first query.
     */
    public static function all(): array
    {
        return [
            'products' => [
                'label' => 'Products',
                'description' => 'A catalog of physical products / menu items. Almost everything else is built on it.',
                'group' => 'Selling',
                'depends' => [],
            ],
            'services' => [
                'label' => 'Services',
                'description' => 'Bill labour and services (salon, workshop, repair) — with or without a catalog.',
                'group' => 'Selling',
                'depends' => [],
            ],
            'pos' => [
                'label' => 'Point of Sale (POS)',
                'description' => 'In-shop till: scan, sell, print receipts, cash shifts. Off for online-only shops.',
                'group' => 'Selling',
                'depends' => [],
            ],
            'documents' => [
                'label' => 'Quotes & Advances',
                'description' => 'Write a quotation, take money in advance, turn either into a sale. A counter that only rings and hands over does not need it.',
                'group' => 'Selling',
                'depends' => ['pos'],
            ],
            'inventory' => [
                'label' => 'Inventory',
                'description' => 'Stock tracking, adjustments and low-stock alerts. The tools below build on it.',
                'group' => 'Stock',
                'depends' => ['products'],
            ],
            'purchasing' => [
                'label' => 'Suppliers & Purchases',
                'description' => 'Purchase orders, receiving goods, and what each supplier is owed. A shop that buys over the counter and keeps no supplier book can leave it off.',
                'group' => 'Stock',
                'depends' => ['inventory'],
            ],
            'stocktake' => [
                'label' => 'Stocktake',
                'description' => 'Counting the shelves against the books, sheet by sheet.',
                'group' => 'Stock',
                'depends' => ['inventory'],
            ],
            'disposals' => [
                'label' => 'Disposals',
                'description' => 'Where stock went when it left without being sold — written off, expired, or returned to the supplier.',
                'group' => 'Stock',
                'depends' => ['inventory'],
            ],
            'labels' => [
                'label' => 'Barcode Labels',
                'description' => 'Print shelf and product labels from the catalog. Needs a label printer to be worth switching on.',
                'group' => 'Stock',
                'depends' => ['inventory'],
            ],
            'customers' => [
                'label' => 'Customers & Khata',
                'description' => 'A customer book: who they are, what they owe, and their loyalty points. A cash-only counter that never sells on credit can leave it off.',
                'group' => 'Customers & offers',
                'depends' => [],
            ],
            'promotions' => [
                'label' => 'Coupons & Promotions',
                'description' => 'Discount codes and automatic offers — buy-one-get-one, percentage off, happy hour.',
                'group' => 'Customers & offers',
                'depends' => [],
            ],
            'bank_offers' => [
                'label' => 'Bank Card Offers',
                'description' => 'A discount a BANK funds on its own cards. Almost nobody outside a mid-sized retailer runs one.',
                'group' => 'Customers & offers',
                'depends' => ['promotions'],
            ],
            'expenses' => [
                'label' => 'Expense & Income Manager',
                'description' => 'Expenses, other income and a day-by-day cashbook. A sell-only shop can skip it.',
                'group' => 'Money',
                'depends' => [],
            ],
            'images' => [
                'label' => 'Product Images',
                'description' => 'Photos on products. Always on when selling online; optional for a walk-in shop.',
                'group' => 'Online',
                'depends' => ['products'],
            ],
            'marketplace' => [
                'label' => 'Online Store',
                'description' => 'List the shop publicly and take orders online.',
                'group' => 'Online',
                'depends' => ['products'],
            ],
            'delivery' => [
                'label' => 'Delivery',
                'description' => 'Riders and delivery fulfilment — including phone and WhatsApp orders, with or without an online store.',
                'group' => 'Online',
                'depends' => ['products'],
            ],
            'reservations' => [
                'label' => 'Reservations',
                'description' => 'Customers reserve items to collect later.',
                'group' => 'Customers & offers',
                'depends' => ['products'],
            ],
            'kitchen' => [
                'label' => 'Kitchen Tickets (KOT)',
                'description' => 'A pass for the kitchen: what to cook, in the order it was rung, bumped when it is ready. A takeaway counter needs exactly this and nothing else.',
                'group' => 'Trade-specific',
                'depends' => ['products'],
            ],
            'dine_in' => [
                'label' => 'Dine-in / Tables',
                'description' => 'A floor of tables, running tabs, settle and split bills. Everything a shop that seats people needs on TOP of the kitchen pass.',
                'group' => 'Trade-specific',
                // The pass, because firing a tab has to land somewhere. A
                // dine-in room whose kitchen ticket went nowhere would be a
                // Fire button that does nothing.
                'depends' => ['products', 'kitchen'],
            ],
            'fuel' => [
                'label' => 'Fuel Management',
                'description' => 'Tanks, pumps and nozzles, forecourt shifts with meter + dip reconciliation, tanker deliveries.',
                'group' => 'Trade-specific',
                'depends' => ['products', 'inventory'],
            ],
        ];
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    /** Distinct group names, in registry order — the admin screens use these. */
    public static function groups(): array
    {
        return array_values(array_unique(array_column(self::all(), 'group')));
    }

    /**
     * Make a module map self-consistent and complete.
     *
     * Every known key is present as a boolean afterwards, so "absent" can never
     * be mistaken for "off by choice". Then:
     *
     *  - a module whose dependency is off is switched off. Repeated until the
     *    map settles, because dependencies chain (fuel → inventory → products).
     *  - selling online forces images on. An online listing without a photo is
     *    a listing nobody buys from, and Tenant::imagesEnabled() already treats
     *    it that way — writing it down keeps the stored map honest instead of
     *    true-in-effect-but-false-on-screen.
     *
     * @param  array<string, mixed>  $modules
     * @return array<string, bool>
     */
    public static function normalize(array $modules): array
    {
        $known = self::all();

        $map = [];
        foreach ($known as $key => $_) {
            $map[$key] = (bool) ($modules[$key] ?? false);
        }

        if ($map['marketplace']) {
            $map['images'] = true;
        }

        // Settle the dependency graph. Bounded by the number of modules — one
        // pass can only ever switch something off, so it cannot cycle.
        do {
            $changed = false;
            foreach ($known as $key => $meta) {
                if (! $map[$key]) {
                    continue;
                }
                foreach ($meta['depends'] as $needs) {
                    if (! ($map[$needs] ?? false)) {
                        $map[$key] = false;
                        $changed = true;
                        break;
                    }
                }
            }
        } while ($changed);

        return $map;
    }

    /**
     * What a business of this type should start with — the set proposed on the
     * create-tenant screen, which the admin then adjusts. A tyre shop gets
     * services and inventory; a petrol pump gets fuel; a books-only office gets
     * neither a catalog nor a till.
     *
     * @return array<string, bool>
     */
    public static function defaultsFor(?string $businessType): array
    {
        if ($businessType === null || BusinessTypes::get($businessType) === null) {
            return self::normalize([]);
        }

        return self::normalize(BusinessTypes::defaultFeatures($businessType));
    }

    /**
     * The catalog the admin screens render: key, labels, group and what each
     * module needs switched on first.
     */
    public static function catalog(): array
    {
        return collect(self::all())
            ->map(fn (array $m, string $key) => ['key' => $key] + $m)
            ->values()
            ->all();
    }
}
