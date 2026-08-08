import { ApiError } from "../types/api";

/**
 * Was this query REFUSED, or did it just find nothing?
 *
 * The two look identical once a screen renders `data ?? []`, and that is how a
 * permission bug arrives disguised as a data bug: a real cashier spent an
 * evening believing the shop had no products, because the till drew an empty
 * grid rather than saying it had been refused.
 *
 * Anything rendering a list from a query should ask this before falling back
 * to its own empty state, and render <NoAccess> when the answer is not null.
 */
export type DeniedReason = "permission" | "module" | null;

export function deniedReason(error: unknown): DeniedReason {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 403) return null;

  return error.errorCode === "MODULE_DISABLED" ? "module" : "permission";
}
