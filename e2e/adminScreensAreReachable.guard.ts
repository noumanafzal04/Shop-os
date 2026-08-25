import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * EVERY ADMIN SCREEN IS OFFERED SOMEWHERE.
 *
 * This codebase has now shipped SEVEN screens that were built, routed, tested
 * and completely unreachable — no menu item, no link, nothing but a URL
 * somebody would have to guess. The shop side grew a guard after the fourth.
 * The admin side never did, and the admin rail is exactly where it happens:
 * adding a route is one file and adding the menu item is another.
 *
 * So this reads both files and refuses to let them disagree. It is a unit test
 * rather than a browser one on purpose — it must fail in seconds on the
 * machine of whoever adds the screen, not twenty minutes into a suite.
 *
 * It lives in `e2e/` because it READS FILES: `src` is compiled for a browser,
 * where `node:fs` fails the build rather than the typecheck.
 */

const ROOT = path.join(__dirname, "..");

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** The paths actually on the admin rail, from the two real arrays. */
function railPaths(): Set<string> {
  const src = read("src/layout/AppSidebar.tsx");
  const out = new Set<string>();

  for (const name of ["adminMainItems", "adminPlatformItems"]) {
    const start = src.indexOf(`const ${name}: NavItem[] = [`);
    if (start === -1) throw new Error(`${name} is no longer declared the way this guard reads it`);
    const end = src.indexOf("\n];", start);
    for (const m of src.slice(start, end).matchAll(/path:\s*"(\/admin[^"]*)"/g)) out.add(m[1]);
  }

  return out;
}

/**
 * Every admin screen the router declares.
 *
 * TWO patterns, and the second one is why this guard was wrong on its first
 * run. Most admin screens are wrapped in `RequireAdminScreen path="/admin/…"`,
 * so reading only those looked complete — and it reported the Help Centre as a
 * dead menu row. The Help Centre is routed perfectly well; it simply has no
 * permission gate, deliberately, because a screen you need in order to work
 * out the navigation must not be behind the navigation's own rules.
 *
 * A scanner that models one of two shapes reports the other as a bug. Suspect
 * the parser before the code.
 */
function routedPaths(): Set<string> {
  const src = read("src/App.tsx");
  const out = new Set<string>();
  for (const m of src.matchAll(/RequireAdminScreen path="(\/admin[^"]*)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/<Route path="(\/admin[^"]*)"/g)) out.add(m[1]);

  return out;
}

/**
 * Reachable by definition, so neither direction may complain about it.
 * `/admin` is where the console lands; it can have no gate and needs no link.
 */
const ALWAYS_REACHABLE = new Set(["/admin"]);

/**
 * Screens deliberately NOT on the rail, each with the way in.
 *
 * An entry here is a CLAIM that the screen is reachable by another route, and
 * it is the only thing standing between this guard and being switched off one
 * line at a time. If you add one, name the surface that offers it.
 */
const REACHED_FROM_ELSEWHERE: Record<string, string> = {
  // The "Add tenant" button on /admin/tenants, and the dashboard's quick
  // actions. A second rail row for a create form would be noise.
  "/admin/tenants/new": "the New tenant button on /admin/tenants",
};

describe("every admin screen can be got to", () => {
  it("reads enough of both files to be worth trusting", () => {
    // THE DENOMINATOR. A regex that silently matches nothing turns this whole
    // file into a test that passes because it looked at an empty set — which
    // is how three guards in this repo passed while blind to their subject.
    expect(railPaths().size).toBeGreaterThanOrEqual(8);
    expect(routedPaths().size).toBeGreaterThanOrEqual(8);
  });

  it("offers every admin screen on the rail, or says where else", () => {
    const rail = railPaths();
    const orphans = [...routedPaths()].filter(
      (p) => !rail.has(p) && !(p in REACHED_FROM_ELSEWHERE) && !ALWAYS_REACHABLE.has(p),
    );

    expect(orphans, "admin screens that exist but nothing offers").toEqual([]);
  });

  it("does not offer a rail row that goes nowhere", () => {
    // The other direction, and the cheaper bug: a menu item pointing at a
    // route nobody wrote gives a 404 to whoever presses it.
    const routed = routedPaths();
    const dead = [...railPaths()].filter(
      (p) => !routed.has(p) && !ALWAYS_REACHABLE.has(p),
    );

    expect(dead, "rail rows with no route behind them").toEqual([]);
  });
});
