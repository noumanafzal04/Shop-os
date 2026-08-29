import { useCallback, useState } from "react";
import { useNavigate } from "react-router";

import { Dropdown } from "../ui/dropdown/Dropdown";
import Pager from "../ui/pager";
import {
  useNotifications,
  useNotificationActions,
  type AppNotification,
} from "../../modules/notifications/hooks/useNotifications";
import { screenForLink } from "../../modules/notifications/deepLink";
import { useAuthStore } from "../../stores/authStore";

/** Relative "time ago" without pulling in a date library. */
function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

const DOT_COLOR: Record<string, string> = {
  "stock.low": "bg-warning-500",
  // Both expiry stages, which had no colour of their own and fell back to the
  // same grey as everything unrecognised. Expired stock is not neutral news.
  "stock.expiry.approaching": "bg-warning-500",
  "stock.expiry.expired": "bg-error-500",
  "reservation.created": "bg-brand-500",
  "reservation.accepted": "bg-success-500",
  "reservation.rejected": "bg-error-500",
};

export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { data } = useNotifications(page);
  const { markRead, markAllRead } = useNotificationActions();

  const notifications = data?.data ?? [];
  const unread = (data?.meta as { unread_count?: number } | undefined)?.unread_count ?? 0;

  const closeDropdown = () => setIsOpen(false);

  // Mirrors authStore.hasPermission, the same way the sidebar does it: an owner
  // holds everything, a staff member holds what they were given.
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const can = useCallback(
    (permission: string) => role === "shop_owner" || (permissions?.includes(permission) ?? false),
    [role, permissions],
  );

  /**
   * Read it, and go where it points.
   *
   * Marking read is unconditional — pressing a notification is reading it,
   * whether or not it leads anywhere. Navigation only happens when the link
   * resolves to a screen this person can actually open; see deepLink.ts for why
   * a dead destination is worse than none.
   */
  const onItem = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.id);

    const path = screenForLink(n.data?.link, can);
    if (path !== null) {
      closeDropdown();
      navigate(path);
    }
  };

  return (
    <div className="relative">
      <button
        // The unread COUNT, not just "Notifications". The orange dot is the
        // only thing that says there is something to read, and a dot is not
        // available to a reader — so the number goes in the name.
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative flex items-center justify-center text-gray-500 transition-colors bg-white border border-gray-200 rounded-full hover:text-gray-700 h-11 w-11 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={() => setIsOpen(!isOpen)}
      >
        {unread > 0 && (
          <span className="absolute right-0 top-0.5 z-10 flex h-2 w-2 rounded-full bg-orange-400">
            <span className="absolute inline-flex w-full h-full bg-orange-400 rounded-full opacity-75 animate-ping"></span>
          </span>
        )}
        <svg className="fill-current" width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        /* A PANEL THAT FITS THE SCREEN IT OPENS ON.
           This was `-right-[240px] w-[350px]`, corrected only at `lg`. On a
           390px phone that put a 350px panel 240px to the RIGHT of a bell
           already near the right edge — most of it off-screen, and what
           remained widened the document sideways.
           Below `sm` it is now a sheet pinned to both edges of the viewport
           rather than hung off the bell: `fixed`, so it is measured against
           the screen and not against a header that scrolls. Its height is a
           share of the viewport, because `h-[480px]` is taller than a small
           phone has and the list inside already scrolls. */
        className="fixed inset-x-3 top-16 flex max-h-[70dvh] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg sm:absolute sm:inset-x-auto sm:top-auto sm:mt-[17px] sm:h-[480px] sm:max-h-none sm:right-0 sm:w-[361px] dark:border-gray-800 dark:bg-gray-dark"
      >
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Notifications{unread > 0 && ` (${unread})`}
          </h5>
          {unread > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              className="text-theme-xs text-brand-500 hover:text-brand-600"
            >
              Mark all read
            </button>
          )}
        </div>

        <ul className="flex flex-col h-auto overflow-y-auto custom-scrollbar">
          {notifications.length === 0 ? (
            <li className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              You're all caught up 🎉
            </li>
          ) : (
            notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => onItem(n)}
                  // Says out loud whether this leads anywhere, so a reader who
                  // cannot see the chevron is not left guessing which of fifteen
                  // notifications is worth pressing.
                  aria-label={
                    screenForLink(n.data?.link, can) !== null
                      ? `${n.title}. ${n.body} — opens the relevant screen`
                      : undefined
                  }
                  className={`flex w-full gap-3 rounded-lg border-b border-gray-100 p-3 text-left hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5 ${
                    n.read_at ? "opacity-60" : ""
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_COLOR[n.type] ?? "bg-gray-400"}`}
                  />
                  <span className="block">
                    <span className="mb-0.5 block text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {n.title}
                    </span>
                    <span className="block text-theme-xs text-gray-500 dark:text-gray-400">
                      {n.body}
                    </span>
                    <span className="mt-1 block text-theme-xs text-gray-400">
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                  {/* Only where there is somewhere to go. A chevron on every row
                      would promise a destination the announcement rows do not
                      have. */}
                  {screenForLink(n.data?.link, can) !== null && (
                    <span aria-hidden="true" className="ml-auto self-center text-gray-400">
                      ›
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <Pager pagination={data?.meta?.pagination} onPage={setPage} noun="notifications" />
      </Dropdown>
    </div>
  );
}
