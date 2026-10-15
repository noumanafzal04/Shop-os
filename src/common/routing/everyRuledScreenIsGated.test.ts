import { describe, expect, it } from "vitest";

import { mappedScreens, screenGoverning } from "./screenPermissions";

/**
 * A SCREEN WITH A RULE IS BEHIND THE GATE THAT READS IT.
 *
 * The map says who may open each screen, and the menu, the dashboard and the
 * gate all read it — but the gate only stands where App.tsx puts it. The
 * Subscription screen was given a rule (owner only, Q7) and its route was never
 * moved inside RequireTenantScreen: typed in, it opened for a cashier and filled
 * with a 403 (tester pass 4, B56). Nothing compared the map with the routes.
 *
 * This reads App.tsx and finds, for every route, whether a RequireTenantScreen
 * stands above it. Every route a mapped screen governs must have one.
 */
const app = (import.meta.glob("../../App.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>)["../../App.tsx"];

interface Found { path: string; gated: boolean }

/** Every <Route path=…>, with its full path and whether the gate is above it. */
function routes(source: string): Found[] {
  const found: Found[] = [];
  const stack: Array<{ path: string; gated: boolean }> = [{ path: "", gated: false }];
  let i = 0;

  while (i < source.length) {
    const open = source.indexOf("<Route", i);
    const close = source.indexOf("</Route>", i);
    if (open === -1 && close === -1) break;

    if (close !== -1 && (open === -1 || close < open)) {
      stack.pop();
      i = close + "</Route>".length;
      continue;
    }

    // Read the tag to its own end: a `>` outside every {…}.
    let depth = 0;
    let j = open + "<Route".length;
    for (; j < source.length; j++) {
      const ch = source[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    const tag = source.slice(open, j + 1);
    const selfClosing = source[j - 1] === "/";
    const outside = tag.replace(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, "");
    const own = /\bpath="([^"]+)"/.exec(outside)?.[1];

    const parent = stack[stack.length - 1];
    const path = own === undefined ? parent.path : own.startsWith("/") ? own : `${parent.path.replace(/\/$/, "")}/${own}`;
    const gated = parent.gated || tag.includes("<RequireTenantScreen");

    if (own !== undefined) found.push({ path, gated });
    if (!selfClosing) stack.push({ path, gated });
    i = j + 1;
  }

  return found;
}

describe("a screen with a rule is behind the gate that reads it", () => {
  const all = routes(app);

  it("finds the routes it is about", () => {
    // A reader that found nothing would pass everything.
    expect(all.length).toBeGreaterThan(50);
    expect(all.find((r) => r.path === "/tenant/pos")?.gated).toBe(true);
    expect(all.find((r) => r.path === "/tenant/security")?.gated).toBe(false);
  });

  it("every route a mapped screen governs has the gate above it", () => {
    const mapped = new Set(mappedScreens());
    const open = all
      .filter((r) => r.path.startsWith("/tenant/"))
      .filter((r) => {
        const screen = screenGoverning(r.path);
        return screen !== null && mapped.has(screen);
      })
      .filter((r) => !r.gated)
      .map((r) => r.path);

    expect(open, "these screens have a rule in screenPermissions and no RequireTenantScreen above their route").toEqual([]);
  });
});
