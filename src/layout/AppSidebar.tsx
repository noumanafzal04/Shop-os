import { useCallback, useEffect, useRef, useState } from "react";
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
  HorizontaLDots,
  ListIcon,
  PlugInIcon,
  UserCircleIcon,
} from "../icons";
import { useSidebar } from "../context/SidebarContext";
import { useUiMode, type UiMode } from "../context/UiModeContext";
import { useShopSettings } from "../modules/shop/hooks/useShop";
import { useAuthStore } from "../stores/authStore";
import { homeForRole } from "../common/routing/guards";

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

/**
 * Tenant nav for first-time users: the five daily-use modules are direct
 * links on top; everything specialised folds into DROPDOWN parents below
 * (tap to expand — the section with the active page auto-opens). Items only
 * appear when the business has the matching feature enabled (no marketplace
 * feature → no Online Orders; no reservations feature → no Reservations).
 */
function shopNav(features: Record<string, boolean> | undefined, mode: UiMode, multiBranch: boolean): NavItem[] {
  const branchItem: NavItem = {
    icon: <BoxCubeIcon />,
    name: "Branches",
    subItems: [
      { name: "Locations", path: "/tenant/branches" },
      { name: "Transfers", path: "/tenant/transfers" },
    ],
  };
  // A capability shows only when its flag is explicitly on. Types that don't
  // offer a feature omit its key entirely (e.g. pharmacy has no `dine_in`), so
  // a missing key must read as OFF — never default to true, or a pharmacy ends
  // up with a Dine-in link.
  const has = (key: string) => features?.[key] ?? false;

  // The Expense & Income module — one home for all money in/out.
  const expenseManager = {
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
    return [
      { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
      ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
      ...(has("dine_in") ? [{ icon: <GridIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
      { icon: <DollarLineIcon />, name: "Sales", path: "/tenant/sales" },
      ...(has("marketplace") ? [{ icon: <PlugInIcon />, name: "Online Orders", path: "/tenant/orders" }] : []),
      { icon: <BoxIcon />, name: "Products", path: "/tenant/products" },
      ...(has("expenses") ? [expenseManager] : []),
      ...(multiBranch ? [branchItem] : []),
      { icon: <BoltIcon />, name: "Settings", path: "/tenant/settings" },
    ];
  }

  return [
    // ── Daily essentials ──────────────────────────────────────────
    { icon: <GridIcon />, name: "Dashboard", path: "/tenant" },
    // POS till is only for shops on a plan that includes it (not online-only).
    ...(has("pos") ? [{ icon: <DollarLineIcon />, name: "POS", path: "/tenant/pos" }] : []),
    ...(has("dine_in") ? [{ icon: <GridIcon />, name: "Dine-in", path: "/tenant/dine-in" }] : []),
    { icon: <DollarLineIcon />, name: "Sales", path: "/tenant/sales" },
    ...(has("marketplace") ? [{ icon: <PlugInIcon />, name: "Online Orders", path: "/tenant/orders" }] : []),
    ...(has("marketplace") && has("delivery") ? [{ icon: <GroupIcon />, name: "Riders", path: "/tenant/riders" }] : []),
    // Expense & Income module — one home for all money in/out.
    ...(has("expenses") ? [expenseManager] : []),
    // Multi-branch: a locations manager appears only when the plan allows >1.
    ...(multiBranch ? [branchItem] : []),

    // ── Grouped dropdowns ─────────────────────────────────────────
    {
      icon: <BoxIcon />,
      name: "Catalog",
      subItems: [
        { name: "Products & Services", path: "/tenant/products" },
        { name: "Categories", path: "/tenant/categories" },
        { name: "Collections", path: "/tenant/collections" },
      ],
    },
    ...(has("inventory")
      ? [
          {
            icon: <BoxCubeIcon />,
            name: "Inventory",
            subItems: [
              { name: "Stock", path: "/tenant/inventory" },
              { name: "Barcode Labels", path: "/tenant/labels" },
              { name: "Suppliers", path: "/tenant/suppliers" },
              { name: "Purchases", path: "/tenant/purchases" },
            ],
          },
        ]
      : []),
    {
      icon: <GroupIcon />,
      name: "Customers",
      subItems: [
        { name: "Customer List", path: "/tenant/customers" },
        { name: "Coupons", path: "/tenant/coupons" },
        ...(has("marketplace") ? [{ name: "Reviews", path: "/tenant/reviews" }] : []),
        ...(has("reservations") ? [{ name: "Reservations", path: "/tenant/reservations" }] : []),
      ],
    },
    {
      icon: <BoltIcon />,
      name: "More",
      subItems: [
        { name: "Reports", path: "/tenant/reports" },
        { name: "Staff", path: "/tenant/staff" },
        // Serialized retail (phones/electronics) — look up a serial's warranty.
        ...(has("pos") ? [{ name: "Warranty lookup", path: "/tenant/warranty" }] : []),
        ...(has("services") ? [{ name: "Portfolio", path: "/tenant/portfolio" }] : []),
      ],
    },

    // Settings + subscription stand alone at the bottom — one click away.
    { icon: <DollarLineIcon />, name: "Subscription", path: "/tenant/subscription" },
    { icon: <BoltIcon />, name: "Settings", path: "/tenant/settings" },
  ];
}

// Admin nav is split into two labelled groups for a clean, scannable sidebar:
// "Manage" = the day-to-day platform operations, "Platform" = configuration
// and oversight the owner touches less often.
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


const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const features = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );

  const { mode, toggleMode } = useUiMode();
  const shopSettings = useShopSettings();
  // Multi-branch UI shows only when the plan allows more than one branch
  // (max_branches null = unlimited → true; 1 → false).
  const multiBranch = shopSettings.data ? shopSettings.data.max_branches !== 1 : false;
  const isAdmin = role === "super_admin" || role === "admin_staff";
  const navItems = isAdmin ? adminMainItems : shopNav(features, mode, multiBranch);
  // Second labelled group: platform config for admins; unused on the shop side.
  const othersItems: NavItem[] = isAdmin ? adminPlatformItems : [];
  const mainLabel = isAdmin ? "Manage" : "Menu";
  const othersLabel = "Platform";

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // const isActive = (path: string) => location.pathname === path;
  const isActive = useCallback(
    (path: string) => location.pathname === path,
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

  useEffect(() => {
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu]);

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
    <ul className="flex flex-col gap-4">
      {items.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={`menu-item-icon-size  ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className="menu-item-text">{nav.name}</span>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200 ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                to={nav.path}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
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
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className="menu-item-text">{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul className="mt-2 space-y-1 ml-9">
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    <Link
                      to={subItem.path}
                      className={`menu-dropdown-item ${
                        isActive(subItem.path)
                          ? "menu-dropdown-item-active"
                          : "menu-dropdown-item-inactive"
                      }`}
                    >
                      {subItem.name}
                      <span className="flex items-center gap-1 ml-auto">
                        {subItem.new && (
                          <span
                            className={`ml-auto ${
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
                            className={`ml-auto ${
                              isActive(subItem.path)
                                ? "menu-dropdown-badge-active"
                                : "menu-dropdown-badge-inactive"
                            } menu-dropdown-badge`}
                          >
                            pro
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`py-8 flex ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link to={homeForRole(role)}>
          {isExpanded || isHovered || isMobileOpen ? (
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
      </div>
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? (
                  mainLabel
                ) : (
                  <HorizontaLDots className="size-6" />
                )}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>

            {othersItems.length > 0 && (
              <div>
                <h2
                  className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
                    !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
                  }`}
                >
                  {isExpanded || isHovered || isMobileOpen ? (
                    othersLabel
                  ) : (
                    <HorizontaLDots className="size-6" />
                  )}
                </h2>
                {renderMenuItems(othersItems, "others")}
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Basic / Advanced view toggle — shop side only. Basic trims the menu to
          the essentials; Full reveals every module. Remembered per device. */}
      {!isAdmin && (
        <div className="mt-auto border-t border-gray-100 py-4 dark:border-gray-800">
          {isExpanded || isHovered || isMobileOpen ? (
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              {(["basic", "advanced"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => mode !== m && toggleMode()}
                  className={`flex-1 rounded-md py-1.5 text-theme-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-white text-gray-800 shadow-theme-xs dark:bg-gray-900 dark:text-white/90"
                      : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  }`}
                >
                  {m === "basic" ? "Simple" : "Full menu"}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleMode}
              title={mode === "basic" ? "Switch to full menu" : "Switch to simple menu"}
              className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
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
