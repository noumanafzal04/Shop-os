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
 * A preset grants its full list even where a module is off. The module gate is
 * the real boundary and it is enforced server-side on every request, so such a
 * permission is inert by construction — and it means what the owner intended if
 * that module is switched on later. Trimming the list instead would leave an
 * invisible gap that surfaces months afterwards as "why can't my manager see
 * online orders".
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
                'description' => 'Rings sales and takes payment. Cannot void a completed sale or hand money back — those stay with a supervisor.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
                    Permissions::DISCOUNTS_APPLY,
                    Permissions::CUSTOMERS_MANAGE,
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
                    Permissions::REPORTS_VIEW,
                ],
                'modules' => ['pos'],
                'trades' => [],
            ],
            [
                'code' => 'waiter',
                'label' => 'Waiter',
                'description' => 'Opens tables, takes orders, sends them to the kitchen and settles the bill.',
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
                // Said plainly rather than hidden: the kitchen screen shares the
                // floor's permission on purpose (in a small kitchen the same
                // person cooks and rings up), so this preset does let them work
                // the floor. An owner choosing it should know that.
                'description' => 'Sees the kitchen board and marks food ready. Shares the floor’s permission, so they can also take orders.',
                'permissions' => [
                    Permissions::SALES_MANAGE,
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
                'modules' => ['inventory', 'products'],
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

        return array_values(array_filter(
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
    }

    /** One preset's permissions, or an empty list for an unknown code. */
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
