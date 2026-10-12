import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  BoltIcon,
  BoxCubeIcon,
  BoxIcon,
  ChatIcon,
  ChevronDownIcon,
  DollarLineIcon,
  FileIcon,
  GearIcon,
  GridIcon,
  GroupIcon,
  InfoIcon,
  ListIcon,
  PaperPlaneIcon,
  PieChartIcon,
  TaskIcon,
  UserCircleIcon,
  UserIcon,
} from "../icons";
import { BrandMark, Wordmark } from "../components/brand/Brand";
import { useSidebar } from "../context/SidebarContext";
import { useUiMode } from "../context/UiModeContext";
import { useShopSettings } from "../modules/shop/hooks/useShop";
import { hasSecondPlace, mayHaveMorePlaces } from "../modules/branches/places";
import { useAuthStore } from "../stores/authStore";
import { homeForRole } from "../common/routing/guards";
import { canVisitAdmin } from "../common/routing/adminScreenPermissions";
import { useAdminInbox } from "../modules/admin/hooks/useAdmin";
import { useOrdersWaiting } from "../modules/orders/hooks/useOrders";
import { ORDERS_PATH, withOrdersWaiting } from "./ordersWaiting";
import { usePrimaryBusinessType } from "../common/tenant/businessType";
import { kindOfBusiness } from "../common/tenant/kindOfBusiness";
import { DEFAULT_SIDEBAR } from "../common/theme/tenantTheme";
import type { NavItem } from "./navItem";
import { SHOP, shopMenuInFull, shopNav } from "./shopNav";
import { useSimpleChoice } from "./simpleMenuStore";
import SimpleMenuDialog from "./SimpleMenuDialog";

// The admin rail's tests name a row by this type.
export type { NavItem } from "./navItem";

// Admin nav is split into two groups for a clean, scannable sidebar:
// day-to-day platform operations first, then the configuration and oversight
// the owner touches less often (separated by a hairline, not a heading).
const adminMainItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/admin" },
  { icon: <GroupIcon />, name: "Tenants", path: "/admin/tenants" },
  // NOT GroupIcon. It was the same glyph as Tenants directly above it, which
  // is the collision this rail has already been swept for once: two rows
  // wearing one icon is a rail you have to read word by word.
  // "Demo shops", not "Shop requests": the screen is every demo now — the
  // ones being tried as well as the ones that asked to stay. The badge is
  // still only the people WAITING, and the path has not moved.
  { icon: <TaskIcon />, name: "Demo shops", path: "/admin/shop-requests" },
  { icon: <PaperPlaneIcon />, name: "Enquiries", path: "/admin/enquiries" },
  { icon: <ListIcon />, name: "Plans", path: "/admin/plans" },
  // Riders waiting to be approved. On the MAIN rail rather than under
  // Platform, because it is a queue with people in it — the same shape as
  // Shop requests two rows up — and a queue nobody sees is a queue nobody
  // works.
  // A PACKAGE, not a person. `UserCircleIcon` is Platform Staff four rows
  // down, and two rows wearing one glyph is a rail you have to read word by
  // word — the collision this list was already swept for once.
  { icon: <BoxIcon />, name: "Riders", path: "/admin/riders" },
  { icon: <DollarLineIcon />, name: "Billing & Payments", path: "/admin/payments" },
  // Beside Billing, because both are money — and NOT merged into it, because
  // they are different debts. A plan is what a shop pays for the software;
  // commission is a share of what the marketplace sold for them.
  { icon: <PieChartIcon />, name: "Commission", path: "/admin/commission" },
];

const adminPlatformItems: NavItem[] = [
  { icon: <BoltIcon />, name: "Configuration", path: "/admin/config" },
  { icon: <BoxCubeIcon />, name: "Banners / Ads", path: "/admin/banners" },
  { icon: <ChatIcon />, name: "Announcements", path: "/admin/announcements" },
  // A PERSON WHO SHOPS, as against Platform Staff below — different glyph on
  // purpose, since two rows wearing one icon is the collision this rail has
  // already been swept for twice.
  { icon: <UserIcon />, name: "Customers", path: "/admin/customers" },
  { icon: <UserCircleIcon />, name: "Platform Staff", path: "/admin/staff" },
  { icon: <FileIcon />, name: "Audit Log", path: "/admin/audit-logs" },
  { icon: <InfoIcon />, name: "Help Centre", path: "/admin/help" },
  // The QA walkthrough. On the admin rail and nowhere else: it is written for
  // whoever tests the product, and a shopkeeper has no use for a list of the
  // parts their shop was not given.
  { icon: <TaskIcon />, name: "QA walkthrough", path: "/admin/qa" },
];

