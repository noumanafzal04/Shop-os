import { createContext, useContext, useState, useEffect } from "react";

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

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(
    () => viewportWidth() >= RAIL_STARTS_COLLAPSED_BELOW,
  );
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
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const toggleSidebar = () => {
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
