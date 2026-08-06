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
            'inventory' => [
                'label' => 'Inventory',
                'description' => 'Stock tracking, adjustments, purchases and low-stock alerts.',
                'group' => 'Back office',
                'depends' => ['products'],
            ],
            'expenses' => [
                'label' => 'Expense & Income Manager',
                'description' => 'Expenses, other income and a day-by-day cashbook. A sell-only shop can skip it.',
                'group' => 'Back office',
                'depends' => [],
            ],
            'images' => [
                'label' => 'Product Images',
                'description' => 'Photos on products. Always on when selling online; optional for a walk-in shop.',
                'group' => 'Back office',
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
                'group' => 'Online',
                'depends' => ['products'],
            ],
            'dine_in' => [
                'label' => 'Dine-in / Restaurant',
                'description' => 'Tables, running tabs, kitchen tickets (KOT) and split bills.',
                'group' => 'Trade-specific',
                'depends' => ['products'],
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