/**
 * The admin rail this person is actually offered. The rule itself lives in
 * adminScreenPermissions — the dashboard's Quick Actions offer the same nine
 * screens, and two lists of one rule is how they drift apart.
 *
 * `waiting` badges the two queues that hold a person. It is applied AFTER the
 * permission filter on purpose: a count belongs to a screen somebody can open,
 * and the server withholds the number from anyone who cannot — see
 * InboxController, which returns an absent key rather than a zero.
 */
export function adminNav(
  items: NavItem[],
  isSuperAdmin: boolean,
  permissions: string[] | undefined,
  waiting?: { shop_requests?: number; enquiries?: number },
): NavItem[] {
  const badges: Record<string, number | undefined> = {
    "/admin/shop-requests": waiting?.shop_requests,
    "/admin/enquiries": waiting?.enquiries,
  };

  return items
    .filter((item) => !item.path || canVisitAdmin(item.path, isSuperAdmin, permissions))
    .map((item) => (item.path && badges[item.path] ? { ...item, badge: badges[item.path] } : item));
}

/** Section roots would swallow every child route in a prefix match. */
const SECTION_ROOTS = ["/tenant", "/admin"];

/**
 * WHAT DECIDES A MENU — gathered once, for everything that draws one.
 *
 * The rail read these inline. Then the header's search wanted to offer the
 * shop's screens too, and the same six lines written a second time is how
 * two menus come to disagree about the same cashier.
 */
function useNavInputs() {
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
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
  // The places screens show when stock could be anywhere but the one shop:
  // a second branch, or a warehouse behind the only one. See `places.ts`.
  // Two questions, and they are not the same one. May another place be ADDED
  // (or is there already more than one to look after) — which is who gets the
  // Branches & warehouses screen. And is there a second place TODAY — which is
  // the only time the screens about what each place holds are worth showing.
  const secondPlace = hasSecondPlace(shopSettings.data);
  const multiBranch = mayHaveMorePlaces(shopSettings.data) || secondPlace;

  return { role, userId, features, businessType, permissions, can, mode, toggleMode, multiBranch, secondPlace };
}

/**
 * The shop's own menu, for whatever else offers its screens. Search does.
 *
 * In full, whatever the rail is set to: a person who keeps the short menu
 * and types "stocktake" is asking for a screen they have, not one the rail
 * happens to be showing.
 */
export function useShopNav(): NavItem[] {
  const { role, features, businessType, can, multiBranch, secondPlace } = useNavInputs();
  const isShop = role === "shop_owner" || role === "staff";

  return useMemo(
    () => (isShop ? shopNav(features, businessType, "advanced", multiBranch, can, undefined, secondPlace) : []),
    [isShop, features, businessType, multiBranch, can, secondPlace],
  );
}

