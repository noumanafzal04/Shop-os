import { createElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { capabilitiesFrom } from "../modules/dashboard/components/shop/capabilities";
import { MoneyPanel } from "../modules/dashboard/components/shop/MoneyPanel";
import { QuickActions } from "../modules/dashboard/components/shop/QuickActions";
import type { TenantDashboard } from "../modules/dashboard/types";
import { REPORT_TABS, reportTabs } from "../modules/expenses/reportTabs";
import { routeFeatures, routeIsOpen } from "./routeFeatures";
import { EVERY_MODULE, TRADE_FEATURES, settleFeatures } from "./tradeFeatures";

/**
 * A JOB OFFERED MUST BE A JOB DOABLE — on every surface, not just the menu.
 *
 * The sidebar has had this test for months. The dashboard and the reports
 * screen offer screens too and had none, so when nine passenger screens were
 * split into modules of their own, four offers were left asking the parent key
 * they used to ride on:
 *
 *   Dashboard "Stock in"      → /tenant/purchases, offered for `inventory`
 *   Dashboard "You owe"       → /tenant/suppliers, offered for `inventory`
 *   Reports → Purchases       → offered for `inventory`
 *   Reports → Bank claims     → offered to anyone who sells
 *
 * All four lead somewhere whose own route gate now asks for `purchasing` or
 * `bank_offers`. The shop saw the button, pressed it, and was refused by its
 * own app — the worst version of a module boundary, because it reads as a
 * broken product rather than a module it was never sold.
 *
 * ── The first version of this file was BLIND ────────────────────────────
 *
 * It carried a hand-written table saying which capability guarded which link.
 * Putting the original bug back — `caps.tracksStock` guarding "Stock in" — left
 * every assertion green, because the table still said `buysFromSuppliers` and
 * the table was what was being graded. A detector that cannot fail when its
 * subject is broken is not a detector.
 *
 * So both halves now read the thing itself: the gates are PARSED out of App.tsx
 * (routeFeatures.ts), and the offers are read out of the DOM the panels
 * actually render.
 */

const GATES = routeFeatures();

/** Owners hold every permission — this file is about MODULES, not people. */
const anyone = () => true;

/**
 * Enough of a dashboard payload for both panels to draw every tile they can.
 *
 * Non-zero on purpose: MoneyPanel hides a tile with nothing in it, and a fixture
 * of zeroes would make "offers no link" the answer everywhere.
 */
const DASHBOARD = {
  branch_scope: null,
  money_owed: {
    receivable: { total: 4000, accounts: 2 },
    payable: { total: 30000, accounts: 1 },
  },
  till: { day_open: true, day_id: "d1", open_shifts: 2, banked_today: 3000, unclosed_day: null, unclosed_days: 0 },
  pending_orders: 3,
  recent_expenses: [],
  inventory: { out_of_stock: 1, low_stock: 2, expiring_soon: 0 },
} as unknown as TenantDashboard;

/** Every /tenant link the dashboard panels actually put on screen. */
function linksOffered(features: Record<string, boolean>): string[] {
  const caps = capabilitiesFrom(features, "retail", anyone);
  const out = new Set<string>();

  const { container, unmount } = render(
    createElement(
      MemoryRouter,
      null,
      createElement(QuickActions, { caps }),
      createElement(MoneyPanel, { data: DASHBOARD, caps, money: (n: number) => `Rs ${n}` }),
    ),
  );

  container.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";

    if (href.startsWith("/tenant")) out.add(href);
  });

  unmount();

  return [...out];
}

/**
 * The shops to mount.
 *
 * Everything on, then everything on WITH ONE MODULE REMOVED. That second set is
 * the mutation itself: switch off `purchasing` alone and the dashboard must
 * stop offering /tenant/purchases — which is exactly the bug, and exactly what
 * a restated table could not see. The eight trade defaults come along because
 * they are what a real shop opens with.
 */
function shopsWorthMounting(): Array<[string, Record<string, boolean>]> {
  const shops: Array<[string, Record<string, boolean>]> = [
    ["a shop given everything", settleFeatures({ ...EVERY_MODULE })],
    ["a shop given nothing", settleFeatures({})],
  ];

  for (const key of Object.keys(EVERY_MODULE)) {
    shops.push([`everything but ${key}`, settleFeatures({ ...EVERY_MODULE, [key]: false })]);
  }

  for (const [trade, features] of Object.entries(TRADE_FEATURES)) {
    shops.push([`a ${trade} shop`, settleFeatures({ ...features })]);
  }

  return shops;
}

