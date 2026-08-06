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
    sells: true, catalog: true, tracksStock: true, takesOrders: false, keepsBooks: true,
    canSell: true, businessType: "mart",
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

  it("offers no supplier tile to a shop that carries no stock", () => {
    // A salon owes no supplier through a purchase order it cannot raise.
    draw(dashboard(), caps({ tracksStock: false, inventory: false }));

    expect(screen.queryByText("You owe")).not.toBeInTheDocument();
    expect(screen.getByText("Owed to you")).toBeInTheDocument();
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
