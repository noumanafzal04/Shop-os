import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * "SERVICE ZONE LIST SEPARATE HONI CHAHIYE, CREATE OR ADD SEPARATE PAGE YA
 * TAB." The zones page is two tabs: the list (filtered by the chosen city,
 * on/off, edit, remove, "+ Add a zone") and the drawing board (city first,
 * then the map). The map's tab is HIDDEN, not unmounted — Leaflet owns its
 * div — and is resized whenever it is shown.
 */
const page = fs.readFileSync(path.resolve(__dirname, "../modules/admin/pages/AdminServiceZonesPage.tsx"), "utf8");

describe("service zones: a list tab and a drawing tab", () => {
  it("has two tabs", () => {
    expect(page).toMatch(/role="tablist" aria-label="Service zones"/);
    expect(page).toMatch(/\["list", `Zones \(\$\{rows\.length\}\)`\]/);
    expect(page).toMatch(/"Draw a zone"/);
  });

  it("keeps the map mounted while its tab is hidden, and re-measures it when shown", () => {
    expect(page).toMatch(/className=\{tab === "draw" \? undefined : "hidden"\} data-testid="zone-draw-tab"/);
    expect(page).toMatch(/if \(tab === "draw"\) setTimeout\(\(\) => mapRef\.current\?\.invalidateSize\(\), 0\)/);
  });

  it("the list shows only in its tab, adds from a button, and edits by opening the drawing tab", () => {
    expect(page).toMatch(/\{tab === "list" && \(/);
    expect(page).toMatch(/onClick=\{startDrawing\}>\+ Add a zone</);
    expect(page).toMatch(/onClick=\{\(\) => editZone\(z\)\}>Edit</);
    expect(page).toMatch(/setTab\("list"\);\s*refreshAfter/);
  });
});
