import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  BoltIcon,
  BoxCubeIcon,
  BoxIcon,
  ChatIcon,
  ChevronDownIcon,
  DollarLineIcon,
  FileIcon,
  GridIcon,
  GroupIcon,
  ListIcon,
  PlugInIcon,
  UserCircleIcon,
} from "../icons";
import { useSidebar } from "../context/SidebarContext";
import { useUiMode, type UiMode } from "../context/UiModeContext";
import { useShopSettings } from "../modules/shop/hooks/useShop";
import { useAuthStore } from "../stores/authStore";
import { homeForRole } from "../common/routing/guards";
import { canVisit } from "../common/routing/screenPermissions";
import { usePrimaryBusinessType } from "../common/tenant/businessType";

type SubItem = { name: string; path: string; pro?: boolean; new?: boolean };

type NavItem = {
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
    icon: <BoxCubeIcon />,
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

  // The Expense & Income module — one home for all money in/out.
  const expenseManager: NavItem = {
    icon: <FileIcon />,
    name: "Expense Manager",
    subItems: [
      { name: "Cashbook", path: "/tenant/cashbook" },
      { name: "Income", path: "/tenant/income" },
      { name: "Expenses", path: "/tenant/expenses" },
    ],
  };

  // Basic mode: the daily essentials only — the calm view for a new merchant.
  if (mode === "basic") {
    return filterByPermission([
      { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
      ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
      ...(has("dine_in") ? [{ icon: <GridIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
      ...(canSell ? [{ icon: <DollarLineIcon />, name: "Sales", path: "/tenant/sales" }] : []),
      // End of day. Even the calm view needs it — without it a shop can never
      // close a day off or record what went to the bank.
      ...(has("pos") ? [{ icon: <ListIcon />, name: "Day & banking", path: "/tenant/day" }] : []),
      ...(has("marketplace") || has("delivery") ? [{ icon: <PlugInIcon />, name: "Orders", path: "/tenant/orders" }] : []),
      ...(hasCatalog ? [{ icon: <BoxIcon />, name: "Products", path: "/tenant/products" }] : []),
      ...(has("expenses") ? [expenseManager] : []),
      ...(multiBranch ? [branchItem] : []),
      { icon: <BoltIcon />, name: "Settings", path: "/tenant/settings" },
    ], can);
  }

  return filterByPermission([
    // ── Daily essentials ──────────────────────────────────────────
    { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
    // POS till is only for shops on a plan that includes it (not online-only).
    ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
    ...(has("dine_in") ? [{ icon: <GridIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
    // The kitchen board is a separate screen because it lives on a different
    // wall from the till — the same shop, two people, two displays.
    ...(has("dine_in") ? [{ icon: <ListIcon />, name: "Kitchen", path: "/tenant/kitchen" }] : []),
    ...(canSell ? [{ icon: <DollarLineIcon />, name: "Sales", path: "/tenant/sales" }] : []),
    // The 10pm question: what did the shop take today across every drawer, and
    // how much of it went to the bank. No shift answers it, however well
    // counted — so it sits with the daily screens, not in a reports folder.
    // A cashier is entitled to the record of their own drawer, so it carries
    // the same permission as ringing a sale; the day CLOSE is manager-only,
    // checked on the server.
    ...(has("pos") ? [{ icon: <ListIcon />, name: "Day & banking", path: "/tenant/day" }] : []),
    // Promises outstanding: prices quoted, and goods held on advance. Sits
    // beside Sales because it is the same ledger one step earlier — and a
    // shopkeeper holding customers' money needs it where they'll see it daily.
    ...(has("pos") ? [{ icon: <ListIcon />, name: "Quotes & Advances", path: "/tenant/documents" }] : []),
    ...(has("marketplace") || has("delivery") ? [{ icon: <PlugInIcon />, name: "Orders", path: "/tenant/orders" }] : []),
    ...(has("delivery") ? [{ icon: <GroupIcon />, name: "Riders", path: "/tenant/riders" }] : []),
    // The forecourt. A station runs its day off the shift, so it sits with the
    // daily screens rather than buried in setup — the equipment page is its
    // sub-item because it's touched once and then left alone.
    ...(has("fuel")
      ? [{
          icon: <BoltIcon />,
          name: "Forecourt",
          subItems: [
            // A forecourt shift ends by setting fuel stock to the dip, so it
            // is a stock correction; a tanker is goods received; the plant is
            // configuration. Three screens, three different people.
            { name: "Shifts", path: "/tenant/fuel" },
            { name: "Deliveries & rates", path: "/tenant/fuel/deliveries" },
            { name: "Tanks & pumps", path: "/tenant/fuel/setup" },
          ],
        }]
      : []),
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
            icon: <BoxCubeIcon />,
            name: "Inventory",
            subItems: [
              { name: "Stock", path: "/tenant/inventory" },
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
            // Replying is the only thing anyone does on the reviews screen,
            // and the server asks for settings.manage to do it.
            ...(has("marketplace") ? [{ name: "Reviews", path: "/tenant/reviews" }] : []),
            ...(has("reservations") ? [{ name: "Reservations", path: "/tenant/reservations" }] : []),
          ],
        }]
      : []),
    {
      icon: <BoltIcon />,
      name: "More",
      subItems: [
        { name: "Reports", path: "/tenant/reports" },
        { name: "Staff", path: "/tenant/staff" },
        // The chemist's paperwork: the dispensing register and batch recall.
        // Pharmacy-only — a mart that happens to stock paracetamol keeps no
        // register, and the page would be an empty table forever.
        ...(has("inventory") && businessType === "pharmacy"
          ? [{ name: "Pharmacy", path: "/tenant/pharmacy" }]
          : []),
        // A tyre or auto shop's real customer key: the plate, what the car
        // takes, and what was fitted last time. Only the trades that work on
        // vehicles — a grocery would never open it twice. A vehicle IS
        // customer data, so it carries the CRM permission.
        ...(has("products") && (businessType === "automotive" || businessType === "petroleum")
          ? [{ name: "Vehicles", path: "/tenant/vehicles" }]
          : []),
        // Serialized retail (phones/electronics) — look up a serial's warranty.
        // Retail-only: a grocery or pharmacy never sells a serial-tracked unit.
        // A counter lookup, so it sits with the till.
        ...(has("pos") && has("inventory") && businessType === "retail"
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
    { icon: <DollarLineIcon />, name: "Subscription", path: "/tenant/subscription" },
    { icon: <BoltIcon />, name: "Settings", path: "/tenant/settings" },
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
];

/** Section roots would swallow every child route in a prefix match. */
const SECTION_ROOTS = ["/tenant", "/admin"];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered, toggleSidebar } = useSidebar();
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
    ? adminMainItems
    : shopNav(features, businessType, mode, multiBranch, can);
  // Second group: platform config for admins; unused on the shop side.
  const othersItems: NavItem[] = isAdmin ? adminPlatformItems : [];

  // Labels show when the rail is pinned open, peeked on hover, or drawn over
  // the page on mobile — the one condition that drives every layout choice.
  const showLabels = isExpanded || isHovered || isMobileOpen;

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
    <aside
      className={`fixed left-0 top-0 z-50 mt-16 flex h-[calc(100dvh-4rem)] flex-col border-r text-gray-900 transition-all duration-300 ease-in-out lg:mt-0 lg:h-dvh ${railClass}
        ${showLabels ? "w-[290px]" : "w-[90px]"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pinned header: wordmark, plus the collapse toggle from the reference. */}
      <div
        className={`flex shrink-0 items-center gap-2 px-5 py-6 ${
          showLabels ? "justify-between" : "lg:justify-center"
        }`}
      >
        <Link to={homeForRole(role)} className="flex items-center">
          {showLabels ? (
            <>
              <img
                className="dark:hidden"
                src="/images/logo/logo.svg"
                alt="Logo"
                width={150}
                height={40}
              />
              <img
                className="hidden dark:block"
                src="/images/logo/logo-dark.svg"
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <img
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
        {showLabels && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200 lg:flex"
          >
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
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
                  ? "Daily essentials only. Switch to Full view for every module."
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
