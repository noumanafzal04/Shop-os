<?php

namespace App\Support;

use App\Models\Tenant;

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

    /**
     * Setting a shop owner's password is the single most dangerous thing this
     * platform can do: whoever holds it can sign in as any business and read
     * every rupee that business has ever taken. It is deliberately NOT part of
     * `tenants.update` — editing a phone number and taking over an account are
     * not the same act, and bundling them would hand the second to everyone
     * trusted with the first.
     */
    public const TENANTS_RESET_PASSWORD = 'tenants.reset_password';

    /**
     * The platform's own money: what every shop has paid and when.
     *
     * Platform staff are hired for different jobs — someone who schedules
     * banner ads has no business reading the revenue ledger, and the whole
     * point of giving them a permission list is that they don't. The billing
     * endpoints were gated on ROLE alone, so every one of them did.
     */
    public const BILLING_VIEW = 'billing.view';

    public const PLATFORM_STAFF_MANAGE = 'platform_staff.manage';

    public const BANNERS_MANAGE = 'banners.manage';

    public const ANNOUNCEMENTS_MANAGE = 'announcements.manage';

    /**
     * Deciding who may ride.
     *
     * Its own permission and not folded into `tenants.create`, because it is a
     * decision about a PERSON rather than a business: whoever holds it reads a
     * stranger's CNIC and their photograph, and then lets them stand at
     * customers' doors holding cash. That is not the same authority as opening
     * a shop, and the whole reason platform staff carry a permission list is so
     * the two can be given to different people.
     */
    public const RIDERS_MANAGE = 'riders.manage';

    // ── Tenant scope (shop side) ────────────────────────────────────
    public const STAFF_MANAGE = 'staff.manage';

    public const PRODUCTS_MANAGE = 'products.manage';

    public const INVENTORY_MANAGE = 'inventory.manage';

    public const SUPPLIERS_MANAGE = 'suppliers.manage';

    public const PURCHASES_MANAGE = 'purchases.manage';

    public const SALES_MANAGE = 'sales.manage';

    /**
     * Working the pass.
     *
     * Split out from sales.manage on 2026-08-10. The kitchen board shared the
     * floor's permission "because a separate one would just go ungranted" —
     * true before job presets existed, and the reason a kitchen hand holding
     * nothing but sales.manage was offered the sales ledger, the day's banking
     * and the quotes screen. Marking a curry ready is not the same authority as
     * reading what the shop took.
     */
    public const KITCHEN_MANAGE = 'kitchen.manage';

    /**
     * The pass, read by whoever is standing at it. ANY-of, because in a small
     * kitchen the same person cooks and rings up and holds sales.manage
     * already — nobody has to be re-granted anything.
     */
    public const READS_KITCHEN = self::SALES_MANAGE.','.self::KITCHEN_MANAGE;

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

    /**
     * What the shop sells. Read by anyone who sells, stocks, buys or fulfils —
     * and by the kitchen, which reads a dish to know what it is making. That
     * last one arrived when the pass got its own permission: before, a kitchen
     * hand carried sales.manage and reached the catalog through it.
     */
    public const READS_CATALOG = self::PRODUCTS_MANAGE.','.self::SALES_MANAGE.','
        .self::INVENTORY_MANAGE.','.self::PURCHASES_MANAGE.','.self::ORDERS_MANAGE.','
        .self::KITCHEN_MANAGE;

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
     * of a product serialised the model whole, so `cost` went to anyone
     * rostered on the counter. A buying price is the one number a shop cannot
     * let walk — it is what a competitor, or a leaving member of staff, would
     * most like to have.
     *
     * This covers `cost` and nothing else. `wholesale_price` is a SELLING
     * price the till needs in order to offer the wholesale level, so it is not
     * a secret to keep from the person ringing the sale.
     *
     * Same reasoning as SUPERVISES_TILLS: reports.view is the honest marker for
     * "you may look at how the shop performs". Added to it are the three roles
     * that cannot do their job without a cost — the buyer, the stock keeper,
     * and whoever prices the catalog.
     */
    public const READS_COST = self::PRODUCTS_MANAGE.','.self::PURCHASES_MANAGE.','
        .self::INVENTORY_MANAGE.','.self::REPORTS_VIEW;

    /**
     * Who may read the shop's own audit trail.
     *
     * The trail existed for the platform and not for the shop it is about: the
     * only way in was `/admin/audit-logs`, behind `role:super_admin`. A shop
     * owner got eight rows on the dashboard and no way to ask a question of
     * them — while the Help Centre told them, correctly, that the log records
     * who did what. A record nobody named in it can read is not accountability;
     * it is a promise about a filing cabinet in somebody else's office.
     *
     * Same marker as SUPERVISES_TILLS and READS_COST: `reports.view` means "you
     * may look at how the shop performed", which is what this is, and
     * `settings.manage` means "you set the shop's rules", which is the person
     * most often being asked about. A cashier holds neither.
     */
    public const READS_AUDIT = self::SETTINGS_MANAGE.','.self::REPORTS_VIEW;

    /** The forecourt plant. Tank and pump names are read when receiving fuel or repricing it. */
    public const READS_FORECOURT = self::SETTINGS_MANAGE.','.self::PURCHASES_MANAGE.','
        .self::PRODUCTS_MANAGE.','.self::INVENTORY_MANAGE;

    /**
     * @return string[]
     */
    /**
     * What each permission is CALLED, and where a label alone leaves the owner
     * guessing, what it means.
     *
     * This lives beside the permissions rather than in the panel because the
     * two drifted once and it shipped: `tenants.reset_password` and
     * `billing.view` were added here, the panel had no copy for them, and its
     * humanising fallback rendered them as "Tenants Reset Password" and
     * "Billing View". Nothing looked broken. The most dangerous checkbox on
     * the platform — the one that lets its holder sign in as any business —
     * was offered to an admin with no explanation at all.
     *
     * Adding a permission without adding it here now fails
     * PermissionCatalogTest, which is the only arrangement where "I forgot"
     * cannot reach a screen where the wrong box gets ticked.
     *
     * Most keys carry no hint on purpose. A hint on every row is noise, and
     * noise on a permission screen is how the wrong box gets ticked.
     *
     * @var array<string, array{label: string, hint?: string}>
     */
    public const LABELS = [
        // Platform scope
        self::TENANTS_VIEW => ['label' => 'View tenants'],
        self::TENANTS_CREATE => ['label' => 'Create tenants'],
        self::TENANTS_UPDATE => ['label' => 'Edit tenants'],
        self::TENANTS_DELETE => ['label' => 'Delete tenants'],
        self::TENANTS_SUSPEND => ['label' => 'Suspend / activate tenants'],
        self::TENANTS_ASSIGN_PLAN => ['label' => 'Assign plans & record payments'],
        self::TENANTS_RESET_PASSWORD => [
            'label' => "Reset a shop owner's password",
            'hint' => "Lets them set any owner's password and sign in as that business. Grant sparingly.",
        ],
        self::BILLING_VIEW => [
            'label' => 'View revenue & payments',
            'hint' => "The platform's own takings — the billing ledger and the revenue figures on the dashboard.",
        ],
        self::PLATFORM_STAFF_MANAGE => ['label' => 'Manage platform staff'],
        self::BANNERS_MANAGE => ['label' => 'Promo banners & ads'],
        self::ANNOUNCEMENTS_MANAGE => [
            'label' => 'Announcements',
            'hint' => 'Broadcasts a push notification to every shop or every customer. There is no unsend.',
        ],
        self::RIDERS_MANAGE => [
            'label' => 'Approve riders',
            'hint' => "Reads applicants' CNIC and licence photographs, and decides who may carry customers' orders and cash.",
        ],

        // Tenant scope
        self::STAFF_MANAGE => ['label' => 'Manage staff'],
        self::PRODUCTS_MANAGE => ['label' => 'Products & categories'],
        self::INVENTORY_MANAGE => ['label' => 'Inventory adjustments'],
        self::SUPPLIERS_MANAGE => ['label' => 'Suppliers'],
        self::PURCHASES_MANAGE => ['label' => 'Purchase orders & payables'],
        self::SALES_MANAGE => ['label' => 'Sales & invoices'],
        self::KITCHEN_MANAGE => [
            'label' => 'Kitchen board',
            'hint' => 'See fired orders and mark them ready. Nothing about the till or the takings.',
        ],
        self::DISCOUNTS_APPLY => [
            'label' => 'Give a discount',
            'hint' => 'Up to the ceiling set in Shop settings.',
        ],
        self::DISCOUNTS_OVERRIDE => [
            'label' => 'Discount past the ceiling',
            'hint' => "Exceed the shop's discount limit.",
        ],
        self::SALES_VOID => [
            'label' => 'Void a completed sale',
            'hint' => 'Restores stock and reverses the money.',
        ],
        self::SALES_REFUND => ['label' => 'Refund a sale', 'hint' => 'Hand money back.'],
        self::TABLES_SERVE_ANY => [
            'label' => 'Serve any table',
            'hint' => "Work and settle other waiters' tabs. Without it, their own tables only.",
        ],
        self::CUSTOMERS_MANAGE => ['label' => 'Customers'],
        self::COUPONS_MANAGE => ['label' => 'Coupons & promotions'],
        self::EXPENSES_MANAGE => ['label' => 'Expenses'],
        self::REPORTS_VIEW => [
            'label' => 'View reports',
            'hint' => 'Takings, margins and staff performance — including what each item cost the shop.',
        ],
        self::RESERVATIONS_MANAGE => ['label' => 'Reservations'],
        self::ORDERS_MANAGE => ['label' => 'Online orders'],
        self::SETTINGS_MANAGE => ['label' => 'Shop settings'],
    ];

    /**
     * WHICH MODULE A TENANT PERMISSION IS ABOUT.
     *
     * The presets beside these checkboxes have been filtered by the shop's
     * modules and trade since they were written — "offering Waiter to a
     * pharmacy is noise, and noise in a permission screen is how the wrong box
     * gets ticked", says StaffPresets in as many words. The CHECKBOX LIST
     * underneath them never got the same treatment, so a mart hiring a cashier
     * was offered Kitchen board, Serve any table and Reservations: three boxes
     * that grant access to screens that shop does not have.
     *
     * ANY-of, like the presets: a permission is relevant when the shop holds
     * at least one of the modules named here. A key absent from this map is
     * relevant to every shop — staff, customers, expenses, settings and
     * reports are not about a module at all.
     *
     * @var array<string, string[]>
     */
    public const NEEDS_MODULE = [
        self::PRODUCTS_MANAGE => ['products', 'services'],
        self::INVENTORY_MANAGE => ['inventory'],
        self::SUPPLIERS_MANAGE => ['inventory'],
        self::PURCHASES_MANAGE => ['inventory'],
        self::SALES_MANAGE => ['pos', 'marketplace', 'dine_in'],
        self::KITCHEN_MANAGE => ['dine_in'],
        self::DISCOUNTS_APPLY => ['pos', 'marketplace', 'dine_in'],
        self::DISCOUNTS_OVERRIDE => ['pos', 'marketplace', 'dine_in'],
        self::SALES_VOID => ['pos', 'marketplace', 'dine_in'],
        self::SALES_REFUND => ['pos', 'marketplace', 'dine_in'],
        self::TABLES_SERVE_ANY => ['dine_in'],
        self::COUPONS_MANAGE => ['pos', 'marketplace'],
        self::RESERVATIONS_MANAGE => ['reservations'],
        self::ORDERS_MANAGE => ['marketplace', 'delivery'],
    ];

    /**
     * The tenant catalog, each row saying whether THIS shop can use it.
     *
     * ── Flagged, never removed ─────────────────────────────────────────
     *
     * The irrelevant rows are still returned, marked `available: false`. The
     * screen hides them — but a staff member hired while the shop had dine-in
     * may still HOLD `tables.serve_any` today, and a form that silently drops
     * every permission it did not draw would revoke it the next time anybody
     * corrected that person's phone number.
     *
     * That is the same trap `categoryOptions(keepId)` avoids on the expense
     * form: filtering a list of choices is safe, filtering a list that is also
     * the SUBMITTED STATE is a silent edit. Returning everything and letting
     * the form decide keeps the decision where the context is.
     *
     * @return list<array{key: string, label: string, hint: string|null, available: bool}>
     */
    public static function tenantCatalogFor(?Tenant $tenant): array
    {
        $modules = $tenant?->moduleMap() ?? [];

        return array_map(function (array $row) use ($modules): array {
            $needs = self::NEEDS_MODULE[$row['key']] ?? [];

            $available = $needs === [] || array_filter(
                $needs,
                static fn (string $module): bool => ! empty($modules[$module]),
            ) !== [];

            return $row + ['available' => $available];
        }, self::describe(self::tenant()));
    }

    /**
     * A permission list dressed for a screen: key, label and any hint.
     *
     * @param  string[]  $keys
     * @return list<array{key: string, label: string, hint: string|null}>
     */
    public static function describe(array $keys): array
    {
        return array_values(array_map(fn (string $key): array => [
            'key' => $key,
            // Falls back to a humanised slug rather than an empty row: an
            // unlabelled permission must still be tickable, it just should not
            // be able to reach production. The test is what stops that.
            'label' => self::LABELS[$key]['label'] ?? ucwords(str_replace(['.', '_'], ' ', $key)),
            'hint' => self::LABELS[$key]['hint'] ?? null,
        ], $keys));
    }

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
            self::TENANTS_RESET_PASSWORD,
            self::BILLING_VIEW,
            self::PLATFORM_STAFF_MANAGE,
            self::BANNERS_MANAGE,
            self::ANNOUNCEMENTS_MANAGE,
            self::RIDERS_MANAGE,
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
            self::KITCHEN_MANAGE,
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
