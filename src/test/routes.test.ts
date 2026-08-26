import { describe, expect, it } from "vitest";

import { TENANT_ROUTES } from "./routes";

/**
 * THE ROUTE LIST IS THE ROUTER'S, NOT SOMEBODY'S RECOLLECTION OF IT.
 *
 * `TENANT_ROUTES` exists so several suites share one idea of what screens
 * exist — the Help Centre's coverage guard, the reachability guard, the
 * browser walk. All three ask "is every screen covered", and all three ask it
 * of THIS set.
 *
 * So a screen missing from the set is invisible to every one of them at once.
 * A page added to App.tsx and not added here passes the help coverage guard,
 * passes the reachability guard, and is reported as walked — by three tests
 * that have simply never heard of it. That is worse than any of them failing,
 * because it looks exactly like success. It happened: `/tenant/orders/new` was
 * routed, shipped and undocumented, and every guard was green.
 *
 * ── What this checks, and what it deliberately does not ────────────────
 *
 * It compares SEGMENTS, not full paths. The first attempt tried to rebuild
 * each route by walking the nesting, and got it wrong twice: `<Route
 * path="products">` holding `<Route path="new">` came out as `/tenant/new`,
 * and then the tag regex broke altogether because `element={<Page />}` has a
 * `>` inside the attribute it was trying to skip.
 *
 * Rebuilding JSX nesting with a regular expression is the wrong tool, and a
 * scanner that is wrong is worse than no scanner — it fails on screens that
 * are fine until somebody deletes it. So this asks the narrow question a
 * regular expression CAN answer honestly: every path segment the router
 * declares must appear as the last segment of some route the suites know
 * about. A new screen adds a segment, and the segment has to be somewhere.
 */

const APP = Object.values(
  import.meta.glob("../App.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

/**
 * App.tsx with every `element={…}` attribute removed.
 *
 * That attribute is why a regular expression cannot read this file: it holds
 * JSX, so it contains `>` and `/>` of its own, and any pattern trying to find
 * the end of a `<Route …>` tag stops inside it. Strip it by matching braces —
 * which IS something a scanner can do reliably — and what is left is a tree of
 * tags carrying nothing but simple string attributes.
 *
 * The first two versions of this guard skipped that step and were wrong twice:
 * once reporting `/tenant/products/new` as `/tenant/new`, and once finding
 * eight routes in a file that declares fifty.
 */
function withoutElements(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const at = source.indexOf("element={", i);
    if (at === -1) {
      out += source.slice(i);
      break;
    }

    out += source.slice(i, at);

    // Walk from the opening brace to its match, so nested JSX and nested
    // objects both come out whole.
    let depth = 0;
    let j = at + "element=".length;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    i = j + 1;
  }

  return out;
}

/**
 * The tenant paths App.tsx actually declares, with the nesting respected.
 *
 * Routes nest — `<Route path="products">` holds `<Route path="new">`, which is
 * `/tenant/products/new` and not `/tenant/new` — so this keeps a stack: a
 * self-closing tag is a leaf, an open tag pushes, `</Route>` pops. A pathless
 * `<Route element={…}>` is a layout wrapper and pushes an empty segment, or
 * the stack stops lining up with the closing tags.
 *
 * Parameterised children are dropped, matching the set's own note: no menu or
 * tile ever produces one.
 */
function declared(): Set<string> {
  const source = withoutElements(APP);
  const found = new Set<string>();
  const stack: string[] = [];

  for (const tag of source.matchAll(/<Route\b([^>]*?)(\/?)>|<\/Route>/g)) {
    if (tag[0] === "</Route>") {
      stack.pop();
      continue;
    }

    const path = /path="([^"]*)"/.exec(tag[1] ?? "")?.[1] ?? "";
    const leaf = tag[2] === "/";
    const parts = leaf ? [...stack, path] : [...stack, path];

    if (!leaf) stack.push(path);

    const full = parts
      .filter((part) => part !== "")
      .reduce((acc, part) => (part.startsWith("/") ? part : `${acc}/${part}`), "");

    if (full.startsWith("/tenant") && !full.includes(":")) found.add(full);
  }

  return found;
}

describe("the shared route list", () => {
  it("reads the router, so a silent zero cannot pass as a match", () => {
    // The denominator, and the assertion that caught the broken parser twice:
    // the version that could not see past `element={…}` found eight routes in
    // a file that declares dozens, and would have reported a clean sweep.
    expect(declared().size).toBeGreaterThan(30);
    expect(declared().has("/tenant/products/new")).toBe(true);
  });

  it("holds every tenant screen App.tsx declares", () => {
    const missing = [...declared()].filter((route) => !TENANT_ROUTES.has(route)).sort();

    expect(
      missing,
      `routed but not in TENANT_ROUTES — three guards would pass without ever seeing these: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("does not claim screens the router does not have", () => {
    // The other direction, and it matters just as much: a route left in the
    // set after a screen is deleted makes the help guard demand an article for
    // a page nobody can open.
    const stale = [...TENANT_ROUTES].filter((route) => !declared().has(route)).sort();

    expect(stale, `in TENANT_ROUTES but not routed: ${stale.join(", ")}`).toEqual([]);
  });
});
