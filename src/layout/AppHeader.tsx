import { useEffect, useState } from "react";

import { Link, useLocation } from "react-router";
import { DRAWER_BELOW, useSidebar } from "../context/SidebarContext";
import NotificationDropdown from "../components/header/NotificationDropdown";
import UserDropdown from "../components/header/UserDropdown";
import { UpdateButton } from "../modules/offline/pwa/UpdateButton";
import CommandPalette from "../modules/search/components/CommandPalette";
import BranchSwitcher from "../modules/branches/components/BranchSwitcher";
import { Wordmark } from "../components/brand/Brand";

const AppHeader: React.FC = () => {
  const [paletteOpen, setPaletteOpen] = useState(false);

  const { isMobileOpen, toggleSidebar, toggleMobileSidebar } = useSidebar();
  // Global search backs shop-side resources only; the admin console has no
  // /search endpoint, so the palette is mounted on the tenant side alone.
  const isTenant = useLocation().pathname.startsWith("/tenant");

  // 1024 is `lg`, the width every class in the sidebar and the layout already
  // splits on. It is stated once, in SidebarContext, and read here — the three
  // copies of this number at three different values were the tablet bug.
  const handleToggle = () => {
    if (window.innerWidth >= DRAWER_BELOW) {
      toggleSidebar();
    } else {
      toggleMobileSidebar();
    }
  };


  useEffect(() => {
    if (!isTenant) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTenant]);

  return (
    /* ── One row, at every width ────────────────────────────────────────
     *
     * It used to be a flex COLUMN below `lg`: a top strip with the menu
     * toggle, and a second row holding branch, theme, notifications and the
     * account — hidden behind a three-dots button and pushed into the page
     * flow when opened. Two consequences, both worst on a tablet:
     *
     *   · At 820 or 1000px there is ample room for four icons, and all four
     *     were behind a menu anyway. The dots button is a phone's answer being
     *     given to a device that never asked the question.
     *   · Opening it GREW the header from 64px to roughly 140 — and the
     *     sidebar drawer was positioned against a hard-coded 64. That is where
     *     the overlap came from.
     *
     * Now the header is a fixed-height row that nothing can grow. The actions
     * sit inline from `sm` up; below that the overflow panel is absolutely
     * positioned, so even a phone's header keeps its height. */
    <header className="sticky top-0 z-99999 w-full border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex h-16 items-center gap-2 px-3 sm:gap-3 lg:h-[72px] lg:px-6">
          <button
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:h-11 lg:w-11 lg:border lg:border-gray-200 dark:text-gray-400 dark:hover:bg-white/5 dark:lg:border-gray-800"
            onClick={handleToggle}
            aria-label="Toggle Sidebar"
          >
            {isMobileOpen ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                  fill="currentColor"
                />
              </svg>
            ) : (
              <svg
                width="16"
                height="12"
                viewBox="0 0 16 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z"
                  fill="currentColor"
                />
              </svg>
            )}
            {/* Cross Icon */}
          </button>

          {/* The wordmark, only where the rail isn't showing one. */}
          <Link to="/" className="shrink-0 lg:hidden">
            <Wordmark />
          </Link>

          {/* Search, as an icon between `sm` and `lg`.
              The full search box is `lg`-only, which left a tablet with no
              route to it at all: ⌘K is a keyboard shortcut, and a tablet has
              no keyboard. A shop of 4,000 products cannot be asked to walk the
              menu because its screen is 900px wide. */}
          {isTenant && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search"
              title="Search or jump to…"
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 sm:flex lg:hidden dark:text-gray-400 dark:hover:bg-white/5"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.7" />
                <path d="M17 17l-3.4-3.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* `min-w-0` so this can give way.

              A flex item defaults to `min-width: auto` and refuses to shrink
              below its content, and the controls on the right are `shrink-0`
              on purpose — so nothing in the row was willing to yield. On a shop
              whose header carries one control more than the mart's, the row
              could not fit 1280 and the WHOLE PAGE scrolled sideways. A search
              box that narrows is fine; a page that scrolls sideways is not. */}
          {isTenant && (
            <div className="hidden min-w-0 lg:block">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="relative flex h-11 w-full items-center gap-3 rounded-lg border border-gray-200 bg-transparent py-2.5 pl-12 pr-3 text-sm text-gray-400 shadow-theme-xs transition-colors hover:border-brand-300 dark:border-gray-800 dark:hover:border-brand-800 xl:max-w-[430px]"
              >
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
                  <svg
                    className="fill-gray-500 dark:fill-gray-400"
                    width="20"
                    height="20"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
                      fill=""
                    />
                  </svg>
                </span>
                Search or jump to…
                <span className="ml-auto inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-[7px] py-[4.5px] text-xs -tracking-[0.2px] text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                  <span> ⌘ </span>
                  <span> K </span>
                </span>
              </button>
            </div>
          )}
        {/* Everything else lives on the right. `ml-auto` rather than
            `justify-between`, so the left group can grow without the actions
            drifting — the till taught us that one. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Inline from `sm` up. A tablet has room for all of it and always
              did; hiding it behind a menu was a phone's answer given to a
              device that never asked the question. */}
          {/* Operating-branch switcher (owners, multi-branch shops). It names
              which shelf every figure on screen belongs to, so it stays beside
              the account rather than folding away — reading a branch's stock
              while the header says nothing about which branch is the one
              mistake this control exists to prevent. It renders nothing at all
              for a single-branch shop. */}
          {isTenant && <div className="hidden sm:block"><BranchSwitcher /></div>}

          {/* A WAITING UPDATE, and only that. `place="header"` draws nothing
              while there is none — "go and look" moved into the account menu,
              where a setting somebody changes once belongs. */}
          <UpdateButton place="header" />

          {/* THE BELL STAYS. It is the only thing in this corner that ever
              needs answering, and on a phone it used to be folded behind a
              three-dots menu with the theme switch and the update check — so
              the one control with news to deliver was the hardest to reach. */}
          <NotificationDropdown />

          <UserDropdown />
        </div>
      </div>

      {isTenant && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
    </header>
  );
};

export default AppHeader;
