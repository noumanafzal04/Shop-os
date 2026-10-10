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

/**
 * Did this query FAIL — as opposed to being refused, or finding nothing?
 *
 * The third thing an empty list can be, and the one that was still drawn as
 * "nothing here". A refusal (403) has had its own words since the cashier who
 * thought the shop had no products. A request that was turned away for
 * another reason — the server slowing somebody down (429), an error on its
 * side, an answer that never came — fell through to the screen's own empty
 * state, and a till with every product in the shop behind a failed request
 * said "No products match."
 *
 * Returns what to tell the person, or null when the query did not fail (or
 * was refused, which `deniedReason` and <NoAccess> already say).
 */
export function loadFailure(error: unknown): string | null {
  if (error == null) return null;
  if (deniedReason(error) !== null) return null;

  // The server's own words when it gave any: "Too many requests. Please slow
  // down." is more use to a cashier than anything written here.
  if (error instanceof ApiError && error.message.trim() !== "") return error.message;

  return "The server did not answer.";
}
