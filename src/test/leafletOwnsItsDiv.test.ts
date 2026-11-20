import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "SERVICE ZONE ADD KRTA HN, CITY SELECT K BAD ADD CIRCLE YA ADD SHAPE CHOSE
 * KRTA HN, MAP EMPTY WHITE BLANK HOJATA HAI."
 *
 * Leaflet writes its own classes (`leaflet-container`, `leaflet-touch`…) onto
 * the div it is given. The zones page toggled `cursor-crosshair` in that div's
 * className, so pressing "Add circle" made React rewrite the class list, the
 * Leaflet classes were gone, and the map rendered white. Every div handed to
 * `L.map` must have a className that never changes with state.
 */
const SRC = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("a Leaflet map's own div keeps a fixed class", () => {
  const files = walk(SRC).filter((f) => fs.readFileSync(f, "utf8").includes("L.map("));

  it("found the maps", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it("never toggles the container's className on state", () => {
    const bad: string[] = [];
    for (const f of files) {
      const code = fs.readFileSync(f, "utf8");
      const ref = /L\.map\((\w+)\.current/.exec(code)?.[1];
      if (!ref) continue;
      const tag = new RegExp(`<div[^>]*ref=\\{${ref}\\}[^>]*>`).exec(code)?.[0] ?? "";
      // A ternary or a state flag inside the container's className is the bug.
      if (/className=\{`[^`]*\$\{[^}]*\?/.test(tag) || /className=\{\w+ \?/.test(tag)) bad.push(path.relative(SRC, f));
    }
    expect(bad).toEqual([]);
  });

  it("the zones page draws its crosshair on the wrapper", () => {
    const page = fs.readFileSync(path.join(SRC, "modules/admin/pages/AdminServiceZonesPage.tsx"), "utf8");
    expect(page).toMatch(/<div ref=\{containerRef\} data-testid="zone-map" className=\{MAP_CLASS\} \/>/);
    expect(page).toMatch(/className=\{draft \? "zone-drawing" : undefined\}/);
  });
});
