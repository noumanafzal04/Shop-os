import type { ReactNode } from "react";
import type { DeniedReason } from "../api/denied";

/**
 * "You cannot see this" — said out loud.
 *
 * The bug this exists to end: a screen asks the API for a list, the API answers
 * 403, the screen renders `data ?? []`, and the operator sees an empty table.
 * Empty and forbidden look identical, so a permission problem arrives disguised
 * as a data problem. A real cashier spent an evening believing the shop had no
 * products, because the till drew a blank grid instead of saying it had been
 * refused.
 *
 * Anything that renders a list from a query should ask `deniedReason(error)`
 * first and render this instead of its empty state.
 */

export function NoAccess({
  reason,
  what,
  children,
}: {
  reason: Exclude<DeniedReason, null>;
  /** What was being looked at, lower case: "the product list", "suppliers". */
  what: string;
  children?: ReactNode;
}) {
  const isModule = reason === "module";

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center dark:border-gray-700"
    >
      <svg
        className="h-6 w-6 text-gray-400 dark:text-gray-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
        <path d="M8 10.5V7a4 4 0 1 1 8 0v3.5" />
      </svg>

      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
        {isModule
          ? `${what} is not part of your shop's plan.`
          : `You do not have access to ${what}.`}
      </p>

      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">
        {isModule
          ? "Ask the shop owner to have this module switched on."
          : "This is a permission setting, not missing data. Ask the shop owner to add it to your account."}
      </p>

      {children}
    </div>
  );
}
