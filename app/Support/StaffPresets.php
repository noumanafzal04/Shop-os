<?php

namespace App\Support;

use App\Models\Tenant;

/**
 * "What job does this person do?" — asked once, so nobody has to know which of
 * seventeen checkboxes makes a cashier.
 *
 * A preset is A STARTING POINT AND NOTHING ELSE. It ticks boxes and gets out of
 * the way: what is stored is the same plain `permissions[]` array it always
 * was, with no role column, no preset id on the user, and no second
 * authorisation path. Nothing downstream can tell a preset was ever used, which
 * is exactly why a preset cannot rot into a shadow role or drift from the
 * permission model.
 *
 * The consequence worth stating: once applied, a preset is forgotten. Editing
 * "Cashier" here next month does not change anyone hired last month. That is
 * the intended behaviour — silently re-permissioning existing staff because an
 * owner adjusted a template is precisely the surprise this design avoids.
 *
 * WHICH PRESETS AN OWNER SEES depends on the shop. Offering "Waiter" to a
 * pharmacy is noise, and noise in a permission screen is how the wrong box gets
 * ticked. Presets are filtered by the tenant's granted modules and, where the
 * job only exists in one trade, by the trade itself.
 *
 * A preset ticks EXACTLY the boxes this shop is shown, and no others.
 *
 * That is a reversal, and the reason is worth writing down. This used to grant
 * the full list even where a module was off, on the argument that the module
 * gate is the real boundary — such a permission is inert by construction, and
 * it means what the owner intended if the module is switched on later.
 *
 * That argument held while the checkbox list underneath showed EVERY
 * permission: whatever a preset ticked, the owner could see and change. The
 * list is now filtered to the shop, so an untrimmed preset would grant a
 * permission with no checkbox to see it by — it would appear only as a chip on
 * the staff list, reading "Serve any table" against a mart that has never had
 * a table. That is exactly the invisible gap the old note was trying to avoid,
 * arriving through the other door.
 *
 * The cost is small and visible: a shop that switches dine-in on later re-picks
 * the preset, or ticks the box that has just appeared. StaffPresetTest asserts
 * the invariant directly — no preset may tick a box its own shop is not shown.
 */
