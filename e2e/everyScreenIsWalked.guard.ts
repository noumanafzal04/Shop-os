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

/**
 * Every screen the three walking specs open.
 *
 * Two shapes, because one of these screens IS a record: the dine-in tab is
 * `/tenant/dine-in/tickets/:id`, so its spec writes `path: (id) => \`…\`` and
 * a literal-only reader saw nothing there. When that shape arrived this guard
 * did not report the tab as unwalked — it reported the FLOOR and the KITCHEN
 * as unwalked, because the whole array had stopped matching. A parser that
 * silently stops reading a file is the failure this codebase keeps meeting; it
 * happened to fail loudly here only because those two were already covered.
 *
 * `:id` is what the router calls the parameter, so a templated path is
 * normalised back to the route it belongs to rather than to whatever id the
 * fixture happened to create.
 */
function walked(): Set<string> {
  const out = new Set<string>();
  for (const file of ["chrome.spec.ts", "food.chrome.spec.ts", "trade.chrome.spec.ts"]) {
    const src = fs.readFileSync(path.join(E2E, file), "utf8");
    // { path: "/tenant/x" }
    for (const m of src.matchAll(/path: "([^"]+)"/g)) out.add(m[1]);
    // { path: () => "/tenant/x" } and { path: (id) => `/tenant/x/${id}` }
    for (const m of src.matchAll(/path: \([^)]*\) =>\s*[`"]([^`"]+)[`"]/g)) {
      out.add(m[1].replace(/\$\{[^}]*\}/g, ":id"));
    }
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

  /**
   * ⚠️ NO FIXTURE CAN REACH IT — a debt, not a decision.
   *
   * `/tenant/bank-offers` WAS in chrome.spec.ts and passed at four device
   * sizes for as long as that list has existed. It was measuring the
   * DASHBOARD: `bank_offers` is false in every trade's defaults, so not one of
   * the eight sweep shops has it, and `RequireFeature` redirects. Nothing
   * asked where the page had ended up — the size denominator beside it was
   * written for a redirect to an EMPTY page, and a dashboard is not empty.
   *
   * Both walking specs assert their own pathname now, so this cannot recur
   * silently. The screen itself is still uncovered, and that is what this line
   * is for. Granting the module to one sweep shop pays it off:
   *
   *   php artisan tinker --execute='$t = App\Models\User::where("email",
   *     "sweep-retail@qa.test")->first()->tenant; $f = $t->features;
   *     $f["bank_offers"] = true; $t->features = $f; $t->save();'
   *
   * …then move it into trade.chrome.spec.ts under `retail` and delete this.
   */
  "/tenant/bank-offers": "NO FIXTURE HAS THE MODULE — walked nothing but the dashboard until now",

  /**
   * ⚠️ BASIC HR — placeholders, and only while they stay placeholders.
   *
   * Each renders a fixed "not built yet" notice and calls nothing. A browser
   * walk measures what a real screen does with real data; there is no data
   * here and no behaviour to catch, so a walk would be nine green checks that
   * prove a static paragraph still renders.
   *
   * These lines come out the moment a screen reads or writes anything — which
   * is the same moment it owes a module key. Both debts are written down, in
   * shopNav.test.ts and here, so neither can be paid by forgetting.
   */
  "/tenant/hrm": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/attendance": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/leaves": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/shifts": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/advances": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/commission": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/payroll": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/reports": "PLACEHOLDER — nothing to walk until it does something",
  "/tenant/hrm/settings": "PLACEHOLDER — nothing to walk until it does something",
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
    //
    // A PARAMETERISED CHILD IS A REAL SCREEN, JUST NOT A MENU ITEM.
    //
    // TENANT_ROUTES is the list two menus and a permission map are checked
    // against, and it says so itself: parameterised children are left out
    // because no menu ever produces one. The dine-in tab is exactly that —
    // reached by tapping an occupied table, never from the rail — so it is
    // walked without being declared, and neither of those is a mistake.
    //
    // Checked against App.tsx instead, which is the thing that actually knows
    // whether the route exists. A renamed path still leaves the walk loading a
    // 404 forever, which is what this check is for.
    const routerSrc = fs.readFileSync(path.join(E2E, "..", "src", "App.tsx"), "utf8");
    const declaredInRouter = (p: string): boolean =>
      routerSrc.includes(`path="${p.replace(/:id$/, "")}`);

    const stray = [...walked()].filter(
      (p) => !TENANT_ROUTES.has(p) && !(p.includes(":id") && declaredInRouter(p)),
    );

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
