import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiRow } from "./KpiRow";
import type { Capabilities } from "./capabilities";
import type { TenantDashboard } from "../../types";

/**
 * The top strip, and the money it is allowed to leave out.
 *
 * A books-only tenant (Finance Manager) earns through Income rows, not sales.
 * This strip used to be money OUT only — Spent This Month, Spent Last 7 Days,
 * Biggest Category — so the entire earning side of the business was missing
 * from its own dashboard, and the `profit` the server sent alongside was
 * revenue − cost − expenses with no term for income at all: a permanent loss
 * the size of the rent.
 *
 * A selling shop keeps its own shape. Non-sale income is real for them too
 * (an owner's injection, a supplier refund) but it is not what they sell, so it
 * belongs in profit without being called revenue.
 */

const money = (n: number | string) => `Rs ${Number(n).toLocaleString()}`;

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    pos: false, dineIn: false, marketplace: false, delivery: false, reservations: false,
    products: false, services: false, inventory: false, expenses: true,
    sells: false, catalog: false, tracksStock: false, buysFromSuppliers: false, takesOrders: false, keepsBooks: true, keepsCustomers: true,
    canSell: false, businessType: "finance",
    visit: () => true,
    ...overrides,
  };
}

function dashboard(overrides: Partial<TenantDashboard> = {}): TenantDashboard {
  return {
    today: {
      sales_count: 0, revenue: 0, other_income: 300000, expenses: 80000, profit: 220000,
      customers_count: 0,
      deltas: { revenue: null, expenses: null, profit: null },
    },
    expense_breakdown: [{ category: "Rent", total: 80000 }],
    sales_series: [
      { day: "Mon", date: "2026-08-01", revenue: 0, other_income: 300000, expenses: 80000, profit: 220000 },
    ],
    ...overrides,
  } as TenantDashboard;
}

const draw = (data: TenantDashboard, c: Capabilities) =>
  render(<KpiRow data={data} caps={c} money={money} />);

describe("a books-only business is shown what it earned, not only what it spent", () => {
  it("names money in, money out and the net", () => {
    draw(dashboard(), caps());

    expect(screen.getByText("Money In Today")).toBeInTheDocument();
    expect(screen.getByText("Spent This Month")).toBeInTheDocument();
    expect(screen.getByText("Net Today")).toBeInTheDocument();
  });

  it("prints the figures the server sent, income included", () => {
    draw(dashboard(), caps());

    // Each figure lands on more than one tile (today and the 7-day roll-up
    // both read 300,000 here), so assert it is drawn rather than how often.
    expect(screen.getAllByText("Rs 300,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Rs 80,000").length).toBeGreaterThan(0);
    expect(screen.getByText("Rs 220,000")).toBeInTheDocument();
  });

  it("offers no sales tiles, because there are no sales", () => {
    draw(dashboard(), caps());

    expect(screen.queryByText("Today's Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Orders Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Customers Today")).not.toBeInTheDocument();
  });

  it("a loss still reads as a loss — income is added, never assumed", () => {
    draw(
      dashboard({
        today: {
          sales_count: 0, revenue: 0, other_income: 0, expenses: 80000, profit: -80000,
          customers_count: 0,
          deltas: { revenue: null, expenses: null, profit: null },
        },
      } as Partial<TenantDashboard>),
      caps(),
    );

    expect(screen.getByText("Rs -80,000")).toBeInTheDocument();
  });
});

describe("a shop that sells keeps its own strip", () => {
  const selling = caps({ sells: true, pos: true, canSell: true, products: true, businessType: "mart" });

  it("still leads with sales and profit", () => {
    draw(dashboard(), selling);

    expect(screen.getByText("Today's Sales")).toBeInTheDocument();
    expect(screen.getByText("Today's Profit")).toBeInTheDocument();
    // The books-only strip must not leak into a shop's dashboard.
    expect(screen.queryByText("Money In Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Net Today")).not.toBeInTheDocument();
  });

  it("shows expenses only when the shop keeps books", () => {
    draw(dashboard(), caps({ sells: true, pos: true, canSell: true, keepsBooks: false, expenses: false }));

    expect(screen.queryByText("Today's Expenses")).not.toBeInTheDocument();
  });
});
