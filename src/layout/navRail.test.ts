import { describe, expect, it } from "vitest";

import { shopNav, type NavItem } from "./AppSidebar";

/**
 * THE COLLAPSED RAIL HAS TO BE READABLE.
 *
 * Most of the day the sidebar is a rail of icons with no words beside them —
 * that is the whole point of collapsing it, and on a tablet it is the default.
 * So a picture used twice is not a cosmetic slip: it is two different screens
 * that look identical at the moment somebody is choosing between them.
 *
 * Measured before it was fixed, across the eight trades in both modes:
 *
 *   POS = Sales                     in ALL EIGHT trades
 *   Kitchen = Day & banking = Quotes for a restaurant
 *   POS = Sales = Subscription      in every full menu
 *   Riders = Customers, More = Settings, Dashboard = Dine-in
 *
 * Twenty-two collisions in sixteen menus. Nobody had counted, because reading a
 * list of icon names is not how anyone looks at a sidebar.
 */

/** Module maps mirroring BusinessTypes::defaultFeatures on the server. */
const FEATURES: Record<string, Record<string, boolean>> = {
  food: { expenses: true, images: true, pos: true, products: true, marketplace: true, delivery: true, dine_in: true },
  mart: { expenses: true, images: true, pos: true, products: true, inventory: true, marketplace: true, delivery: true },
  pharmacy: { expenses: true, pos: true, products: true, inventory: true, delivery: true },
  retail: { expenses: true, images: true, pos: true, products: true, inventory: true, marketplace: true, reservations: true, delivery: true },
  services: { expenses: true, pos: true, services: true },
  automotive: { expenses: true, pos: true, products: true, services: true, inventory: true },
  finance: { expenses: true },
  petroleum: { expenses: true, pos: true, products: true, services: true, inventory: true, fuel: true },
};

const TRADES = Object.keys(FEATURES);
const MODES = ["basic", "advanced"] as const;

/**
 * The icon component's name.
 *
 * These are SVGR imports, so the element's `type` is the generated component
 * and its `name` is what distinguishes one picture from another. Comparing the
 * elements themselves would compare object identity and every item would look
 * unique — a check that cannot fail.
 */
function iconName(item: NavItem): string {
  const el = item.icon as { type?: { name?: string; displayName?: string } };

  return el?.type?.displayName ?? el?.type?.name ?? "unknown";
}

function nav(type: string, mode: (typeof MODES)[number]): NavItem[] {
  return shopNav(FEATURES[type], type, mode, false, () => true);
}

describe("no two things in one menu wear the same picture", () => {
  for (const mode of MODES) {
    for (const type of TRADES) {
      it(`${type} / ${mode}`, () => {
        const items = nav(type, mode);
        const byIcon = new Map<string, string[]>();
        for (const item of items) {
          byIcon.set(iconName(item), [...(byIcon.get(iconName(item)) ?? []), item.name]);
        }

        const shared = [...byIcon.entries()]
          .filter(([, names]) => names.length > 1)
          .map(([icon, names]) => `${icon}: ${names.join(" = ")}`);

        expect(shared, "these look identical in the collapsed rail").toEqual([]);
      });
    }
  }

  it("and the check would notice if they did", () => {
    // The denominator. If shopNav returned nothing, every menu above would
    // pass with no collisions and the suite would look like a clean sheet.
    for (const mode of MODES) {
      for (const type of TRADES) {
        expect(nav(type, mode).length, `${type}/${mode} produced no menu at all`).toBeGreaterThan(3);
      }
    }
  });

  it("names a real picture for every item", () => {
    for (const mode of MODES) {
      for (const type of TRADES) {
        for (const item of nav(type, mode)) {
          expect(iconName(item), `${item.name} has no icon component`).not.toBe("unknown");
        }
      }
    }
  });
});

describe("the calm view keeps the screen the trade's day runs on", () => {
  /**
   * Simple mode used to be one list for everybody, gated on MODULES only. So
   * the trades whose day is a board rather than a till lost that board — the
   * screen they open first and close last — while keeping Products, which a
   * restaurant kitchen never touches.
   */
  const paths = (type: string, mode: (typeof MODES)[number]) =>
    nav(type, mode).flatMap((i) => [...(i.path ? [i.path] : []), ...(i.subItems ?? []).map((s) => s.path)]);

  it("a restaurant's calm view has the kitchen pass, not just the tables", () => {
    expect(paths("food", "basic")).toContain("/tenant/dine-in");
    expect(paths("food", "basic")).toContain("/tenant/kitchen");
  });

  it("a workshop's calm view has the bay board", () => {
    expect(paths("automotive", "basic")).toContain("/tenant/workshop");
    expect(paths("services", "basic")).toContain("/tenant/workshop");
  });

  it("a chemist's calm view has the dispensing register", () => {
    expect(paths("pharmacy", "basic")).toContain("/tenant/pharmacy");
  });

  it("a filling station's calm view has the forecourt", () => {
    expect(paths("petroleum", "basic")).toContain("/tenant/fuel");
  });

  it("and none of it leaks to a trade that has no such day", () => {
    // The other half, and the half that keeps this honest: a grocery has no
    // pass, no bay and no forecourt, and a menu item that opens on an empty
    // screen forever is one people learn to skip past.
    const mart = paths("mart", "basic");
    for (const alien of ["/tenant/kitchen", "/tenant/workshop", "/tenant/pharmacy", "/tenant/fuel"]) {
      expect(mart, `a grocery was offered ${alien}`).not.toContain(alien);
    }
  });

  it("still offers nothing the full menu withholds", () => {
    // Simple is a smaller menu, never a different business. Pinned in
    // shopNav.test.ts too; repeated here because this file is what moves items
    // between the two.
    for (const type of TRADES) {
      const full = new Set(paths(type, "advanced"));
      for (const p of paths(type, "basic")) {
        expect(full.has(p), `${type}: Simple offers ${p} and Full does not`).toBe(true);
      }
    }
  });
});
