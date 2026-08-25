import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TENANT_ROUTES } from "../src/test/routes";

/**
 * EVERY SHOP-SIDE SCREEN IS OPENED BY A BROWSER SOMEWHERE.
 *
 * The browser suite walked fourteen of the shop's forty-eight screens for
 * months. The other thirty-four had never been opened at all — not a lower
 * standard on them, none — and that is how a kitchen board spent six days
 * showing dockets for tabs that had been cancelled, and how five whole trades
 * scrolled sideways on every screen they had.
 *
 * Closing that gap once is worth little on its own: the forty-ninth screen
 * arrives next week and nothing would say so. This is the guard, and it is a
 * unit test rather than a browser one deliberately — it must fail in seconds,
 * on the machine of whoever adds the screen, not twenty minutes into a suite.
 *
 * It lives in `e2e/` and not in `src/` because it READS FILES: `src` is
 * compiled for a browser, and `node:fs` there fails the build rather than the
 * typecheck — `tsconfig.app.json` excludes tests, so `tsc --noEmit` says
 * nothing and `npm run build` says it late.
 */

const E2E = __dirname;

/** Every `{ path: "…" }` in the three specs that WALK screens. */
function walked(): Set<string> {
  const out = new Set<string>();
  for (const file of ["chrome.spec.ts", "food.chrome.spec.ts", "trade.chrome.spec.ts"]) {
    const src = fs.readFileSync(path.join(E2E, file), "utf8");
    for (const m of src.matchAll(/path: "([^"]+)"/g)) out.add(m[1]);
  }

  return out;
}

/**
 * Screens no walk should open, with the reason.
 *
 * An entry here is a CLAIM. `/tenant/setup` completes a shop's setup — opening
 * it would change the thing being measured, and a fixture that edits itself is
 * how a suite starts testing its own leftovers.
 */
const NOT_WALKED: Record<string, string> = {
  "/tenant/setup": "completes a shop's setup — a walk must not change what it walks",
};

describe("every shop-side screen is walked by a browser", () => {
  it("names no screen that nothing opens", () => {
    const seen = walked();
    const unwalked = [...TENANT_ROUTES]
      .filter((r) => !r.includes(":"))
      .filter((r) => !seen.has(r) && !(r in NOT_WALKED));

    expect(
      unwalked,
      "these screens are in TENANT_ROUTES and no browser opens them. Add them to "
      + "chrome.spec (the mart can reach it), food.chrome.spec (needs a dish) or "
      + "trade.chrome.spec (needs that trade) — or to NOT_WALKED with the reason.",
    ).toEqual([]);
  });

  it("walks nothing that is not a real screen", () => {
    // The other direction, and the one that rots quietly: a path renamed in
    // App.tsx leaves the walk loading a 404 forever, which renders a heading
    // and passes every rule about what is covered and off the edge.
    const stray = [...walked()].filter((p) => !TENANT_ROUTES.has(p));

    expect(stray, "the walk opens paths that are not declared screens").toEqual([]);
  });

  it("has a denominator", () => {
    // Both assertions above pass trivially against an empty list. This is what
    // tells a working guard from one whose file-reading has quietly broken.
    expect(walked().size, "the walk lists were read as empty").toBeGreaterThan(20);
    expect(TENANT_ROUTES.size, "the route list was read as empty").toBeGreaterThan(20);
  });

  it("every exemption is a claim somebody made on purpose", () => {
    for (const [route, why] of Object.entries(NOT_WALKED)) {
      expect(TENANT_ROUTES.has(route), `${route} is exempted but is not a screen`).toBe(true);
      expect(why.length, `${route} is exempted with no reason`).toBeGreaterThan(20);
    }
  });
});
