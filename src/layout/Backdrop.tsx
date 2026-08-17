import { useSidebar } from "../context/SidebarContext";

const Backdrop: React.FC = () => {
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  if (!isMobileOpen) return null;

  return (
    /* Between the drawer and everything else — INCLUDING the header, which
       sits at z-99999 and would otherwise stay live and tappable beside an
       open menu. A scrim that only dims the page is not a scrim; the whole
       point is that the next tap anywhere closes the menu. */
    <div
      className="fixed inset-0 z-100001 bg-gray-900/50 lg:hidden"
      onClick={toggleMobileSidebar}
      aria-hidden
    />
  );
};

export default Backdrop;
