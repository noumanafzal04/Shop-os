import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  BoltIcon,
  BoxCubeIcon,
  BoxIcon,
  CalenderIcon,
  ChatIcon,
  ChevronDownIcon,
  CopyIcon,
  DocsIcon,
  DollarLineIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  GroupIcon,
  InfoIcon,
  ListIcon,
  MoreDotIcon,
  PaperPlaneIcon,
  PieChartIcon,
  PlugInIcon,
  ShootingStarIcon,
  TableIcon,
  TaskIcon,
  UserCircleIcon,
  UserIcon,
} from "../icons";
import { BrandMark, Wordmark } from "../components/brand/Brand";
import { useSidebar } from "../context/SidebarContext";
import { useUiMode, type UiMode } from "../context/UiModeContext";
import { useShopSettings } from "../modules/shop/hooks/useShop";
import { useAuthStore } from "../stores/authStore";
import { homeForRole } from "../common/routing/guards";
import { canVisit } from "../common/routing/screenPermissions";
import { canVisitAdmin } from "../common/routing/adminScreenPermissions";
import { tracksSerials, usePrimaryBusinessType } from "../common/tenant/businessType";
import { boardWords, hasJobBoard } from "../modules/workshop/words";

type SubItem = { name: string; path: string; pro?: boolean; new?: boolean };

export type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: SubItem[];
};

/**
 * Tenant nav for first-time users: the five daily-use modules are direct
 * links on top; everything specialised folds into DROPDOWN parents below
 * (tap to expand — the section with the active page auto-opens). Items only
 * appear when the business has the matching feature enabled (no marketplace
 * feature → no Collections; no reservations feature → no Reservations).
 *
 * Three axes decide what a person sees, and all three have to agree:
 *
 *   MODULE  — what the shop bought (`features`)
 *   TRADE   — what the shop is (`businessType`, already resolved to a current
 *             code, so an old `clinic` still gets the chemist's register)
 *   PERSON  — what this user may do (`can`)
 *
 * The third was missing: a cashier with only sales.manage was offered Staff,
 * Reports and Suppliers and got a 403 from each. Which permission each screen
 * needs is NOT written here — it lives in screenPermissions, the one map the
 * dashboard tiles read as well, because two lists of the same rule is how the
 * menu and the dashboard end up disagreeing about the same cashier.
 */
