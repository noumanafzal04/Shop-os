import { useState } from "react";
import { useSearchParams } from "react-router";

/**
 * Which tab a link asked for — or the page's first.
 *
 * A dashboard row saying "1 bill has fallen due" used to be able to send a
 * person only to the Expenses PAGE, where the bill is on the second tab behind
 * a badge. `?tab=recurring` lets a link land on the thing it is about. A key
 * the page does not have is ignored, so a mistyped or outdated link opens the
 * page as it always did rather than on nothing.
 */
export function tabAskedFor<K extends string>(search: URLSearchParams | string, keys: readonly K[], otherwise: K): K {
  const asked = (typeof search === "string" ? new URLSearchParams(search) : search).get("tab");

  return (keys as readonly string[]).includes(asked ?? "") ? (asked as K) : otherwise;
}

/** A page's tab, opening on the one its address named. */
export function useTabInUrl<K extends string>(keys: readonly K[], otherwise: K) {
  const [params] = useSearchParams();

  return useState<K>(() => tabAskedFor(params, keys, otherwise));
}
