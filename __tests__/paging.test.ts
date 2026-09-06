import { PROJECT_ROOT, fs, path, sourceFiles } from "./support/node";

/**
 * A LIST SHOWS EVERYTHING, NOT ITS FIRST PAGE.
 *
 * ── The gap this closes ──────────────────────────────────────────────
 *
 * Every marketplace endpoint has paged from the beginning — twenty-four
 * products, twenty shops, fifteen orders — and the app asked for page one and
 * stopped. A shop with four hundred items had twenty-four, and the aisle's own
 * header printed "24+" because the screen knew it was not telling the truth.
 *
 * Nothing announced it. A short list looks exactly like a small catalogue.
 *
 * ── The two mistakes an infinite list makes ──────────────────────────
 *
 * Both are guarded below, because both are silent:
 *
 *   1. `onEndReached` fires MORE THAN ONCE while a list settles. Without the
 *      in-flight check that is two identical requests for page two, and on a
 *      throttled API it is the fastest way to a 429.
 *   2. `getNextPageParam` that never returns undefined loops for ever on the
 *      last page — a list that quietly refetches the same rows until the
 *      screen is closed.
 */

const ROOT = PROJECT_ROOT;

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the lists that page", () => {
  const files = sourceFiles(path.join(ROOT, "src"));

  const infinite = files.filter((f) => /useInfiniteQuery\(/.test(codeOnly(fs.readFileSync(f, "utf8"))));

  it("found them", () => {
    // The aisle, the shop list and the orders list. If this drops, the rules
    // below would pass by checking nothing.
    expect(infinite.length).toBeGreaterThanOrEqual(2);
  });

  it("every one of them knows when to stop", () => {
    /**
     * COUNTED, not merely present.
     *
     * The first version asked whether the stop condition appeared in each
     * FILE. `useMarketplace.ts` holds two infinite queries, so breaking one of
     * them left the other's line matching and the guard green — which a
     * mutation proved on the first try. A rule about every query has to be
     * counted per query, not per file.
     */
    let checked = 0;

    for (const file of infinite) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));

      const queries = [...src.matchAll(/getNextPageParam/g)].length;
      // The last page returns undefined; without it the list asks for the same
      // page for ever. And a response with NO pagination is an endpoint that
      // answered in full, not one with more to give.
      const stops = [...src.matchAll(/current_page >= p\.last_page\) return undefined/g)].length;
      const guards = [...src.matchAll(/p == null \|\|/g)].length;

      expect(queries).toBeGreaterThan(0);
      expect(stops).toBe(queries);
      expect(guards).toBe(queries);
      checked += queries;
    }

    // The denominator, stated: four paged lists today.
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("no screen asks for the next page while one is already in flight", () => {
    /**
     * THE HANDLER'S OWN BODY, not four hundred characters after it.
     *
     * The first version sliced a fixed window, which reached past the handler
     * into `ListFooterComponent` — where `isFetchingNextPage` legitimately
     * appears. So deleting the guard from the handler left the window still
     * matching, and a mutation walked straight through it.
     */
    const HANDLER = /onEndReached=\{\(\) => \{([\s\S]*?)\n\s*\}\}/g;
    const offenders: string[] = [];
    let seen = 0;

    for (const file of files) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));

      for (const m of src.matchAll(HANDLER)) {
        seen += 1;
        if (!/isFetchingNextPage/.test(m[1])) {
          offenders.push(`  ${path.relative(ROOT, file)}`);
        }
      }
    }

    expect(seen).toBeGreaterThanOrEqual(4);
    expect(offenders.join("\n")).toBe("");
  });

  it("fetches before the bottom, not at it", () => {
    // Fetching at the very end means the spinner is what somebody sees.
    const screens = files.filter((f) => /onEndReached=/.test(codeOnly(fs.readFileSync(f, "utf8"))));

    expect(screens.length).toBeGreaterThanOrEqual(2);
    for (const file of screens) {
      expect(codeOnly(fs.readFileSync(file, "utf8"))).toMatch(/onEndReachedThreshold=\{0\.5\}/);
    }
  });

  it("no screen still reads a single page off an infinite query", () => {
    // `list.data.data` is the shape of a plain query. On an infinite one it is
    // undefined, and the list renders empty with no error anywhere.
    const offenders = files
      .flatMap((f) =>
        codeOnly(fs.readFileSync(f, "utf8"))
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, line]) => /\b(list|shops|orders)\.data\?\.data\b/.test(line))
          .map(([n]) => `  ${path.relative(ROOT, f)}:${n}`),
      );

    expect(offenders.join("\n")).toBe("");
  });
});
