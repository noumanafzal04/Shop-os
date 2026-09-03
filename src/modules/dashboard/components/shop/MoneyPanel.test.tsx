import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { MoneyPanel, hasMoneyPanel } from "./MoneyPanel";
import type { Capabilities } from "./capabilities";
import type { TenantDashboard } from "../../types";

/**
 * The shop's cash position.
 *
 * Two rules worth holding: a shop is never shown a tile for a module it does
 * not have, and a books-only business gets no card at all rather than a row of
 * honest zeroes.
 */

const money = (n: number) => `Rs ${n.toLocaleString()}`;

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    pos: true, dineIn: false, marketplace: false, delivery: false, reservations: false,
    products: true, services: false, inventory: true, expenses: true,
    sells: true, catalog: true, tracksStock: true, buysFromSuppliers: true, takesOrders: false, keepsBooks: true, keepsCustomers: true,
    canSell: true, businessType: "mart",
    // The owner, who holds every permission implicitly.
    visit: () => true,
    ...overrides,
  };
}

function dashboard(overrides: Partial<TenantDashboard> = {}): TenantDashboard {
  return {
    branch_scope: null,
    money_owed: { receivable: { total: 4000, accounts: 2 }, payable: { total: 30000, accounts: 1 } },
    till: { day_open: true, day_id: "d1", open_shifts: 2, banked_today: 3000, unclosed_day: null, unclosed_days: 0 },
    ...overrides,
  } as TenantDashboard;
}

const draw = (data: TenantDashboard, c: Capabilities) =>
  render(
    <MemoryRouter>
      <MoneyPanel data={data} caps={c} money={money} />
    </MemoryRouter>,
  );

describe("who owes whom", () => {
  it("shows khata out on account and what suppliers are owed", () => {
    draw(dashboard(), caps());

    expect(screen.getByText("Rs 4,000")).toBeInTheDocument();
    expect(screen.getByText("2 accounts on khata")).toBeInTheDocument();
    expect(screen.getByText("Rs 30,000")).toBeInTheDocument();
    expect(screen.getByText("1 supplier waiting")).toBeInTheDocument();
  });

  it("says so plainly when nothing is outstanding", () => {
    draw(
      dashboard({ money_owed: { receivable: { total: 0, accounts: 0 }, payable: { total: 0, accounts: 0 } } }),
      caps(),
    );

    expect(screen.getByText("nothing out on khata")).toBeInTheDocument();
    expect(screen.getByText("all suppliers settled")).toBeInTheDocument();
  });

  it("offers no supplier tile to a shop that keeps no supplier book", () => {
    // A salon owes no supplier through a purchase order it cannot raise.
    draw(dashboard(), caps({ tracksStock: false, inventory: false, buysFromSuppliers: false }));

    expect(screen.queryByText("You owe")).not.toBeInTheDocument();
    expect(screen.getByText("Owed to you")).toBeInTheDocument();
  });

  it("nor to a shop that counts its shelves and buys over the counter", () => {
    // The tile used to follow the STOCK module, and /tenant/suppliers is gated
    // on purchasing — so this shop was shown what it owed and then refused the
    // screen the tile links to. Stock on, supplier book off, no tile.
    draw(dashboard(), caps({ tracksStock: true, inventory: true, buysFromSuppliers: false }));

    expect(screen.queryByText("You owe")).not.toBeInTheDocument();
  });
});

describe("the trading day", () => {
  it("names how many tills are still selling", () => {
    draw(dashboard(), caps());

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("2 shifts still on the till")).toBeInTheDocument();
  });

  it("distinguishes a counted-out day from one that never started", () => {
    draw(
      dashboard({
        till: { day_open: true, day_id: "d1", open_shifts: 0, banked_today: 0, unclosed_day: null, unclosed_days: 0 },
      }),
      caps(),
    );

    expect(screen.getByText("every shift counted out")).toBeInTheDocument();
  });

  it("tells an online-only shop nothing about a till it does not have", () => {
    draw(dashboard({ till: null }), caps({ pos: false }));

    expect(screen.queryByText("Trading day")).not.toBeInTheDocument();
    expect(screen.queryByText("Banked today")).not.toBeInTheDocument();
  });
});

/**
 * The dashboard is an offer to go somewhere, so it follows the same rule the
 * sidebar does: a tile is drawn only when the person can open the screen
 * behind it. In practice that makes the shop's total khata and its supplier
 * dues the OWNER's figures — a cashier needs one customer's balance, which
 * the till already gives them, not the shop's whole position.
 */
describe("a cashier is offered only what a cashier can open", () => {
  // Everything a shop with one till and a stockroom would have.
  const cashier = (allowed: string[]) =>
    caps({ visit: (path: string) => allowed.includes(path) });

  const TILL_ONLY = ["/tenant/day", "/tenant/pos", "/tenant/sales"];

  it("keeps the drawer and drops the owner's money", () => {
    draw(dashboard(), cashier(TILL_ONLY));

    // Their own day, which they are entitled to.
    expect(screen.getByText("Trading day")).toBeInTheDocument();
    expect(screen.getByText("Banked today")).toBeInTheDocument();

    // Not their business, and not screens they can open.
    expect(screen.queryByText("Owed to you")).not.toBeInTheDocument();
    expect(screen.queryByText("You owe")).not.toBeInTheDocument();
    expect(screen.queryByText("Rs 4,000")).not.toBeInTheDocument();
    expect(screen.queryByText("Rs 30,000")).not.toBeInTheDocument();
  });

  it("withholds the whole card from someone who can open none of it", () => {
    // A stock-keeper: no till, no CRM, no supplier ledger.
    const stockOnly = caps({ visit: (path: string) => path === "/tenant/inventory" });

    expect(hasMoneyPanel(dashboard(), stockOnly)).toBe(false);
  });

  it("still draws every tile for the owner", () => {
    draw(dashboard(), caps());

    expect(screen.getByText("Owed to you")).toBeInTheDocument();
    expect(screen.getByText("You owe")).toBeInTheDocument();
    expect(screen.getByText("Trading day")).toBeInTheDocument();
  });
});

describe("the card appears only when it has something to say", () => {
  it("is drawn for a shop with a till", () => {
    expect(hasMoneyPanel(dashboard(), caps())).toBe(true);
  });

  it("is drawn for a shop that is owed money", () => {
    const data = dashboard({
      till: null,
      money_owed: { receivable: { total: 500, accounts: 1 }, payable: { total: 0, accounts: 0 } },
    });

    expect(hasMoneyPanel(data, caps({ pos: false }))).toBe(true);
  });

  it("is withheld from a books-only shop rather than shown as zeroes", () => {
    // Finance Manager: sells nothing, stocks nothing, has no till. A row of
    // honest zeroes is still noise.
    const data = dashboard({
      till: null,
      money_owed: { receivable: { total: 0, accounts: 0 }, payable: { total: 0, accounts: 0 } },
    });

    const booksOnly = caps({
      pos: false, products: false, inventory: false, sells: false,
      catalog: false, tracksStock: false, canSell: false, businessType: "finance",
    });

    expect(hasMoneyPanel(data, booksOnly)).toBe(false);
  });
});
