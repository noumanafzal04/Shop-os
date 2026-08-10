import { describe, expect, it } from "vitest";

import { shopNav } from "./AppSidebar";

/**
 * What each job preset can actually SEE, per trade.
 *
 * The rail is filtered on two axes and the second one is easy to believe is
 * working: modules decide which screens exist for the shop, `canVisit` decides
 * which of those this person may open. Both run. The gap is what a permission
 * MEANS — `sales.manage` is "may ring a sale", and it is also the key to the
 * sales ledger, the day's banking, quotes and advances, the chemist's register
 * and the warranty desk. So a kitchen hand holding nothing but `sales.manage`
 * is offered the shop's takings.
 *
 * These tests pin what each preset is offered so that widening a permission set
 * cannot quietly widen the rail. They assert on the LIST, not a count: a count
 * says something changed, and the whole question here is what.
 */

/** Mirrors App\Support\StaffPresets — kept in step by PresetCanDoItsJobTest. */
const PRESETS: Record<string, string[]> = {
  waiter: ["sales.manage", "customers.manage"],
  kitchen: ["kitchen.manage"],
  cashier: ["sales.manage", "discounts.apply", "customers.manage", "tables.serve_any"],
  stock: ["inventory.manage", "products.manage"],
  bookkeeper: ["expenses.manage"],
};

/** The module set each trade is sold with, trimmed to what the rail reads. */
const TRADES: Record<string, Record<string, boolean>> = {
  food: { pos: true, dine_in: true, products: true, expenses: true },
  mart: { pos: true, products: true, inventory: true, expenses: true },
  pharmacy: { pos: true, products: true, inventory: true, expenses: true },
  retail: { pos: true, products: true, inventory: true, expenses: true },
  services: { pos: true, services: true, expenses: true },
  finance: { expenses: true },
};

function pathsFor(trade: string, preset: string): string[] {
  const permissions = PRESETS[preset];
  const can = (permission: string) => permissions.includes(permission);
  const items = shopNav(TRADES[trade], trade, "advanced", false, can);

  // NavItem is not exported, so the shape is described locally — only the two
  // fields this test walks.
  type Node = { path?: string; subItems?: Node[] };

  const out: string[] = [];
  const walk = (list: Node[]) => {
    for (const item of list) {
      if (item.path !== undefined) out.push(item.path);
      if (item.subItems) walk(item.subItems);
    }
  };
  walk(items as Node[]);

  // The dashboard is everyone's home and can never be gated — it is the
  // redirect target when a gate refuses.
  return out.filter((p) => p !== "/tenant").sort();
}

describe("what a job preset is offered", () => {
  it("a kitchen hand is not offered the shop's money", () => {
    const seen = pathsFor("food", "kitchen");

    // What the job needs.
    expect(seen).toContain("/tenant/kitchen");

    // What it does not. Each of these is a real screen of trading figures, and
    // `sales.manage` — the permission that lets someone mark a curry ready —
    // is currently the only thing standing in front of them.
    expect(seen).not.toContain("/tenant/sales");
    expect(seen).not.toContain("/tenant/day");
    expect(seen).not.toContain("/tenant/documents");
  });

  it("a waiter is offered the floor, the till, and — for now — the ledger", () => {
    const seen = pathsFor("food", "waiter");

    expect(seen).toContain("/tenant/dine-in");

    // OPEN QUESTION, pinned as it stands so a change is deliberate rather than
    // accidental. A waiter settles bills, so they hold sales.manage, and that
    // key also opens the shop's whole sales history and the day's banking.
    //
    // Unlike the kitchen board this is NOT clear-cut: /tenant/day is documented
    // as intentional for till staff — a cashier is entitled to the record of
    // their own drawer — and a cashier looking up this morning's sale to
    // reprint a receipt is a real counter job, so raising the bar to
    // reports.view would take a working screen off them too.
    expect(seen).toContain("/tenant/sales");
    expect(seen).toContain("/tenant/day");
  });

  it("a bookkeeper is offered the books and nothing that sells", () => {
    const seen = pathsFor("mart", "bookkeeper");

    expect(seen).toContain("/tenant/expenses");
    expect(seen).not.toContain("/tenant/pos");
    expect(seen).not.toContain("/tenant/sales");
  });

  it("a stock keeper is offered the shelf, not the takings", () => {
    const seen = pathsFor("mart", "stock");

    expect(seen).not.toContain("/tenant/pos");
    expect(seen).not.toContain("/tenant/day");
  });

  it("no preset is offered a screen in a trade that has no such module", () => {
    // The other axis, checked across every trade at once: a rail must never
    // offer a screen the shop did not buy, whoever is looking at it.
    for (const trade of Object.keys(TRADES)) {
      for (const preset of Object.keys(PRESETS)) {
        const seen = pathsFor(trade, preset);

        if (!TRADES[trade].dine_in) {
          expect(seen, `${trade}/${preset}`).not.toContain("/tenant/dine-in");
          expect(seen, `${trade}/${preset}`).not.toContain("/tenant/kitchen");
        }
        if (!TRADES[trade].pos) {
          expect(seen, `${trade}/${preset}`).not.toContain("/tenant/pos");
        }
        if (!TRADES[trade].inventory) {
          expect(seen, `${trade}/${preset}`).not.toContain("/tenant/purchases");
        }
      }
    }
  });
});
