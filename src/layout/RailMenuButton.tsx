import { DRAWER_BELOW, useSidebarIfAny } from "../context/SidebarContext";

/**
 * The way to the menu, from a work screen's own header.
 *
 * A work screen has no app header, so nothing on it opened the drawer. Below
 * `lg` this opens it; at `lg` and up it holds the icon rail open over the
 * page, for somebody who wants to read the names.
 *
 * Draws nothing when the screen is not inside a shell at all.
 */
export default function RailMenuButton({ className = "" }: { className?: string }) {
  const sidebar = useSidebarIfAny();
  if (sidebar === null) return null;

  const open = () => {
    if (window.innerWidth >= DRAWER_BELOW) sidebar.toggleSidebar();
    else sidebar.toggleMobileSidebar();
  };

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Menu"
      title="Menu"
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/5 ${className}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
