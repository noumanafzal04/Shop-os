import type { Query } from "@tanstack/react-query";

/**
 * WHAT IS KEPT ON THE PHONE BETWEEN LAUNCHES — and what never is.
 *
 * "Data cache kro home page py… jb app open hojaye": the home screen opened
 * on skeletons every time, because the cache lived in memory and died with
 * the app. Now the public catalogue is written to the phone, so a launch
 * draws the last home it saw at once and quietly asks for a fresh one.
 *
 * ONLY what any visitor would see anyway: the home feed, the trades, shop
 * lists, a shop and its menu, the service area. Nothing about the person —
 * addresses, orders, favourites, the account — is ever written down here;
 * a shared or sold phone must not keep somebody else's life in a cache file.
 */
const PUBLIC = new Set(["home", "categories", "shops", "shop", "menu", "products", "service-area"]);

export function isKeptOnPhone(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === "market" && typeof queryKey[1] === "string" && PUBLIC.has(queryKey[1]);
}

/** Only answers that SUCCEEDED — a stored error is a broken screen next launch. */
export function shouldKeep(query: Pick<Query, "queryKey" | "state">): boolean {
  return query.state.status === "success" && isKeptOnPhone(query.queryKey);
}

/** A day: a shop list older than that is more likely wrong than useful. */
export const KEEP_FOR_MS = 24 * 60 * 60 * 1000;

/** The cache file's name; a new app version starts a new one (`buster`). */
export const CACHE_KEY = "query-cache";
