<?php

namespace App\Support;

/**
 * Central permission registry. Staff users hold a subset of these in their
 * `permissions` column; scope owners hold all implicitly:
 *
 *   super_admin → all PLATFORM permissions
 *   admin_staff → assigned PLATFORM permissions only
 *   shop_owner  → all TENANT permissions
 *   staff       → assigned TENANT permissions only
 *
 * Keys grow as modules land — always through this registry, never ad hoc.
 */
class Permissions
{
    // ── Platform scope (Super Admin side) ───────────────────────────
    public const TENANTS_VIEW = 'tenants.view';

    public const TENANTS_CREATE = 'tenants.create';

    public const TENANTS_UPDATE = 'tenants.update';

    public const TENANTS_DELETE = 'tenants.delete';

    public const TENANTS_SUSPEND = 'tenants.suspend';

    public const TENANTS_ASSIGN_PLAN = 'tenants.assign_plan';

    public const PLATFORM_STAFF_MANAGE = 'platform_staff.manage';

    public const BANNERS_MANAGE = 'banners.manage';

    public const ANNOUNCEMENTS_MANAGE = 'announcements.manage';

    // ── Tenant scope (shop side) ────────────────────────────────────
    public const STAFF_MANAGE = 'staff.manage';

    public const PRODUCTS_MANAGE = 'products.manage';

    public const INVENTORY_MANAGE = 'inventory.manage';

    public const SUPPLIERS_MANAGE = 'suppliers.manage';

    public const PURCHASES_MANAGE = 'purchases.manage';

    public const SALES_MANAGE = 'sales.manage';

    public const DISCOUNTS_APPLY = 'discounts.apply';

    public const CUSTOMERS_MANAGE = 'customers.manage';

    public const COUPONS_MANAGE = 'coupons.manage';

    public const EXPENSES_MANAGE = 'expenses.manage';

    public const REPORTS_VIEW = 'reports.view';

    public const RESERVATIONS_MANAGE = 'reservations.manage';

    public const ORDERS_MANAGE = 'orders.manage';

    public const SETTINGS_MANAGE = 'settings.manage';

    /**
     * @return string[]
     */
    public static function platform(): array
    {
        return [
            self::TENANTS_VIEW,
            self::TENANTS_CREATE,
            self::TENANTS_UPDATE,
            self::TENANTS_DELETE,
            self::TENANTS_SUSPEND,
            self::TENANTS_ASSIGN_PLAN,
            self::PLATFORM_STAFF_MANAGE,
            self::BANNERS_MANAGE,
            self::ANNOUNCEMENTS_MANAGE,
        ];
    }

    /**
     * @return string[]
     */
    public static function tenant(): array
    {
        return [
            self::STAFF_MANAGE,
            self::PRODUCTS_MANAGE,
            self::INVENTORY_MANAGE,
            self::SUPPLIERS_MANAGE,
            self::PURCHASES_MANAGE,
            self::SALES_MANAGE,
            self::DISCOUNTS_APPLY,
            self::CUSTOMERS_MANAGE,
            self::COUPONS_MANAGE,
            self::EXPENSES_MANAGE,
            self::REPORTS_VIEW,
            self::RESERVATIONS_MANAGE,
            self::ORDERS_MANAGE,
            self::SETTINGS_MANAGE,
        ];
    }
}
