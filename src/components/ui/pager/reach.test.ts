import { describe, expect, it } from "vitest";

/**
 * Rows on page two are reachable, and there is one thing that reaches them.
 *
 * ── What this is guarding against ───────────────────────────────────────
 *
 * Thirty-seven endpoints paginate. Fifteen screens had hand-written the same
 * fifteen lines of Previous/Next, and nine had written nothing — so on those
 * nine the rows past the first page could not be reached by any means the
 * product offered. Not awkwardly: **not at all.** Ten reviews a page meant a
 * shop with eleven could never read its first one.
 *
 * The copies had already drifted. Some counted "items" whatever the rows were,
 * one used `px-5` where the rest used `px-6`, one called `setPage(page - 1)`
 * and the others `setPage((p) => p - 1)`. Fifteen copies of a rule are not one
 * rule — the same argument that produced one confirm dialog.
 *
 * ── Why a source scan rather than a render ──────────────────────────────
 *
 * A lint rule wearing a test's clothes, exactly as `confirm/native.test.ts` is.
 * Rendering every page would need a router, a query client and an API; reading
 * the source answers the only question worth asking here — *did this screen
 * write its own?*
 *
 * ── What it deliberately does NOT check ─────────────────────────────────
 *
 * Whether every list HAS a pager. That needs to know which endpoints paginate,
 * which lives in the backend, and a second copy of that list here would be the
 * very fault this file exists to stop. `docs/qa/unreachable-pages.py` reads
 * both repositories and answers it; this file keeps the panel's own half true.
 */

const SOURCES = import.meta.glob("../../../{modules,components}/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * A hand-rolled pager: something that walks pages with its own buttons.
 *
 * The mark is a Previous/Next PAIR driven by the pagination meta. Either half
 * alone is innocent — "Previous month" is a date stepper on the expenses
 * screen, and `current_page` on its own is how the till knows there is more to
 * fetch.
 */
const HAND_ROLLED = (src: string): boolean =>
  /current_page|last_page/.test(src) && />\s*Previous\s*</.test(src) && />\s*Next\s*</.test(src);

/**
 * The till is not a list screen and must stay exempt.
 *
 * A cashier does not press Next through a catalog; the POS pane fetches the
 * following page as the grid is scrolled. It reads `current_page` for that and
 * renders no buttons, so the rule above already leaves it alone — this comment
 * is here so the next person to tighten the regex knows what they would break.
 */

/**
 * This file's own neighbour.
 *
 * Vite resolves the glob keys, so `../../../components/ui/pager/index.tsx`
 * comes back as `./index.tsx` — an exclusion written against the long form
 * silently matched nothing and the pager reported itself as an offender.
 */
const isThePager = (path: string): boolean =>
  path.includes("ui/pager/") || path === "./index.tsx";

const offenders = (): string[] =>
  Object.entries(SOURCES)
    .filter(([path]) => !isThePager(path))
    .filter(([, src]) => HAND_ROLLED(src))
    .map(([path]) => path.replace(/^.*\/(modules|components)\//, ""));

const users = (): string[] =>
  Object.entries(SOURCES)
    .filter(([path]) => !isThePager(path))
    .filter(([, src]) => /<Pager\b/.test(src))
    .map(([path]) => path.replace(/^.*\/(modules|components)\//, ""));

describe("one pager", () => {
  it("scans the screens at all, so a silent zero cannot pass as a clean sweep", () => {
    // The denominator. A glob that resolved to nothing reports perfection.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("catches a hand-rolled pager when there is one", () => {
    // Proves the pattern bites rather than trusting an empty result.
    const copy = `
      {pagination && pagination.last_page > 1 && (
        <Button onClick={() => setPage(page - 1)}>Previous</Button>
        <Button onClick={() => setPage(page + 1)}>Next</Button>
      )}`;
    expect(HAND_ROLLED(copy)).toBe(true);
  });

  it("leaves a month stepper and an infinite scroll alone", () => {
    expect(HAND_ROLLED('<button aria-label="Previous month">‹</button>')).toBe(false);
    expect(HAND_ROLLED("const hasMore = pagination.current_page < pagination.last_page;")).toBe(false);
  });

  it("no screen writes its own", () => {
    expect(offenders()).toEqual([]);
  });

  it("and the shared one is actually in use, on many screens", () => {
    // Without this the rule above is satisfied by deleting every pager in the
    // app — "no screen writes its own" is true of a product with no paging at
    // all, which is the state this work started from.
    expect(users().length).toBeGreaterThanOrEqual(20);
  });
});