/**
 * Every module combination, settled the way the server stores it.
 *
 * Without settling, the walk invents shops that cannot exist — `purchasing`
 * with `inventory` off — and then reports the refusal as a defect.
 * /tenant/purchases is nested inside BOTH gates precisely because the second
 * implies the first.
 */
function* everyShop(): Generator<Record<string, boolean>> {
  const AXES = ["pos", "marketplace", "dine_in", "products", "services", "inventory",
    "purchasing", "expenses", "delivery", "promotions", "bank_offers"] as const;
  const seen = new Set<string>();

  for (let mask = 0; mask < 1 << AXES.length; mask++) {
    const features: Record<string, boolean> = {};

    AXES.forEach((key, i) => { features[key] = (mask & (1 << i)) !== 0; });

    const settled = settleFeatures(features);
    const shape = JSON.stringify(settled);

    if (seen.has(shape)) continue;

    seen.add(shape);
    yield settled;
  }
}

describe("the gates are actually being read", () => {
  it("finds the ones App.tsx declares", () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuously true — the shape this codebase keeps meeting.
    expect(GATES.size).toBeGreaterThan(20);

    expect(routeIsOpen({ inventory: true, products: true }, "/tenant/purchases", GATES)).toBe(false);
    expect(routeIsOpen({ inventory: true, products: true, purchasing: true }, "/tenant/purchases", GATES)).toBe(true);
    expect(routeIsOpen({ bank_offers: true }, "/tenant/bank-offers", GATES)).toBe(true);
    expect(routeIsOpen({}, "/tenant/bank-offers", GATES)).toBe(false);
    // Ungated: every shop has a dashboard.
    expect(routeIsOpen({}, "/tenant", GATES)).toBe(true);
  });
});

describe("the dashboard never offers a screen the shop cannot open", () => {
  it.each(shopsWorthMounting())("holds for %s", (_name, features) => {
    for (const path of linksOffered(features)) {
      expect(
        routeIsOpen(features, path, GATES),
        `the dashboard offered ${path} to a shop with ${JSON.stringify(
          Object.keys(features).filter((k) => features[k]),
        )}`,
      ).toBe(true);
    }
  });

  it("offers something, or every assertion above is vacuous", () => {
    const everything = linksOffered(settleFeatures({ ...EVERY_MODULE }));

    expect(everything).toContain("/tenant/purchases");
    expect(everything).toContain("/tenant/suppliers");
    expect(everything.length).toBeGreaterThan(4);
  });
});

/**
 * A report tab is not a route, so it cannot be checked the same way. What CAN
 * be checked is that a tab whose subject is a gated screen asks for the same
 * module that screen does — otherwise the tab is offered to a shop whose own
 * app refuses every request the tab makes.
 */
const TAB_SUBJECT: Record<string, string> = {
  purchases: "/tenant/purchases",
  "bank-claims": "/tenant/bank-offers",
  valuation: "/tenant/inventory",
  "dead-stock": "/tenant/inventory",
  // The forecourt report reads closed shifts, and its every row links back to
  // the shift it came from. A shop offered this tab must be able to open that.
  fuel: "/tenant/fuel",
};

describe("a report tab is offered only where its subject is", () => {
  it("holds for every module combination", () => {
    for (const features of everyShop()) {
      const offered = reportTabs(features).map(([key]) => key);

      for (const [tab, path] of Object.entries(TAB_SUBJECT)) {
        if (!offered.includes(tab)) continue;

        expect(
          routeIsOpen(features, path, GATES),
          `report tab "${tab}" offered to ${JSON.stringify(
            Object.keys(features).filter((k) => features[k]),
          )}, which cannot open ${path}`,
        ).toBe(true);
      }
    }
  });

  it("names a subject for every tab that has one, so a new tab is not missed", () => {
    // The escape hatch is deliberate and narrow: Overview, Margins, Staff, Tax,
    // Receipts and Offline are built out of SALES, which is not one screen
    // behind one gate. Anything else added must be classified rather than
    // silently exempt — an unlisted tab whose subject IS gated is precisely
    // the bug this file exists for.
    const SALES_SHAPED = ["overview", "margins", "staff", "tax", "receipts", "offline"];

    for (const tab of REPORT_TABS) {
      expect(
        SALES_SHAPED.includes(tab.key) || tab.key in TAB_SUBJECT,
        `report tab "${tab.key}" is neither sales-shaped nor mapped to the screen it is about`,
      ).toBe(true);
    }
  });

  it("still offers the gated tabs to a shop that has their modules", () => {
    const everything = reportTabs(settleFeatures({ ...EVERY_MODULE })).map(([key]) => key);

    for (const tab of Object.keys(TAB_SUBJECT)) expect(everything).toContain(tab);
  });
});
