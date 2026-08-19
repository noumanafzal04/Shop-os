import { useState } from "react";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { DropdownItem } from "../ui/dropdown/DropdownItem";
import { useAuthStore } from "../../stores/authStore";
import { useLogout } from "../../modules/auth/hooks/useAuth";
import type { UserRole } from "../../modules/auth/types";

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin_staff: "Admin Staff",
  shop_owner: "Owner",
  staff: "Staff",
  customer: "Customer",
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useLogout();

  const closeDropdown = () => setIsOpen(false);
  // Tenant-side users get a shortcut to shop settings; admins don't have one.
  const isTenantSide = user?.role === "shop_owner" || user?.role === "staff";
  // Your own password and the Help Centre live on both consoles at the same
  // path segment.
  const securityPath = isTenantSide ? "/tenant/security" : "/admin/security";
  const helpPath = isTenantSide ? "/tenant/help" : "/admin/help";

  const signOut = () => {
    closeDropdown();
    logout.mutate();
  };

  if (!user) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center text-gray-700 dropdown-toggle dark:text-gray-400"
      >
        <span className="mr-3 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-brand-500 text-sm font-semibold text-white">
          {initials(user.name) || "U"}
        </span>
        {/* The avatar carries the identity; the name is the courtesy.
         *
         * On a phone this cost the header 120px it did not have, and the whole
         * page scrolled sideways — 425px of content in a 390px window — which
         * on a dashboard means the right-hand edge of every card is off the
         * screen with no scrollbar to say so.
         *
         * The initials are still there, and the name is the first line of the
         * panel this button opens. Same fault the till's header had, in a
         * different file: a group that cannot shrink on a device with nothing
         * to spare. */}
        <span className="mr-1 hidden max-w-[120px] truncate font-medium text-theme-sm sm:block">
          {user.name}
        </span>
        <svg
          className={`stroke-gray-500 dark:stroke-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          width="18"
          height="20"
          viewBox="0 0 18 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M4.3125 8.65625L9 13.3437L13.6875 8.65625"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        className="absolute right-0 mt-[17px] flex w-[260px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
      >
        <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
          <span className="block font-medium text-gray-700 text-theme-sm dark:text-gray-400">
            {user.name}
          </span>
          <span className="mt-0.5 block truncate text-theme-xs text-gray-500 dark:text-gray-400">
            {user.email ?? user.phone ?? ROLE_LABELS[user.role]}
          </span>
          <span className="mt-2 inline-block rounded-full bg-brand-50 px-2 py-0.5 text-theme-xs font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            {ROLE_LABELS[user.role]}
          </span>
        </div>

        <ul className="flex flex-col gap-1 border-b border-gray-200 py-3 dark:border-gray-800">
          {/* How every module works, filtered to this shop and this person. */}
          <li>
            <DropdownItem
              onItemClick={closeDropdown}
              tag="a"
              to={helpPath}
              className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-gray-700 text-theme-sm hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <svg className="fill-gray-500 dark:fill-gray-400" width="20" height="20" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.25a2.5 2.5 0 114.02 1.98c-.64.5-1.27 1.06-1.27 1.9a.75.75 0 001.5 0c0-.1.07-.25.44-.54A4 4 0 108 9.25a.75.75 0 001.5 0zM12 17.25a1 1 0 100-2 1 1 0 000 2z"
                  fill="currentColor"
                />
              </svg>
              Help Centre
            </DropdownItem>
          </li>
          {/* Nobody could change their own password on either side: the
              endpoint and the panel's service call both existed, and no screen
              ever reached them. */}
          <li>
            <DropdownItem
              onItemClick={closeDropdown}
              tag="a"
              to={securityPath}
              className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-gray-700 text-theme-sm hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
            >
              <svg className="fill-gray-500 dark:fill-gray-400" width="20" height="20" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2a5 5 0 00-5 5v3H6.5A1.5 1.5 0 005 11.5v8A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5v-8a1.5 1.5 0 00-1.5-1.5H17V7a5 5 0 00-5-5zm3.5 8V7a3.5 3.5 0 10-7 0v3h7zm-3.5 3.75a1.25 1.25 0 00-.75 2.25v1.25a.75.75 0 001.5 0V16A1.25 1.25 0 0012 13.75z"
                  fill="currentColor"
                />
              </svg>
              Security
            </DropdownItem>
          </li>
          {isTenantSide && (
            <li>
              <DropdownItem
                onItemClick={closeDropdown}
                tag="a"
                to="/tenant/settings"
                className="flex items-center gap-3 rounded-lg px-3 py-2 font-medium text-gray-700 text-theme-sm hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
              >
                <svg className="fill-gray-500 dark:fill-gray-400" width="20" height="20" viewBox="0 0 24 24">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM10 12a2 2 0 114 0 2 2 0 01-4 0z"
                    fill="currentColor"
                  />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M10.49 2h3.02c.68 0 1.26.49 1.38 1.16l.2 1.15c.06.34.29.62.6.76.32.14.68.12.98-.06l.96-.56a1.4 1.4 0 011.77.32l1.51 2.11a1.4 1.4 0 01-.27 1.9l-.92.7c-.27.2-.42.53-.4.87.02.34.19.65.48.83l.99.61c.58.36.79 1.1.48 1.71l-1.52 2.63a1.4 1.4 0 01-1.77.6l-1.06-.42a1 1 0 00-.98.13c-.3.22-.47.57-.47.94v1.13c0 .76-.62 1.37-1.38 1.37h-3.02c-.76 0-1.38-.61-1.38-1.37v-1.13c0-.37-.17-.72-.47-.94a1 1 0 00-.98-.13l-1.06.42a1.4 1.4 0 01-1.77-.6l-1.52-2.63a1.4 1.4 0 01.48-1.71l.99-.61c.29-.18.46-.49.48-.83.02-.34-.13-.67-.4-.87l-.92-.7a1.4 1.4 0 01-.27-1.9l1.51-2.11a1.4 1.4 0 011.77-.32l.96.56c.3.18.66.2.98.06.31-.14.54-.42.6-.76l.2-1.15C9.23 2.49 9.81 2 10.49 2z"
                    fill="currentColor"
                  />
                </svg>
                Shop settings
              </DropdownItem>
            </li>
          )}
        </ul>

        <button
          onClick={signOut}
          disabled={logout.isPending}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-error-200 bg-error-50 px-3 py-2 font-medium text-error-600 text-theme-sm hover:bg-error-100 disabled:opacity-60 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400 dark:hover:bg-error-500/20"
        >
          <svg className="fill-error-500" width="20" height="20" viewBox="0 0 24 24">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M15.1007 19.247C14.6865 19.247 14.3507 18.9112 14.3507 18.497L14.3507 14.245H12.8507V18.497C12.8507 19.7396 13.8581 20.747 15.1007 20.747H18.5007C19.7434 20.747 20.7507 19.7396 20.7507 18.497L20.7507 5.49609C20.7507 4.25345 19.7433 3.24609 18.5007 3.24609H15.1007C13.8581 3.24609 12.8507 4.25345 12.8507 5.49609V9.74501L14.3507 9.74501V5.49609C14.3507 5.08188 14.6865 4.74609 15.1007 4.74609L18.5007 4.74609C18.9149 4.74609 19.2507 5.08188 19.2507 5.49609L19.2507 18.497C19.2507 18.9112 18.9149 19.247 18.5007 19.247H15.1007ZM3.25073 11.9984C3.25073 12.2144 3.34204 12.4091 3.48817 12.546L8.09483 17.1556C8.38763 17.4485 8.86251 17.4487 9.15549 17.1559C9.44848 16.8631 9.44863 16.3882 9.15583 16.0952L5.81116 12.7484L16.0007 12.7484C16.4149 12.7484 16.7507 12.4127 16.7507 11.9984C16.7507 11.5842 16.4149 11.2484 16.0007 11.2484L5.81528 11.2484L9.15585 7.90554C9.44864 7.61255 9.44847 7.13767 9.15547 6.84488C8.86248 6.55209 8.3876 6.55226 8.09481 6.84525L3.52309 11.4202C3.35673 11.5577 3.25073 11.7657 3.25073 11.9984Z"
              fill="currentColor"
            />
          </svg>
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </Dropdown>
    </div>
  );
}