export function shopNav(
  features: Record<string, boolean> | undefined,
  businessType: string | null | undefined,
  mode: UiMode,
  multiBranch: boolean,
  can: (permission: string) => boolean = () => true,
): NavItem[] {
  const branchItem: NavItem = {
    // Two of the same thing, which is what a branch IS. It wore the cube that
    // Products wears — different components, near-identical pictures, and the
    // icon-uniqueness test cannot see that because it compares names. Some of
    // this only a pair of eyes finds.
    icon: <CopyIcon />,
    name: "Branches",
    subItems: [
      // Adding a location is configuration; moving stock between them is
      // stock work — two different people in a bigger shop.
      { name: "Locations", path: "/tenant/branches" },
      { name: "Transfers", path: "/tenant/transfers" },
    ],
  };
  // A capability shows only when its flag is explicitly on. Types that don't
  // offer a feature omit its key entirely (e.g. pharmacy has no `dine_in`), so
  // a missing key must read as OFF — never default to true, or a pharmacy ends
  // up with a Dine-in link.
  const has = (key: string) => features?.[key] ?? false;

  // A books-only tenant (Finance Manager) sells nothing and has no till, so it
  // must not see a Sales ledger or a Catalog it can never fill. Derive both
  // from capability, not business type — a shop that later buys the POS module
  // gets them back automatically.
  const canSell = has("pos") || has("marketplace");
  const hasCatalog = has("products") || has("services");

  /**
   * The one screen this trade's day actually runs on, beside the till.
   *
   * A restaurant's is the kitchen pass; a workshop's is the board of cars in
   * the bay; a chemist's is the dispensing register; a station's is the shift.
   * These used to live in "More" — a dropdown — while Simple mode dropped them
   * altogether, so a workshop's calm view offered Products and withheld the
   * board its whole day is spent on. Simple mode is meant to be the daily
   * essentials, and for these trades this IS the daily essential.
   */
  const tradeDaily: NavItem[] = [
    // The pass lives on a different wall from the till: same shop, two people,
    // two displays.
    ...(has("dine_in") ? [{ icon: <TaskIcon />, name: "Kitchen", path: "/tenant/kitchen" }] : []),
    // The board of work TAKEN IN — every car in the bay, or every job on the
    // rail. A laundry, a tailor and a repair counter all run exactly this.
    ...(has("pos") && hasJobBoard(businessType)
      ? [{ icon: <TaskIcon />, name: boardWords(businessType).board, path: "/tenant/workshop" }]
      : []),
    // The chemist's paperwork: the dispensing register and batch recall.
    // Pharmacy-only — a mart that happens to stock paracetamol keeps no
    // register, and the page would be an empty table forever.
    ...(has("inventory") && businessType === "pharmacy"
      ? [{ icon: <ListIcon />, name: "Dispensary", path: "/tenant/pharmacy" }]
      : []),
  ];

  // The forecourt. A station runs its day off the shift, so it sits with the
  // daily screens rather than buried in setup — the equipment page is its
  // sub-item because it's touched once and then left alone.
  const forecourt: NavItem[] = has("fuel")
    ? [{
        icon: <BoltIcon />,
        name: "Forecourt",
        subItems: [
          // A forecourt shift ends by setting fuel stock to the dip, so it is a
          // stock correction; a tanker is goods received; the plant is
          // configuration. Three screens, three different people.
          { name: "Shifts", path: "/tenant/fuel" },
          { name: "Deliveries & rates", path: "/tenant/fuel/deliveries" },
          { name: "Tanks & pumps", path: "/tenant/fuel/setup" },
        ],
      }]
    : [];

  // The Expense & Income module — one home for all money in/out.
  const expenseManager: NavItem = {
    icon: <PieChartIcon />,
    name: "Expense Manager",
    subItems: [
      { name: "Cashbook", path: "/tenant/cashbook" },
      // The book itself: every movement, balance carried down. Sits beside the
      // day summary because they answer the same question at two depths.
      { name: "Ledger", path: "/tenant/ledger" },
      { name: "Income", path: "/tenant/income" },
      { name: "Expenses", path: "/tenant/expenses" },
    ],
  };

  // Basic mode: the daily essentials only — the calm view for a new merchant.
  //
  // "Essential" is read per TRADE, not per module. It used to be one list for
  // everybody, so a restaurant's calm view had Dine-in and no Kitchen, a
  // workshop had Products and no board, and a filling station had no forecourt
  // at all — the screens those shops spend the whole day on.
  if (mode === "basic") {
    return filterByPermission([
      { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
      ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
      ...(has("dine_in") ? [{ icon: <TableIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
      ...tradeDaily,
      ...forecourt,
      ...(canSell ? [{ icon: <FileIcon />, name: "Sales", path: "/tenant/sales" }] : []),
      // End of day. Even the calm view needs it — without it a shop can never
      // close a day off or record what went to the bank.
      ...(has("pos") ? [{ icon: <CalenderIcon />, name: "Day & banking", path: "/tenant/day" }] : []),
      ...(has("marketplace") || has("delivery") ? [{ icon: <PaperPlaneIcon />, name: "Orders", path: "/tenant/orders" }] : []),
      ...(hasCatalog ? [{ icon: <BoxIcon />, name: "Products", path: "/tenant/products" }] : []),
      ...(has("expenses") ? [expenseManager] : []),
      ...(multiBranch ? [branchItem] : []),
      { icon: <PlugInIcon />, name: "Settings", path: "/tenant/settings" },
    // Last, and never gated: anyone in the shop can get stuck, and what
    // the Help Centre SHOWS is already filtered to this shop's modules
    // and to what the reader can open.
    { icon: <InfoIcon />, name: "Help Centre", path: "/tenant/help" },
    ], can);
  }

  return filterByPermission([
    // ── Daily essentials ──────────────────────────────────────────
    { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
    // POS till is only for shops on a plan that includes it (not online-only).
    ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
    ...(has("dine_in") ? [{ icon: <TableIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
    // The kitchen pass, the bay board, the dispensing register — whichever of
    // them this trade runs its day on. Same list Simple mode uses, so the two
    // views cannot disagree about what this shop's daily work IS.
    ...tradeDaily,
    ...(canSell ? [{ icon: <FileIcon />, name: "Sales", path: "/tenant/sales" }] : []),
    // The 10pm question: what did the shop take today across every drawer, and
    // how much of it went to the bank. No shift answers it, however well
    // counted — so it sits with the daily screens, not in a reports folder.
    // A cashier is entitled to the record of their own drawer, so it carries
    // the same permission as ringing a sale; the day CLOSE is manager-only,
    // checked on the server.
    ...(has("pos") ? [{ icon: <CalenderIcon />, name: "Day & banking", path: "/tenant/day" }] : []),
    // Promises outstanding: prices quoted, and goods held on advance. Sits
    // beside Sales because it is the same ledger one step earlier — and a
    // shopkeeper holding customers' money needs it where they'll see it daily.
    ...(has("pos") ? [{ icon: <DocsIcon />, name: "Quotes & Advances", path: "/tenant/documents" }] : []),
    ...(has("marketplace") || has("delivery") ? [{ icon: <PaperPlaneIcon />, name: "Orders", path: "/tenant/orders" }] : []),
    ...(has("delivery") ? [{ icon: <UserIcon />, name: "Riders", path: "/tenant/riders" }] : []),
    ...forecourt,
    // Expense & Income module — one home for all money in/out.
    ...(has("expenses") ? [expenseManager] : []),
    // Multi-branch: a locations manager appears only when the plan allows >1.
    ...(multiBranch ? [branchItem] : []),

    // ── Grouped dropdowns ─────────────────────────────────────────
    // Basic mode already hid these from a books-only shop; Full view was
    // showing a Catalog it can never fill and coupons for sales it never
    // makes. The rule is the same in both modes or the switch changes what
    // the business IS, not just how much of it is on screen.
    ...(hasCatalog
      ? [{
          icon: <BoxIcon />,
          name: "Catalog",
          subItems: [
            { name: "Products & Services", path: "/tenant/products" },
            { name: "Categories", path: "/tenant/categories" },
            // Collections merchandise the ONLINE storefront — pointless without it.
            ...(has("marketplace") ? [{ name: "Collections", path: "/tenant/collections" }] : []),
          ],
        }]
      : []),
    ...(has("inventory")
      ? [
          {
            icon: <FolderIcon />,
            name: "Inventory",
            subItems: [
              { name: "Stock", path: "/tenant/inventory" },
              // Where stock went when it left without being sold — and what a
              // distributor still owes for the part that went back.
              { name: "Disposals", path: "/tenant/disposals" },
              // Counting the shelves against the books. The only way a shop
              // finds out what it is actually losing.
              { name: "Stocktake", path: "/tenant/stocktake" },
              // A label is printed from the catalog record, not the shelf.
              { name: "Barcode Labels", path: "/tenant/labels" },
              { name: "Suppliers", path: "/tenant/suppliers" },
              { name: "Purchases", path: "/tenant/purchases" },
            ],
          },
        ]
      : []),
    ...(canSell || hasCatalog
      ? [{
          icon: <GroupIcon />,
          name: "Customers",
          subItems: [
            { name: "Customer List", path: "/tenant/customers" },
            { name: "Coupons", path: "/tenant/coupons" },
            { name: "Promotions", path: "/tenant/promotions" },
            // A bank funding a discount on its own cards. Beside Promotions
            // because it is the same kind of thing and the same permission —
            // and because a shop looking for "our offers" looks here.
            { name: "Bank offers", path: "/tenant/bank-offers" },
            // Replying is the only thing anyone does on the reviews screen,
            // and the server asks for settings.manage to do it.
            ...(has("marketplace") ? [{ name: "Reviews", path: "/tenant/reviews" }] : []),
            ...(has("reservations") ? [{ name: "Reservations", path: "/tenant/reservations" }] : []),
          ],
        }]
      : []),
    {
      // The back office, plus the counter LOOKUPS a trade reaches for when a
      // customer is standing there — not its daily board, which is above.
      //
      // "More" used to hold both, so a workshop's whole day's work sat inside a
      // dropdown named after nothing in particular.
      icon: <MoreDotIcon />,
      name: "More",
      subItems: [
        { name: "Reports", path: "/tenant/reports" },
        { name: "Staff", path: "/tenant/staff" },
        // Who changed what. Beside Staff because it answers the question Staff
        // raises — you granted somebody a permission, and later you want to
        // know what they did with it.
        { name: "Activity", path: "/tenant/activity" },
        // A tyre or auto shop's real customer key: the plate, what the car
        // takes, and what was fitted last time. Only the trades that work on
        // vehicles — a grocery would never open it twice. A vehicle IS
        // customer data, so it carries the CRM permission.
        //
        // Narrower than the bay board above on purpose: a fuel station keeps
        // vehicle records for its account customers but has no bay.
        ...(has("products") && (businessType === "automotive" || businessType === "petroleum")
          ? [{ name: "Vehicles", path: "/tenant/vehicles" }]
          : []),
        // Serialized goods (phones, electronics, batteries) — look up a
        // serial's warranty. The trades that sell a unit somebody brings back;
        // a grocery or pharmacy never does. Same list the product form gates
        // the serial toggle on, so where you turn it on and where you look it
        // up cannot disagree.
        ...(has("pos") && has("inventory") && tracksSerials(businessType)
          ? [{ name: "Warranty lookup", path: "/tenant/warranty" }]
          : []),
        // The public service menu belongs to service businesses — petroleum has
        // the `services` flag for pump labour, but no portfolio to show off.
        // It is what the shop shows the world, hence the settings permission.
        ...(has("services") && businessType === "services"
          ? [{ name: "Portfolio", path: "/tenant/portfolio" }]
          : []),
      ],
    },

    // Settings + subscription stand alone at the bottom — one click away.
    // Subscription carries no permission because the server asks for none:
    // what the shop pays is not a secret from the people who work in it.
    { icon: <ShootingStarIcon />, name: "Subscription", path: "/tenant/subscription" },
    { icon: <PlugInIcon />, name: "Settings", path: "/tenant/settings" },
    // Last, and never gated: anyone in the shop can get stuck, and what
    // the Help Centre SHOWS is already filtered to this shop's modules
    // and to what the reader can open.
    { icon: <InfoIcon />, name: "Help Centre", path: "/tenant/help" },
  ], can);
}

/**
 * Drops the screens this person may not open, per screenPermissions.
 *
 * A dropdown whose every child was dropped goes with them — an empty "More"
 * that opens onto nothing is worse than no More at all. A parent with its own
 * path keeps it (nothing today has both).
 */
function filterByPermission(items: NavItem[], can: (permission: string) => boolean): NavItem[] {
  return items
    .filter((item) => item.path === undefined || canVisit(item.path, can))
    .map((item) => (item.subItems
      ? { ...item, subItems: item.subItems.filter((sub) => canVisit(sub.path, can)) }
      : item))
    .filter((item) => item.path !== undefined || (item.subItems?.length ?? 0) > 0);
}

// Admin nav is split into two groups for a clean, scannable sidebar:
// day-to-day platform operations first, then the configuration and oversight
// the owner touches less often (separated by a hairline, not a heading).
const adminMainItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/admin" },
  { icon: <GroupIcon />, name: "Tenants", path: "/admin/tenants" },
  { icon: <ListIcon />, name: "Plans", path: "/admin/plans" },
  { icon: <DollarLineIcon />, name: "Billing & Payments", path: "/admin/payments" },
];

const adminPlatformItems: NavItem[] = [
  { icon: <BoltIcon />, name: "Configuration", path: "/admin/config" },
  { icon: <BoxCubeIcon />, name: "Banners / Ads", path: "/admin/banners" },
  { icon: <ChatIcon />, name: "Announcements", path: "/admin/announcements" },
  { icon: <UserCircleIcon />, name: "Platform Staff", path: "/admin/staff" },
  { icon: <FileIcon />, name: "Audit Log", path: "/admin/audit-logs" },
  { icon: <InfoIcon />, name: "Help Centre", path: "/admin/help" },
];

/**
 * The admin rail this person is actually offered. The rule itself lives in
 * adminScreenPermissions — the dashboard's Quick Actions offer the same nine
 * screens, and two lists of one rule is how they drift apart.
 */
export function adminNav(
  items: NavItem[],
  isSuperAdmin: boolean,
  permissions: string[] | undefined,
): NavItem[] {
  return items.filter((item) => !item.path || canVisitAdmin(item.path, isSuperAdmin, permissions));
}

/** Section roots would swallow every child route in a prefix match. */
const SECTION_ROOTS = ["/tenant", "/admin"];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, railWide, setIsHovered, closeMobileSidebar } =
    useSidebar();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const features = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );
  // Some items are feature-on but type-specific (warranty = retail only), so
  // the nav needs the business type alongside the flags — always the RESOLVED
  // one, or an older tenant loses screens its current type is entitled to.
  const businessType = usePrimaryBusinessType();
  // What this person may do. The permission LIST is what we subscribe to —
  // the store's hasPermission is a stable closure, so selecting it alone would
  // leave the rail stale after a fresh /me changed what a staff member holds.
  const permissions = useAuthStore((s) => s.user?.permissions);
  const can = useCallback(
    // Mirrors authStore.hasPermission: scope owners hold every permission.
    (permission: string) => role === "shop_owner" || (permissions?.includes(permission) ?? false),
    [role, permissions],
  );

  const { mode, toggleMode } = useUiMode();
  const shopSettings = useShopSettings();
  // Multi-branch UI shows only when the plan allows more than one branch
  // (max_branches null = unlimited → true; 1 → false).
  const multiBranch = shopSettings.data ? shopSettings.data.max_branches !== 1 : false;
  const isAdmin = role === "super_admin" || role === "admin_staff";
  const navItems = isAdmin
    ? adminNav(adminMainItems, role === "super_admin", permissions)
    : shopNav(features, businessType, mode, multiBranch, can);
  // Second group: platform config for admins; unused on the shop side.
  const othersItems: NavItem[] = isAdmin
    ? adminNav(adminPlatformItems, role === "super_admin", permissions)
    : [];

  // Labels show when the rail is pinned open, peeked on hover, or drawn over
  // the page on mobile — the one condition that drives every layout choice.
  // The rail's width, and the page's margin, are one decision. Read from the
  // context so AppLayout cannot answer it differently — see the note on
  // `railWide` in SidebarContext for what happened when it did.
  const showLabels = railWide;

  // Go somewhere, the drawer goes away.
  //
  // It never did. On a phone you don't notice, because the next tap is on a
  // page you can't see anyway. On a tablet you very much do: the drawer is
  // 290 of 820px, the page loads BEHIND it, and the only way back to what you
  // just asked for is to find the toggle again. Pinned rails are unaffected —
  // closing a drawer that was never open is free.
  useEffect(() => {
    closeMobileSidebar();
    // Deliberately keyed on the path alone. Adding the callback would re-run
    // this on every provider render and shut a drawer nobody navigated with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Hover-to-peek is for a mouse, and only a mouse.
  //
  // A touch screen fires mouseenter on tap and frequently never fires the
  // matching mouseleave, so on a tablet the rail latched open at 290px and
  // stayed there — the page beside it reflowing to a width the shop never
  // asked for. `hover: hover` is the browser telling us there is a real
  // pointer; anything else gets the toggle, which is unambiguous.
  const [canPeek, setCanPeek] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setCanPeek(mq.matches);
    apply();
    mq.addEventListener("change", apply);

    return () => mq.removeEventListener("change", apply);
  }, []);

  // The Appearance canvas writes data-sidebar on <html> (saved value on load,
  // and again on every keystroke while previewing). Watching the attribute —
  // rather than the settings query — means the rail repaints live as the
  // merchant tries options, and still shows the stored choice on a cold load.
  const [sidebarStyle, setSidebarStyle] = useState<string>(
    () => (typeof document !== "undefined" ? document.documentElement.dataset.sidebar : undefined) ?? "light",
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setSidebarStyle(el.dataset.sidebar ?? "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["data-sidebar"] });

    return () => observer.disconnect();
  }, []);

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);

  // A child route (…/products/42) keeps its nav row lit, so deep pages never
  // look like they left the module.
  const isActive = useCallback(
    (path: string) =>
      location.pathname === path ||
      (!SECTION_ROOTS.includes(path) && location.pathname.startsWith(`${path}/`)),
    [location.pathname]
  );

  useEffect(() => {
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            if (isActive(subItem.path)) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              submenuMatched = true;
            }
          });
        }
      });
    });

    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
  }, [location, isActive]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  const renderMenuItems = (items: NavItem[], menuType: "main" | "others") => (
    <ul className="flex flex-col gap-1">
      {items.map((nav, index) => {
        const isOpen = openSubmenu?.type === menuType && openSubmenu?.index === index;
        // A collapsed rail hides the children, so the parent has to carry the
        // "you are here" pill itself.
        const childActive = nav.subItems?.some((sub) => isActive(sub.path)) ?? false;

        return (
          <li key={nav.name}>
            {nav.subItems ? (
              <button
                type="button"
                onClick={() => handleSubmenuToggle(index, menuType)}
                title={showLabels ? undefined : nav.name}
                aria-expanded={isOpen}
                className={`menu-item group min-h-11 cursor-pointer ${
                  childActive
                    ? "menu-item-active"
                    : isOpen
                      ? "bg-gray-100 text-gray-800 dark:bg-white/5 dark:text-white/90"
                      : "menu-item-inactive"
                } ${showLabels ? "lg:justify-start" : "lg:justify-center"}`}
              >
                <span
                  className={`menu-item-icon-size ${
                    childActive ? "menu-item-icon-active" : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {showLabels && (
                  <>
                    <span className="menu-item-text truncate">{nav.name}</span>
                    <ChevronDownIcon
                      className={`ml-auto size-4 shrink-0 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </>
                )}
              </button>
            ) : (
              nav.path && (
                <Link
                  to={nav.path}
                  title={showLabels ? undefined : nav.name}
                  className={`menu-item group min-h-11 ${
                    isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                  } ${showLabels ? "lg:justify-start" : "lg:justify-center"}`}
                >
                  <span
                    className={`menu-item-icon-size ${
                      isActive(nav.path)
                        ? "menu-item-icon-active"
                        : "menu-item-icon-inactive"
                    }`}
                  >
                    {nav.icon}
                  </span>
                  {showLabels && <span className="menu-item-text truncate">{nav.name}</span>}
                </Link>
              )
            )}

            {/* 0fr → 1fr animates the drawer without measuring anything, so a
                submenu that grows when features load can never clip. */}
            {nav.subItems && showLabels && (
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <ul className="ml-6 space-y-0.5 overflow-hidden border-l border-gray-200 pl-3 dark:border-gray-800">
                  {nav.subItems.map((subItem) => (
                    <li key={subItem.name} className="first:mt-1 last:mb-1">
                      <Link
                        to={subItem.path}
                        className={`menu-dropdown-item group ${
                          isActive(subItem.path)
                            ? "menu-dropdown-item-active"
                            : "menu-dropdown-item-inactive"
                        }`}
                      >
                        <span className="truncate">{subItem.name}</span>
                        {(subItem.new || subItem.pro) && (
                          <span className="ml-auto flex items-center gap-1">
                            {subItem.new && (
                              <span
                                className={`${
                                  isActive(subItem.path)
                                    ? "menu-dropdown-badge-active"
                                    : "menu-dropdown-badge-inactive"
                                } menu-dropdown-badge`}
                              >
                                new
                              </span>
                            )}
                            {subItem.pro && (
                              <span
                                className={`${
                                  isActive(subItem.path)
                                    ? "menu-dropdown-badge-active"
                                    : "menu-dropdown-badge-inactive"
                                } menu-dropdown-badge`}
                              >
                                pro
                              </span>
                            )}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  // Sidebar surface, chosen in the Appearance canvas. "dark" puts the `dark`
  // class on the rail itself so every nav item's existing dark: variant lights
  // up — a dark rail in light mode with no per-item overrides. The rail's OWN
  // colours are set explicitly, since it isn't a descendant of itself.
  const railClass =
    sidebarStyle === "dark"
      ? "dark bg-gray-900 border-gray-800"
      : sidebarStyle === "tinted"
        ? "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
        : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800";

  return (
    /* A drawer that owns its own edges.
     *
     * It used to start `mt-16` down the page with `h-[calc(100dvh-4rem)]` — a
     * hard-coded belief that the header is exactly 64px tall. Below `lg` the
     * header is 64px with the account menu shut and roughly 140 with it open,
     * and on a tablet that menu is the ONLY route to notifications, branch and
     * profile, so it is open often. Open it and the header — sitting at
     * z-99999 against the rail's z-50 — printed itself straight over the top
     * of the nav.
     *
     * Now the drawer is full height and above the header, so no header
     * measurement can be wrong, and it carries its own close (below). The
     * pinned rail at `lg` keeps the old stacking, where it sits beside the
     * header and never meets it. */
    <aside
      className={`fixed inset-y-0 left-0 z-100002 flex h-dvh flex-col border-r text-gray-900 transition-all duration-300 ease-in-out lg:z-50 ${railClass}
        ${showLabels ? "w-[290px]" : "w-[90px]"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => canPeek && !isExpanded && setIsHovered(true)}
      onMouseLeave={() => canPeek && setIsHovered(false)}
    >
      {/* Pinned header: wordmark, plus the collapse toggle from the reference. */}
      <div
        className={`flex shrink-0 items-center gap-2 px-5 py-6 ${
          showLabels ? "justify-between" : "lg:justify-center"
        }`}
      >
        <Link to={homeForRole(role)} className="flex items-center">
          {showLabels ? <Wordmark /> : <BrandMark />}
        </Link>
        {/* Close, on the drawer itself.
            The only way out used to be the header's toggle, which the drawer
            now covers. A drawer you can open and not close is a trap, and it
            should never have depended on a control living in another
            component to begin with. */}
        {isMobileOpen && (
          <button
            type="button"
            onClick={closeMobileSidebar}
            aria-label="Close menu"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200 lg:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
        {/* No collapse button here.
            There was one — the same three-bar icon the header already carries,
            nine pixels from the wordmark, doing the identical thing four
            centimetres from its twin. Two controls for one action is not twice
            as convenient; it is a question about whether they differ. The
            header's is the one that survives, because it is reachable whether
            the sidebar is open or shut and this one was not. */}
      </div>

      {/* The ONLY scroller: min-h-0 lets it shrink inside the flex column, so a
          long module list stays reachable at any viewport height. */}
      <nav
        className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-4 [scrollbar-color:var(--color-gray-300)_transparent] [scrollbar-width:thin] dark:[scrollbar-color:var(--color-gray-700)_transparent]"
      >
        {renderMenuItems(navItems, "main")}

        {othersItems.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            {showLabels && (
              <p className="mb-2 px-3 text-[11px] font-medium uppercase leading-5 tracking-wider text-gray-400 dark:text-gray-500">
                Platform
              </p>
            )}
            {renderMenuItems(othersItems, "others")}
          </div>
        )}
      </nav>

      {/* Simple / Full view toggle — shop side only. Simple trims the menu to
          the essentials; Full reveals every module the shop has. Remembered per
          device.

          Carried in the brand colour rather than sidebar grey: a merchant who
          can't find half their modules needs to SEE the switch that hid them —
          a quiet control at the bottom of a scroller reads as decoration. */}
      {!isAdmin && (
        <div className="shrink-0 border-t border-gray-100 px-4 py-4 dark:border-gray-800">
          {showLabels ? (
            <>
              <p className="mb-2 px-1 text-[11px] font-medium uppercase leading-5 tracking-wider text-gray-400 dark:text-gray-500">
                Menu view
              </p>
              <div className="flex items-center gap-1 rounded-xl border border-brand-100 bg-brand-50 p-1.5 dark:border-brand-500/25 dark:bg-brand-500/10">
                {(["basic", "advanced"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => mode !== m && toggleMode()}
                    className={`flex-1 rounded-lg py-2.5 text-theme-sm font-semibold transition-colors ${
                      mode === m
                        ? "bg-brand-500 text-white shadow-theme-xs"
                        : "text-brand-600 hover:bg-white/70 dark:text-brand-300 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {m === "basic" ? "Simple" : "Full view"}
                  </button>
                ))}
              </div>
              <p className="mt-2 px-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
                {mode === "basic"
                  ? "The screens your day runs on. Switch to Full view for every module."
                  : "Every module this shop has."}
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={toggleMode}
              title={mode === "basic" ? "Switch to full view" : "Switch to simple menu"}
              className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25"
            >
              {mode === "basic" ? <ListIcon className="size-5" /> : <GridIcon className="size-5" />}
            </button>
          )}
        </div>
      )}
    </aside>
  );
};

export default AppSidebar;
