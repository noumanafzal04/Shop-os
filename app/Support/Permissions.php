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

    /**
     * Voiding a COMPLETED sale is the highest-risk action at a counter: it
     * restores stock and reverses the money. Separated from sales.manage so a
     * cashier can ring sales all day without being able to erase one.
     */
    public const SALES_VOID = 'sales.void';

    /** Handing money back. Same reasoning as void — a cashier rings, a manager refunds. */
    public const SALES_REFUND = 'sales.refund';

    /**
     * Exceeding the shop's discount ceiling. discounts.apply lets you give the
     * everyday discount; this lets you go past the limit the owner set.
     */
    public const DISCOUNTS_OVERRIDE = 'discounts.override';

    /**
     * Working a table that is not yours.
     *
     * A tab belongs to the waiter serving it. Without this, a waiter opens
     * tables, works their own and settles their own — which is what makes the
     * per-waiter service report worth paying tips off. With it, you can pick up
     * anyone's table: a cashier settling at the till, a supervisor covering a
     * break, a manager fixing a bill.
     *
     * Opening a NEW tab never needs it — you become the waiter by opening it —
     * and neither does reading. It gates writes to someone else's tab only.
     */
    public const TABLES_SERVE_ANY = 'tables.serve_any';

    public const CUSTOMERS_MANAGE = 'customers.manage';

    public const COUPONS_MANAGE = 'coupons.manage';

    public const EXPENSES_MANAGE = 'expenses.manage';

    public const REPORTS_VIEW = 'reports.view';

    public const RESERVATIONS_MANAGE = 'reservations.manage';

    public const ORDERS_MANAGE = 'orders.manage';

    public const SETTINGS_MANAGE = 'settings.manage';

    // ── Read sets ───────────────────────────────────────────────────
    //
    // Every permission above answers "who may CHANGE this?". That is the wrong
    // question for a read, and asking it anyway is a bug we shipped: GET
    // /products was gated on PRODUCTS_MANAGE, so a real cashier signed in and
    // the till showed an empty product grid. The API said 403; the panel drew
    // nothing; it read as "this shop has no products".
    //
    // A read is justified by ANY of the jobs that need to look. These constants
    // name those groupings so a route says why, and so widening one place
    // widens every route that shares the reason. Feed them to the permission
    // middleware, which reads a comma-joined list as ANY-of:
    //
    //     ->middleware('permission:'.Permissions::READS_CATALOG)
    //
    // Rule of thumb: reads get a set, writes keep a single permission.

    /** What the shop sells. Read by anyone who sells, stocks, buys or fulfils. */
    public const READS_CATALOG = self::PRODUCTS_MANAGE.','.self::SALES_MANAGE.','
        .self::INVENTORY_MANAGE.','.self::PURCHASES_MANAGE.','.self::ORDERS_MANAGE;

    /**
     * The shop's own branch names. Not configuration — a name lookup that the
     * branch switcher, a stock transfer and a per-branch expense all need.
     * Creating or deleting a branch stays on SETTINGS_MANAGE.
     */
    public const READS_BRANCHES = self::SETTINGS_MANAGE.','.self::SALES_MANAGE.','
        .self::INVENTORY_MANAGE.','.self::PURCHASES_MANAGE.','.self::ORDERS_MANAGE.','
        .self::EXPENSES_MANAGE.','.self::REPORTS_VIEW;

    /** Who we buy from. Narrower than the catalog: cost prices live here. */
    public const READS_SUPPLIERS = self::SUPPLIERS_MANAGE.','.self::PURCHASES_MANAGE.','
        .self::INVENTORY_MANAGE;

    /**
     * Purchase orders. Receiving a delivery is stockroom work against a
     * document the buyer raised, so INVENTORY_MANAGE reads and receives while
     * raising, placing and cancelling stay with PURCHASES_MANAGE.
     */
    public const READS_PURCHASE_ORDERS = self::PURCHASES_MANAGE.','.self::INVENTORY_MANAGE;

    /**
     * Standing over the tills rather than working one: which lanes exist, how
     * the drawers counted out, signing off the trading day, and seeing the
     * expected figure a blind close hides from the person being counted.
     *
     * Deliberately NOT settings.manage alone. Half this codebase said "a
     * manager does X" in a comment and then asked for the owner's own
     * permission in the line below it — so the Manager preset, holding 16 of
     * 18 permissions, could not open the shift history it was written to run.
     * reports.view is the honest marker: a supervisor and a manager hold it, a
     * cashier never does, and it already means "you may look at how the shop
     * performed" rather than "you may reconfigure the shop".
     */
    public const SUPERVISES_TILLS = self::SETTINGS_MANAGE.','.self::REPORTS_VIEW;

    /**
     * Who may see what the shop PAID for a thing.
     *
     * The margin report is correctly shut to a cashier, and then the same
     * figure walked out on the product grid the till loads anyway: every read
     * of a product serialised the model whole, so `cost` and `wholesale_price`
     * went to anyone rostered on the counter. A buying price is the one number
     * a shop cannot let walk — it is what a competitor, or a leaving member of
     * staff, would most like to have.
     *
     * Same reasoning as SUPERVISES_TILLS: reports.view is the honest marker for
     * "you may look at how the shop performs". Added to it are the three roles
     * that cannot do their job without a cost — the buyer, the stock keeper,
     * and whoever prices the catalog.
     */
    public const READS_COST = self::PRODUCTS_MANAGE.','.self::PURCHASES_MANAGE.','
        .self::INVENTORY_MANAGE.','.self::REPORTS_VIEW;

    /** The forecourt plant. Tank and pump names are read when receiving fuel or repricing it. */
    public const READS_FORECOURT = self::SETTINGS_MANAGE.','.self::PURCHASES_MANAGE.','
        .self::PRODUCTS_MANAGE.','.self::INVENTORY_MANAGE;

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
            self::DISCOUNTS_OVERRIDE,
            self::SALES_VOID,
            self::SALES_REFUND,
            self::TABLES_SERVE_ANY,
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
