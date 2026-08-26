import { useCallback } from "react";
import { useSearchParams } from "react-router";

/** What a filter can be worth in a URL. `false`, `""`, `null` and `undefined`
 *  all mean "not set", and clear the parameter. */
export type FilterValue = string | number | boolean | null | undefined;

/**
 * FILTERS THAT LIVE IN THE URL, AND THE ONE RULE ABOUT PAGE.
 *
 * A filtered list is a thing people send each other — "look at these four" —
 * so its state belongs in the address bar, where a bookmark, a link and the
 * back button can all reach it. That part is easy. The part that is not is a
 * single rule with a single exception:
 *
 *     changing a FILTER resets to page one — page 4 of a different filter is
 *     a page that usually does not exist
 *     …unless the thing being changed IS the page.
 *
 * ── Why this is a shared hook and not five lines per screen ────────────
 *
 * It was five lines per screen, twice, and the second copy got it wrong: the
 * admin tenant list cleared `page` on EVERY change, so it also cleared the
 * page the pager had just set. Next and Previous did nothing — the URL was
 * rewritten to what it already was and the list redrew itself identically. The
 * marketplace's copy, written weeks earlier, had the missing line.
 *
 * Two implementations of one rule, and the newer one lacking the fix the older
 * one already carried, is the shape this codebase keeps meeting. So there is
 * one implementation, and it is tested where a screen cannot hide it.
 */
export function useUrlFilters(): {
  params: URLSearchParams;
  get: (key: string) => string;
  /** Change one or more FILTERS. Resets to page one unless `page` is among
   *  them — see the note above. */
  patch: (changes: Record<string, FilterValue>) => void;
  /** Turn the page, keeping every filter. */
  goToPage: (page: number) => void;
  /** Drop everything, optionally keeping a few keys (a search term usually). */
  clearAll: (keep?: string[]) => void;
} {
  const [params, setParams] = useSearchParams();

  const patch = useCallback(
    (changes: Record<string, FilterValue>) => {
      setParams((current) => nextParams(current, changes));
    },
    [setParams],
  );

  const goToPage = useCallback(
    (page: number) => {
      // Page one is the ABSENCE of the parameter, so a URL is never carrying
      // `page=1` for no reason and two links to the same first page are the
      // same link.
      setParams((current) => nextParams(current, { page: page <= 1 ? null : page }));
    },
    [setParams],
  );

  const clearAll = useCallback(
    (keep: string[] = []) => {
      setParams((current) => {
        const next = new URLSearchParams();
        for (const key of keep) {
          const value = current.get(key);
          if (value !== null && value !== "") next.set(key, value);
        }

        return next;
      });
    },
    [setParams],
  );

  return {
    params,
    get: (key: string) => params.get(key) ?? "",
    patch,
    goToPage,
    clearAll,
  };
}

/**
 * The whole rule, as a pure function, so it can be tested without a router.
 *
 * Exported for that test and for callers that already hold their own
 * URLSearchParams (the marketplace builds one from a typed filter object).
 */
export function nextParams(
  current: URLSearchParams,
  changes: Record<string, FilterValue>,
): URLSearchParams {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === null || value === "" || value === false) next.delete(key);
    else next.set(key, value === true ? "1" : String(value));
  }

  // THE EXCEPTION. Clearing `page` here unconditionally is what broke the
  // pager: it dropped the page the caller had just asked for.
  if (!("page" in changes)) next.delete("page");

  return next;
}
