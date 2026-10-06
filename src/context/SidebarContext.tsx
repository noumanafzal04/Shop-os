import { createContext, useContext, useState, useEffect } from "react";
import { lockScroll, unlockScroll } from "../layout/scrollLock";

/**
 * ONE width decides what the sidebar is.
 *
 * ── The bug this constant exists to end ─────────────────────────────────
 *
 * The same question — "is the rail pinned, or is it a drawer?" — was being
 * answered in three places at three different widths:
 *
 *   this file          `window.innerWidth < 768`
 *   AppHeader's toggle `window.innerWidth >= 1024`
 *   every class in the sidebar and the layout   `lg:` = 1024
 *
 * Between 768 and 1023 the answers disagreed, and that band is not an
 * academic edge — it is a TABLET HELD UPRIGHT. An iPad is 820 wide in
 * portrait, an iPad Pro 834, a 10.2" 810. Every one of them landed in the gap
 * where the JavaScript believed it was a desktop and the CSS knew it wasn't.
 *
 * What the shop actually saw: the rail was off-canvas (CSS said drawer) while
 * the state said "expanded desktop", and `handleResize` force-closed the
 * drawer on every resize event — which on a tablet browser fires when the
 * address bar slides away, i.e. the moment you scroll. Open the menu, scroll,
 * it shuts.
 *
 * 1024 is not a preference. It is the number already compiled into the
 * stylesheet, and this file now reads it rather than guessing at it.
 */
export const DRAWER_BELOW = 1024;

/**
 * Below this, the pinned rail starts COLLAPSED.
 *
 * A tablet in landscape is 1024–1194. The rail is pinned there and takes 290
 * of it, leaving ~734px of page — phone width, on a screen the shop thinks of
 * as large. The icon rail gives 200 of those pixels back, and the expand
 * toggle is right there for anyone who wants the labels. Initial value only:
 * once the user has an opinion, resizing never overrules it.
 */
const RAIL_STARTS_COLLAPSED_BELOW = 1280;

const viewportWidth = () => (typeof window === "undefined" ? DRAWER_BELOW : window.innerWidth);

type SidebarContextType = {
  isExpanded: boolean;
  isMobileOpen: boolean;
  isHovered: boolean;
  /**
   * Is the rail showing its LABELS — i.e. is it 290px rather than 90px?
   *
   * One value, because it was two. The sidebar sized itself from
   * `isExpanded || isHovered || isMobileOpen` and the layout stepped aside by
   * `isExpanded || isHovered` — the same question, asked with one term of
   * difference. Whenever `isMobileOpen` was true at `lg` or wider, the rail
   * drew at 290 while the page moved 90, and the dashboard ran underneath the
   * sidebar. The shop found it by turning a tablet upright.
   *
   * Every width decision now reads this. The two cannot disagree, in any
   * combination of states or during any transition between them.
   */
  railWide: boolean;
  /**
   * The rail was opened by a TAP, on a rail that is otherwise icons.
   *
   * Hover-to-peek is for a mouse. A tablet has none, so on a collapsed rail a
   * group's icon — Expense Manager, Catalog, anything with screens under it —
   * did nothing at all when touched: it toggled a submenu that only draws
   * when the labels are showing. This is the same peek, held open by a tap
   * and let go by the next tap anywhere else or by going somewhere.
   */
  isPeekHeld: boolean;
  holdPeek: () => void;
  releasePeek: () => void;
  /**
   * A work screen's rail: icons only, never pinned wide.
   *
   * The floor, the tab and the kitchen board keep the whole width for the
   * work and still show where everything else is. See WorkScreenLayout.
   */
  iconsOnly: boolean;
  activeItem: string | null;
  openSubmenu: string | null;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  setIsHovered: (isHovered: boolean) => void;
  setActiveItem: (item: string | null) => void;
  toggleSubmenu: (item: string) => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

/** Null outside a shell — for a control that may be drawn with or without one. */
export const useSidebarIfAny = () => useContext(SidebarContext) ?? null;

export const SidebarProvider: React.FC<{ children: React.ReactNode; iconsOnly?: boolean }> = ({
  children,
  iconsOnly = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(
    () => !iconsOnly && viewportWidth() >= RAIL_STARTS_COLLAPSED_BELOW,
  );
  const [isPeekHeld, setIsPeekHeld] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => viewportWidth() < DRAWER_BELOW);
  const [isHovered, setIsHovered] = useState(false);
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  useEffect(() => {
    const handleResize = () => {
      const drawer = window.innerWidth < DRAWER_BELOW;
      setIsMobile(drawer);
      // Only a real crossing INTO pinned territory closes the drawer. The old
      // code closed it on every resize while still in drawer territory, which
      // on a tablet meant the menu shut itself the moment the address bar
      // moved. A drawer the user opened stays open until the user, a tap on
      // the scrim, or a navigation closes it.
      if (!drawer) {
        setIsMobileOpen(false);
        setIsHovered(false);
      } else {
        // A held peek belongs to the pinned rail. Below `lg` the rail is a
        // drawer with a scrim of its own, and a peek left held would widen it
        // the moment it next opened.
        setIsPeekHeld(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  /**
   * THE PAGE BEHIND THE DRAWER HOLDS STILL.
   *
   * It did not. Measured in WebKit with the menu open: at 810 and at 390 the
   * page behind scrolled a full 400px and `document.body`'s overflow was
   * `visible`. A modal locked the page and a drawer did not, which is the
   * same overlay problem answered twice and only once.
   */
  useEffect(() => {
    if (!isMobileOpen) return;
    lockScroll();
    return unlockScroll;
  }, [isMobileOpen]);

  const toggleSidebar = () => {
    // A work screen's rail is never pinned wide: the toggle holds it open
    // over the page instead of taking the page's width away.
    if (iconsOnly) {
      setIsPeekHeld((prev) => !prev);

      return;
    }
    setIsExpanded((prev) => !prev);
  };

  const toggleMobileSidebar = () => {
    setIsMobileOpen((prev) => !prev);
  };

  const closeMobileSidebar = () => {
    setIsMobileOpen(false);
  };

  const toggleSubmenu = (item: string) => {
    setOpenSubmenu((prev) => (prev === item ? null : item));
  };

  return (
    <SidebarContext.Provider
      value={{
        isExpanded: isMobile ? false : isExpanded,
        isMobileOpen,
        isHovered,
        railWide: (isMobile ? false : isExpanded) || isHovered || isPeekHeld || isMobileOpen,
        isPeekHeld,
        holdPeek: () => setIsPeekHeld(true),
        releasePeek: () => setIsPeekHeld(false),
        iconsOnly,
        activeItem,
        openSubmenu,
        toggleSidebar,
        toggleMobileSidebar,
        closeMobileSidebar,
        setIsHovered,
        setActiveItem,
        toggleSubmenu,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};
