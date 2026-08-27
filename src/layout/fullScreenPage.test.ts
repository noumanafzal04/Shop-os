import { describe, expect, it } from "vitest";

import { FULL_SCREEN_PAGE, FULL_SCREEN_PAGE_MIN } from "./fullScreenPage";

/**
 * A PAGE OUTSIDE THE SHELL STILL HAS TO MAKE ROOM FOR WHAT IS PINNED TO IT.
 *
 * The install prompt is `fixed bottom-3` at `z-[99998]`. AppLayout pads by
 * `--pinned-bottom` so its pages end above the card; HelpCenterPage, which is
 * full-screen, subtracts it from its height. The till, the floor, the tab and
 * the kitchen board did neither — and a page that is exactly `h-dvh` has no
 * scroll room to recover with, so whatever it pins to its own bottom sits
 * under the card permanently.
 *
 * On the dine-in tab that was "Running total" and the Fire and Settle buttons.
 * A browser found it; nothing in the source is wrong on either side, which is
 * why it took a real layout engine to see (jsdom has none).
 *
 * The list of pages is READ FROM THE ROUTER, not typed here. Four guards in
 * this codebase once shared one hand-maintained route list and a screen missing
 * from it was invisible to all four while all four reported green.
 */
const SOURCES = import.meta.glob("../modules/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const APP = import.meta.glob("../App.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Every lazy page import in App.tsx: component name → module path. */
function pageModules(): Map<string, string> {
  const src = Object.values(APP)[0] ?? "";
  const found = new Map<string, string>();
  for (const m of src.matchAll(/const (\w+) = lazy\(\(\) => import\("\.\/([^"]+)"\)\)/g)) {
    found.set(m[1], `../${m[2]}.tsx`);
  }

  return found;
}

/**
 * The routes rendered OUTSIDE `<Route path="/tenant" element={<AppLayout />}>`.
 *
 * Everything before that element in App.tsx is its own full screen; everything
 * inside it is a page in the shell and gets AppLayout's padding for free.
 */
function fullScreenComponents(): string[] {
  const src = Object.values(APP)[0] ?? "";
  // The TENANT shell specifically. `AppLayout` is mounted twice — once at
  // /admin and once at /tenant — and indexOf found the admin one, so "before
  // the shell" was a slice with no tenant routes in it at all and the sweep
  // reported a clean zero. The denominator below is the only reason that was
  // caught rather than shipped as a guard that guards nothing.
  const shellAt = src.indexOf('<Route path="/tenant" element={<AppLayout />}>');
  expect(shellAt, "App.tsx no longer mounts the tenant shell where this guard looks for it").toBeGreaterThan(0);

  const before = src.slice(0, shellAt);
  const names = new Set<string>();
  for (const m of before.matchAll(/<Route\s+path="\/tenant[^"]*"\s+element={<(\w+)\s*\/>}/g)) {
    names.add(m[1]);
  }

  return [...names];
}

describe("a full-screen page leaves room for a pinned card", () => {
  it("finds the router and the pages it names", () => {
    // The denominator, twice over: a glob that breaks, or a router that stops
    // matching, must fail here rather than pass an empty sweep.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
    expect(pageModules().size).toBeGreaterThan(20);
    expect(fullScreenComponents().length).toBeGreaterThanOrEqual(4);
  });

  it("subtracts what is pinned, on every one of them", () => {
    const modules = pageModules();
    const offenders: string[] = [];

    for (const name of fullScreenComponents()) {
      const path = modules.get(name);
      if (path === undefined) continue;      // not a lazy import — nothing to read
      const src = SOURCES[path];
      expect(src, `${name} is routed but ${path} was not globbed`).toBeDefined();

      // Either the shared constant, or the same calc written out — the Help
      // Centre predates the constant and spells it inline, which is correct.
      const reserves =
        src.includes("FULL_SCREEN_PAGE")
        || src.includes("var(--pinned-bottom");

      if (!reserves) offenders.push(`${name} (${path})`);
    }

    expect(
      offenders,
      "these pages fill the viewport outside AppLayout and never subtract "
      + "--pinned-bottom, so the install prompt sits on whatever they pin to "
      + `their own bottom edge:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("is a height rule, not a decoration", () => {
    for (const cls of [FULL_SCREEN_PAGE, FULL_SCREEN_PAGE_MIN]) {
      expect(cls).toContain("100dvh");
      expect(cls).toContain("--pinned-bottom");
      // dvh, never vh: `vh` is the viewport with the address bar hidden, which
      // is not the viewport anybody is holding.
      expect(cls).not.toMatch(/\d+vh\b/);
    }
  });
});
