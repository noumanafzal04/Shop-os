import { failed } from "../../common/api/failed";
import { useToast } from "../../components/ui/toast";
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

/**
 * ONE FAMILY OF ICONS, DRAWN ON ONE GRID.
 *
 * These four were solid, filled glyphs — `fill-gray-500` with `fillRule`
 * paths, one of them pasted in at four decimal places — while every other icon
 * in this product is a 24-grid line drawing at stroke 1.6: the sidebar, the
 * landing page, the trade icons. So the one panel a shopkeeper opens to find
 * their own name was the one place the drawing style changed, and heavy filled
 * blobs beside light strokes read as a menu assembled from two products.
 *
 * `currentColor` throughout, so the row decides the colour and dark mode needs
 * no second copy.
 */
function MenuIcon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`h-[18px] w-[18px] shrink-0 ${className}`}
    >
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A question inside a circle — asking, not warning. */
const HELP = "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM9.6 9.4a2.4 2.4 0 1 1 3.2 2.3c-.6.25-.8.7-.8 1.2v.4M12 16.6h.01";

/** A padlock. This row changes YOUR password, so a lock says it; a shield
 *  would only say "something to do with safety". */
const LOCK = "M6.5 10.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM8.5 10.5V7.5a3.5 3.5 0 1 1 7 0v3M12 14v2";

/** Sliders. A cog drawn at 18px on a line grid turns to mush; three settled
 *  controls read instantly at any size. */
const SLIDERS = "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h7M15 17h5M15 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM7 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM11 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z";

/** Leaving through a door — the arrow points OUT. The old one pointed left,
 *  INTO the box, which is the icon for signing in. */
const SIGN_OUT = "M14 7.5V5.6A1.6 1.6 0 0 0 12.4 4H6.6A1.6 1.6 0 0 0 5 5.6v12.8A1.6 1.6 0 0 0 6.6 20h5.8a1.6 1.6 0 0 0 1.6-1.6v-1.9M20 12H9.8M20 12l-3.2-3.2M20 12l-3.2 3.2";

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function UserDropdown() {
  const toast = useToast();
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
    // A sign-out that failed and said nothing is the one worth catching: on
          // a shared till the next person is still in the last person's session.
          logout.mutate(undefined, failed(toast, "You are still signed in — try again."));
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
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`h-[18px] w-[18px] text-gray-500 transition-transform duration-200 dark:text-gray-400 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9.5 6 6 6-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
              <MenuIcon d={HELP} />
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
              <MenuIcon d={LOCK} />
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
                <MenuIcon d={SLIDERS} />
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
          <MenuIcon d={SIGN_OUT} className="text-error-500 dark:text-error-400" />
          {logout.isPending ? "Signing out…" : "Sign out"}
        </button>
      </Dropdown>
    </div>
  );
}