const AppSidebar: React.FC = () => {
  const {
    isExpanded, isMobileOpen, railWide, setIsHovered, closeMobileSidebar,
    isPeekHeld, holdPeek, releasePeek,
  } = useSidebar();
  const location = useLocation();
  const { role, userId, features, businessType, permissions, can, mode, toggleMode, multiBranch, secondPlace } = useNavInputs();
  // What to call it — see kindOfBusiness.
  const kind = kindOfBusiness(features);
  const isAdmin = role === "super_admin" || role === "admin_staff";
  // What this person has put on their own Simple view, and the screen that
  // lets them. The dialog is given the menu IN FULL — a row has to be listed
  // to be switched on.
  const [mine, setMine] = useSimpleChoice(userId);
  const [choosing, setChoosing] = useState(false);
  const menuInFull = useMemo(
    () => (isAdmin ? [] : shopMenuInFull(features, businessType, multiBranch, can, secondPlace)),
    [isAdmin, features, businessType, multiBranch, can, secondPlace],
  );
  // Only asked for on the platform side, and only then — the shop rail has no
  // use for it and an enabled:false query is how a hook stays a hook.
  const inbox = useAdminInbox(isAdmin);
  const shopItems = isAdmin ? [] : shopNav(features, businessType, mode, multiBranch, can, mine, secondPlace);
  // The count beside Orders — asked only by a rail that HAS that row, so a
  // shop that takes no orders, or a person who may not work them, asks nothing.
  const waiting = useOrdersWaiting(shopItems.some((item) => item.path === ORDERS_PATH));
  const navItems = isAdmin
    ? adminNav(adminMainItems, role === "super_admin", permissions, inbox.data)
    : withOrdersWaiting(shopItems, waiting.data);
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
    // …and so does a rail a tap was holding open.
    releasePeek();
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
    // No attribute yet means nobody has been asked — the platform console,
    // which has no Appearance at all, is always here. That is the default.
    () => (typeof document !== "undefined" ? document.documentElement.dataset.sidebar : undefined) ?? DEFAULT_SIDEBAR,
  );
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setSidebarStyle(el.dataset.sidebar ?? DEFAULT_SIDEBAR);
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

  // AN OPENED GROUP IS BROUGHT INTO VIEW.
  //
  // The rail is as tall as the window and the menu is often taller. Opening a
  // group near the bottom grew it downwards, out of sight — the row turned its
  // chevron over and, as far as anyone could see, nothing else happened.
  useEffect(() => {
    if (openSubmenu === null) return;
    // After the drawer has finished growing: its height is what has to fit.
    const t = window.setTimeout(() => {
      document
        .querySelector(`[data-rail-group="${openSubmenu.type}-${openSubmenu.index}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 320);

    return () => window.clearTimeout(t);
  }, [openSubmenu]);

  // On a phone the rail is a drawer drawn above everything, the dialog
  // included — so it steps aside for the thing it just opened.
  const openChooser = () => {
    closeMobileSidebar();
    setChoosing(true);
  };

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    // ON A RAIL OF ICONS, A GROUP HAS NOWHERE TO OPEN.
    //
    // Its screens are only drawn when the labels are, so on a collapsed rail
    // this toggled a list nobody could see: a mouse never noticed, because
    // hovering had already widened the rail, and a tablet met a button that
    // did nothing. Touching a group now opens the rail to show it.
    if (!showLabels) {
      holdPeek();
      setOpenSubmenu({ type: menuType, index });

      return;
    }

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
        // A new part of the rail starts here. Said in words when there is
        // room for words; a hairline on a rail of icons, where a heading
        // would be three letters and an ellipsis.
        const opens = nav.section !== undefined && nav.section !== items[index - 1]?.section;

        return (
          // By where it goes, not what it is called: a group shortened to
          // one screen takes that screen's name, and HR has a "Reports" too.
          <li key={nav.path ?? nav.name} data-rail-group={nav.subItems ? `${menuType}-${index}` : undefined}>
            {opens && (showLabels ? (
              <p className={`rail-heading px-3 pb-1.5 text-[11px] font-semibold uppercase leading-5 tracking-wider text-gray-400 dark:text-gray-500 ${index === 0 ? "" : "pt-4"}`}>
                {/* The third part of the rail is the business itself. Called
                    "Your shop" for everything that is one, and not for an
                    office that only keeps its books here. */}
                {nav.section === SHOP ? `Your ${kind.noun}` : nav.section}
              </p>
            ) : (
              index > 0 && <div className="rail-rule mx-4 my-2 border-t border-gray-200 dark:border-white/10" aria-hidden />
            ))}
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
                    className={`menu-item-icon-size relative ${
                      isActive(nav.path)
                        ? "menu-item-icon-active"
                        : "menu-item-icon-inactive"
                    }`}
                  >
                    {nav.icon}
                    {/* On a COLLAPSED rail the number has nowhere to sit, so
                        the icon carries a dot. Losing the count is fine;
                        losing the fact that somebody is waiting is not. */}
                    {!showLabels && (nav.badge ?? 0) > 0 && (
                      <span
                        // Named here too: on a rail of icons this dot is all there is.
                        role="img"
                        aria-label={nav.badgeSays ?? `${nav.badge} waiting`}
                        className={`rail-count absolute -right-1 -top-0.5 size-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-gray-900 ${nav.alert ? "rail-alert" : ""}`}
                      >
                        {nav.alert && <span aria-hidden="true" className="rail-blink absolute inset-0 rounded-full motion-safe:animate-ping" />}
                      </span>
                    )}
                  </span>
                  {showLabels && <span className="menu-item-text truncate">{nav.name}</span>}
                  {showLabels && (nav.badge ?? 0) > 0 && (
                    <span className="relative ml-auto grid shrink-0 place-items-center">
                      {/* THE BLINK — a ring that spreads from the count and
                          fades, as the bell's does. Only for something NEW,
                          and never for a reader who asked for no motion. */}
                      {nav.alert && <span aria-hidden="true" className="rail-blink absolute inset-0 rounded-full motion-safe:animate-ping" />}
                      <span
                        data-testid={nav.path === ORDERS_PATH ? "orders-waiting" : undefined}
                        data-alert={nav.alert ? "" : undefined}
                        className={`rail-count relative grid min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold tabular-nums text-white ${nav.alert ? "rail-alert" : ""}`}
                        aria-label={nav.badgeSays ?? `${nav.badge} waiting`}
                      >
                        {(nav.badge ?? 0) > 99 ? "99+" : nav.badge}
                      </span>
                    </span>
                  )}
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
                <ul className="rail-guide ml-6 space-y-0.5 overflow-hidden border-l border-gray-200 pl-3 dark:border-white/15">
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
  //
  // "primary" is the shop's own colour, edge to edge. It carries `dark` too —
  // white writing is what a coloured ground needs — and `rail-primary`, whose
  // rules in index.css repaint the handful of things that would otherwise be
  // brand-on-brand. The ground itself comes from that class, not from here.
  const railClass =
    sidebarStyle === "primary"
      ? "dark rail-primary"
      : sidebarStyle === "dark"
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
    <>
    {/* A peek held by a tap is let go by the next tap anywhere else. Clear,
        not dimmed: nothing has been taken away from the page, and at `lg`
        only — below it the rail is a drawer and Backdrop is its scrim. */}
    {isPeekHeld && (
      <div className="fixed inset-0 z-40 hidden lg:block" onClick={releasePeek} aria-hidden />
    )}
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
          {showLabels ? <Wordmark tone={sidebarStyle === "primary" ? "onBrand" : "auto"} /> : <BrandMark />}
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
          long module list stays reachable at any viewport height.
       *
       * `rail-scroll`, and what it is for:
       *
       *     "jb menu open kr, right side black vertical line ati jo proper
       *      show ni hoti"
       *
       * Opening a group makes the list longer than the rail, and a scroller
       * appears down its right edge. On a dark rail its thumb was `gray-700`
       * — and the PRIMARY rail carries `dark` too, so on a rail painted in
       * the shop's own colour the thumb was a near-black stripe that came
       * and went with every submenu. The guide line beside an open group was
       * `gray-800`, for the same reason.
       *
       * The scroller now shows only while the rail is being used, in a
       * colour that belongs to the ground it is on. See index.css. */}
      <nav className="rail-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 pb-4">
        {renderMenuItems(navItems, "main")}

        {othersItems.length > 0 && (
          <div className="rail-rule mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            {showLabels && (
              <p className="rail-heading mb-2 px-3 text-[11px] font-medium uppercase leading-5 tracking-wider text-gray-400 dark:text-gray-500">
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
        <div className="rail-rule shrink-0 border-t border-gray-100 px-4 py-4 dark:border-gray-800">
          {showLabels ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <p className="rail-heading text-[11px] font-medium uppercase leading-5 tracking-wider text-gray-400 dark:text-gray-500">
                  Menu view
                </p>
                {/* What is ON the Simple view is this person's to decide, and
                    the way to decide it sits beside the switch it belongs to —
                    in either view, so somebody who finds Full too long learns
                    the short one can be made to fit before they give up on it. */}
                <button
                  type="button"
                  onClick={openChooser}
                  aria-label="Choose what Simple view shows"
                  title="Choose what Simple view shows"
                  className="rail-gear -my-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
                >
                  <GearIcon className="size-5" />
                </button>
              </div>
              <div className="rail-switch flex items-center gap-1 rounded-xl border border-brand-100 bg-brand-50 p-1.5 dark:border-brand-500/25 dark:bg-brand-500/10">
                {(["basic", "advanced"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => mode !== m && toggleMode()}
                    // Which of the two is on, said to a screen reader as well:
                    // the fill was the only thing saying it, and the sentence
                    // that used to sit underneath is gone.
                    aria-pressed={mode === m}
                    className={`flex-1 rounded-lg py-2.5 text-theme-sm font-semibold transition-colors ${
                      mode === m
                        ? "rail-switch-on bg-brand-500 text-white shadow-theme-xs"
                        : "rail-switch-off text-brand-600 hover:bg-white/70 dark:text-brand-300 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {m === "basic" ? "Simple" : "Full view"}
                  </button>
                ))}
              </div>
              {/* No caption under it. There was one — "Every module this shop
                  has." / "The screens your day runs on…" — and the owner asked
                  for it gone: the two buttons already say which is which, and
                  a sentence at the foot of the rail was one more thing to read
                  past on every screen. */}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {/* On a strip of icons the gear keeps its place above the
                  switch: a tablet never hovers the rail open, so a control
                  that lived only on the wide rail was one a tablet never had. */}
              <button
                type="button"
                onClick={openChooser}
                aria-label="Choose what Simple view shows"
                title="Choose what Simple view shows"
                className="rail-gear flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
              >
                <GearIcon className="size-5" />
              </button>
              <button
                type="button"
                onClick={toggleMode}
                title={mode === "basic" ? "Switch to full view" : "Switch to simple menu"}
                className="rail-switch-off mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-colors hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-400 dark:hover:bg-brand-500/25"
              >
                {mode === "basic" ? <ListIcon className="size-5" /> : <GridIcon className="size-5" />}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
    {!isAdmin && (
      <SimpleMenuDialog
        isOpen={choosing}
        onClose={() => setChoosing(false)}
        menu={menuInFull}
        choice={mine}
        onChange={setMine}
        shopHeading={`Your ${kind.noun}`}
        showingSimple={mode === "basic"}
        onShowSimple={() => mode !== "basic" && toggleMode()}
      />
    )}
    </>
  );
};

export default AppSidebar;