class StaffPresets
{
    /**
     * The catalogue.
     *
     * `modules` — show this preset when ANY of them is granted. Empty = always.
     * `trades`  — show only for these trades. Empty = every trade.
     *
     * @return array<int, array{code: string, label: string, description: string,
     *   permissions: string[], modules: string[], trades: string[]}>
     */
    public static function all(): array
    {
        return [
            [
                'code' => 'cashier',
                'label' => 'Cashier',
                'description' => 'Rings sales and takes payment, and settles any waiter’s table. Cannot void a completed sale or hand money back — those stay with a supervisor.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::DISCOUNTS_APPLY,
                    Permissions::CUSTOMERS_MANAGE,
                    // The till settles what the floor opened. A cashier who
                    // cannot pick up a waiter's tab cannot take the payment.
                    Permissions::TABLES_SERVE_ANY,
                ],
                'modules' => ['pos'],
                'trades' => [],
            ],
            [
                'code' => 'shift_supervisor',
                'label' => 'Shift supervisor',
                'description' => 'Everything a cashier does, plus voiding a sale, refunding, and discounting past your ceiling.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::DISCOUNTS_APPLY,
                    Permissions::CUSTOMERS_MANAGE,
                    Permissions::SALES_VOID,
                    Permissions::SALES_REFUND,
                    Permissions::DISCOUNTS_OVERRIDE,
                    Permissions::TABLES_SERVE_ANY,
                    Permissions::REPORTS_VIEW,
                ],
                'modules' => ['pos'],
                'trades' => [],
            ],
            [
                'code' => 'waiter',
                'label' => 'Waiter',
                // The one preset that deliberately WITHHOLDS tables.serve_any.
                // A waiter's own tables are the unit the service report pays
                // tips off, and it stops being true the moment anyone can
                // settle anyone's bill.
                'description' => 'Opens tables, takes orders, sends them to the kitchen and settles the bill — their own tables only.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::CUSTOMERS_MANAGE,
                ],
                'modules' => ['dine_in'],
                'trades' => [],
            ],
            [
                'code' => 'kitchen',
                'label' => 'Kitchen',
                // The pass and nothing else. This preset used to carry
                // sales.manage, because the kitchen board was gated on it — and
                // that key also opens the sales ledger, the day's banking and
                // the quotes screen, so a kitchen hand was being shown the
                // shop's takings to be allowed to mark a curry ready.
                'description' => 'Sees the kitchen board and marks food ready. Nothing else — not the till, not the takings.',
                'permissions' => [
                    Permissions::KITCHEN_MANAGE,
                ],
                'modules' => ['dine_in'],
                'trades' => [],
            ],
            [
                'code' => 'stock_keeper',
                'label' => 'Stock keeper',
                'description' => 'Receives goods, counts stock and keeps the catalog straight. No till, no money.',
                'permissions' => [
                    Permissions::PRODUCTS_MANAGE,
                    Permissions::INVENTORY_MANAGE,
                ],
                'modules' => ['inventory', 'products'],
                'trades' => [],
            ],
            [
                'code' => 'buyer',
                'label' => 'Purchasing',
                'description' => 'Deals with suppliers, raises purchase orders and records what was paid against them.',
                'permissions' => [
                    Permissions::SUPPLIERS_MANAGE,
                    Permissions::PURCHASES_MANAGE,
                    Permissions::PRODUCTS_MANAGE,
                    Permissions::INVENTORY_MANAGE,
                ],
                // `inventory` ALONE, not inventory-or-products.
                //
                // Every screen this job's description names — suppliers, purchase
                // orders, what was paid against them — sits behind
                // `feature:inventory`; the route file says so in as many words
                // ("part of the stock chain, so it rides the inventory module").
                // Offering it on `products` too meant a restaurant, which keeps a
                // menu but no stock, was shown a Purchasing job whose every
                // screen answers MODULE_DISABLED. An owner could hire someone
                // into it and that person could open nothing.
                //
                // `stock_keeper` keeps both, and correctly: half of what it
                // describes is keeping the catalog straight, which is real work
                // in a kitchen that counts no stock.
                'modules' => ['inventory'],
                'trades' => [],
            ],
            [
                'code' => 'online_orders',
                'label' => 'Online orders',
                'description' => 'Accepts and works online orders through to dispatch, and keeps the listings current.',
                'permissions' => [
                    Permissions::ORDERS_MANAGE,
                    Permissions::PRODUCTS_MANAGE,
                    Permissions::CUSTOMERS_MANAGE,
                ],
                'modules' => ['marketplace', 'delivery'],
                'trades' => [],
            ],
            [
                'code' => 'accountant',
                'label' => 'Accounts',
                'description' => 'Records money in and out and reads the reports. Cannot sell or touch stock.',
                'permissions' => [
                    Permissions::EXPENSES_MANAGE,
                    Permissions::REPORTS_VIEW,
                ],
                'modules' => ['expenses'],
                'trades' => [],
            ],
            [
                'code' => 'forecourt_attendant',
                'label' => 'Forecourt attendant',
                // A station's counter job is not a shop's counter job, and
                // "Cashier" was the only thing on offer. Closing a forecourt
                // shift ends by setting fuel stock to the DIP — a stock
                // correction, so it needs inventory.manage — and an attendant
                // who cannot close their own shift leaves the reconciliation to
                // whoever is still there at midnight.
                'description' => 'Sells fuel at the pump and closes their own forecourt shift against the dip. No tanker deliveries, no price changes.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::CUSTOMERS_MANAGE,
                    Permissions::INVENTORY_MANAGE,
                ],
                'modules' => ['fuel'],
                'trades' => ['petroleum'],
            ],
            [
                'code' => 'pharmacist',
                'label' => 'Pharmacist',
                'description' => 'Dispenses against a prescription and manages batches and expiry as well as the counter.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::DISCOUNTS_APPLY,
                    Permissions::CUSTOMERS_MANAGE,
                    Permissions::PRODUCTS_MANAGE,
                    Permissions::INVENTORY_MANAGE,
                ],
                'modules' => ['pos'],
                'trades' => ['pharmacy'],
            ],
            [
                'code' => 'manager',
                'label' => 'Manager',
                // The line: a manager runs the shop, the owner decides who works
                // in it and how it is configured. staff.manage and
                // settings.manage are the two that change the shop itself rather
                // than what happens in it, so they stay with the owner unless
                // deliberately ticked.
                'description' => 'Runs the shop day to day — sales, stock, money, reports. Not staff or shop settings; those stay yours.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::DISCOUNTS_APPLY,
                    Permissions::DISCOUNTS_OVERRIDE,
                    Permissions::SALES_VOID,
                    Permissions::SALES_REFUND,
                    Permissions::TABLES_SERVE_ANY,
                    Permissions::PRODUCTS_MANAGE,
                    Permissions::INVENTORY_MANAGE,
                    Permissions::SUPPLIERS_MANAGE,
                    Permissions::PURCHASES_MANAGE,
                    Permissions::CUSTOMERS_MANAGE,
                    Permissions::COUPONS_MANAGE,
                    Permissions::EXPENSES_MANAGE,
                    Permissions::REPORTS_VIEW,
                    Permissions::RESERVATIONS_MANAGE,
                    Permissions::ORDERS_MANAGE,
                ],
                'modules' => [],
                'trades' => [],
            ],
        ];
    }

    /**
     * The presets worth offering this shop.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function for(?Tenant $tenant): array
    {
        if ($tenant === null) {
            return [];
        }

        $modules = $tenant->moduleMap();
        $trade = $tenant->business_type !== null
            ? BusinessTypes::primary($tenant->business_type)
            : null;

        $offered = array_column(
            array_filter(
                Permissions::tenantCatalogFor($tenant),
                static fn (array $row): bool => $row['available'],
            ),
            'key',
        );

        $shown = array_values(array_filter(
            self::all(),
            function (array $preset) use ($modules, $trade): bool {
                if ($preset['trades'] !== [] && ! in_array($trade, $preset['trades'], true)) {
                    return false;
                }

                if ($preset['modules'] === []) {
                    return true;
                }

                foreach ($preset['modules'] as $module) {
                    if (! empty($modules[$module])) {
                        return true;
                    }
                }

                return false;
            },
        ));

        // Trimmed to what this shop's own form will draw — see the note at the
        // top of this file for why that is a reversal and why it is right now.
        return array_map(
            static fn (array $preset): array => [
                ...$preset,
                'permissions' => array_values(array_intersect($preset['permissions'], $offered)),
            ],
            $shown,
        );
    }

    /**
     * WHICH JOB A PERSON'S PERMISSIONS DESCRIBE, if any.
     *
     * Derived, never stored. A preset ticks boxes and is forgotten — that is
     * the whole design, and it is what keeps a preset from rotting into a
     * shadow role. So "what does this person do" is answered by looking at
     * what they hold, and one box off the set reads as null, which is the
     * honest answer.
     *
     * Matched against the UNTRIMMED lists on purpose: a shop that switched
     * dine-in off should still see its old waiters described as waiters,
     * rather than have thirty people silently become "Custom" because the
     * shop changed and they did not.
     */
    public static function matching(array $permissions): ?array
    {
        foreach (self::all() as $preset) {
            if (self::sameSet($preset['permissions'], $permissions)) {
                return $preset;
            }
        }

        return null;
    }

    /** Does this person do that job — exactly, not approximately? */
    public static function isJob(string $code, array $permissions): bool
    {
        foreach (self::all() as $preset) {
            if ($preset['code'] === $code) {
                return self::sameSet($preset['permissions'], $permissions);
            }
        }

        return false;
    }

    /**
     * Two permission lists holding the same things.
     *
     * Order and duplicates are meaningless here — `["a","b"]` and
     * `["b","a","b"]` are one job — so this compares SETS rather than arrays.
     * A plain `==` would call those two people different.
     */
    private static function sameSet(array $a, array $b): bool
    {
        $left = array_unique($a);
        $right = array_unique($b);

        return count($left) === count($right) && array_diff($left, $right) === [];
    }

    /**
     * One preset's permissions, UNTRIMMED — the canonical list for a job,
     * with no shop in the question.
     *
     * Not what the staff form applies. That comes from `for()`, which trims to
     * the boxes a given shop is shown. The two are deliberately different and
     * neither is a mistake: this one answers "what is a cashier", `for()`
     * answers "what may THIS shop make one".
     */
    public static function permissionsFor(string $code): array
    {
        foreach (self::all() as $preset) {
            if ($preset['code'] === $code) {
                return $preset['permissions'];
            }
        }

        return [];
    }
}
