import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AttentionPanel } from "./AttentionPanel";
import type { Capabilities } from "./capabilities";
import type { TenantDashboard } from "../../types";

/**
 * What needs doing.
 *
 * Every row is derived from a real figure in the payload — nothing appears "as
 * an example", and a module the shop does not run produces no row at all. The
 * empty state is a result, not a failure, so it says so instead of hiding.
 */

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    pos: true, dineIn: false, marketplace: false, delivery: false, reservations: false,
    products: true, services: false, inventory: true, expenses: true,
    sells: true, catalog: true, tracksStock: true, takesOrders: false, keepsBooks: true,
    canSell: true, businessType: "mart",
    // The owner, who holds every permission implicitly.
    visit: () => true,
    ...overrides,
  };
}

function dashboard(overrides: Partial<TenantDashboard> = {}): TenantDashboard {
  return {
    setup_completed: true,
    subscription_state: "active",
    grace_ends_at: null,
    products_count: 12,
    pending_orders: 0,
    pending_reservations: 0,
    inventory: { low_stock: 0, out_of_stock: 0, expiring_soon: 0, pending_pos: 0 },
    recent_expenses: [],
    till: { day_open: true, day_id: "d1", open_shifts: 0, banked_today: 0, unclosed_day: null, unclosed_days: 0 },
    ...overrides,
  } as TenantDashboard;
}

const draw = (data: TenantDashboard, c = caps()) =>
  render(
    <MemoryRouter>
      <AttentionPanel data={data} caps={c} />
    </MemoryRouter>,
  );

describe("a day nobody closed off", () => {
  it("is named, because nothing else in the product mentions it", () => {
    // A day left open never gets its roll-up, so the shop's record of that day
    // quietly does not exist — and by the time anyone goes looking for the
    // figure it cannot be reconstructed.
    draw(
      dashboard({
        till: { day_open: false, day_id: null, open_shifts: 0, banked_today: 0, unclosed_day: "2026-08-03", unclosed_days: 1 },
      }),
    );

    expect(screen.getByText(/was never closed off/)).toBeInTheDocument();
  });

  it("counts them when there is more than one", () => {
    draw(
      dashboard({
        till: { day_open: false, day_id: null, open_shifts: 0, banked_today: 0, unclosed_day: "2026-08-01", unclosed_days: 3 },
      }),
    );

    expect(screen.getByText("3 trading days were never closed off")).toBeInTheDocument();
  });

  it("says nothing when every day was signed off", () => {
    draw(dashboard());

    expect(screen.queryByText(/never closed off/)).not.toBeInTheDocument();
  });

  it("cannot appear for a shop with no till at all", () => {
    draw(dashboard({ till: null }), caps({ pos: false }));

    expect(screen.queryByText(/never closed off/)).not.toBeInTheDocument();
  });
});

describe("stock rows need the stock module", () => {
  const short = dashboard({
    inventory: { low_stock: 4, out_of_stock: 2, expiring_soon: 1, pending_pos: 0 },
  });

  it("a shop that tracks stock is told what is short", () => {
    draw(short);

    expect(screen.getByText("2 items are out of stock")).toBeInTheDocument();
    expect(screen.getByText("4 items are running low")).toBeInTheDocument();
    expect(screen.getByText("1 batch is expiring")).toBeInTheDocument();
  });

  it("sends the shop to the items it just counted, not to everything", () => {
    // The row states a number. Landing on the unfiltered inventory list made
    // the shopkeeper hunt a 500-row table for the badges this row counted,
    // which is why the reorder endpoint sat built and unused for two months.
    draw(short);

    const row = screen.getByText("4 items are running low").closest("a");
    expect(row).toHaveAttribute("href", "/tenant/inventory?filter=low");
  });

  it("a shop that carries no stock is told none of it", () => {
    // The figures may still be in the payload; the shop has no screen for them.
    draw(short, caps({ tracksStock: false, inventory: false }));

    expect(screen.queryByText(/out of stock/)).not.toBeInTheDocument();
    expect(screen.queryByText(/running low/)).not.toBeInTheDocument();
  });
});

/**
 * An alert is only an alert to someone who can act on it. A cashier cannot
 * restock, so "4 items are running low" arriving on their screen every day is
 * noise — but a day nobody closed off and a ticket parked at the till are
 * exactly their problem.
 */
describe("a cashier is told the counter's problems, not the stockroom's", () => {
  const cashier = caps({
    visit: (path: string) => ["/tenant/day", "/tenant/pos", "/tenant/subscription"].includes(path),
  });

  const busy = dashboard({
    inventory: { low_stock: 4, out_of_stock: 2, expiring_soon: 1, pending_pos: 3 },
    till: { day_open: false, day_id: null, open_shifts: 0, banked_today: 0, unclosed_day: "2026-08-03", unclosed_days: 1 },
  });

  it("keeps the day nobody closed and the parked tickets", () => {
    draw(busy, cashier);

    expect(screen.getByText(/was never closed off/)).toBeInTheDocument();
    expect(screen.getByText("3 parked tickets at the till")).toBeInTheDocument();
  });

  it("drops the stock rows they cannot act on", () => {
    draw(busy, cashier);

    expect(screen.queryByText("2 items are out of stock")).not.toBeInTheDocument();
    expect(screen.queryByText("4 items are running low")).not.toBeInTheDocument();
    expect(screen.queryByText("1 batch is expiring")).not.toBeInTheDocument();
  });

  it("still warns everyone about the subscription", () => {
    // Billing reaches every person in the shop, because the server gates the
    // subscription screen for nobody.
    draw(dashboard({ subscription_state: "read_only" }), cashier);

    expect(screen.getByText("Subscription expired — read-only mode")).toBeInTheDocument();
  });

  it("says nothing needs attention rather than listing what they can't do", () => {
    const quiet = dashboard({
      inventory: { low_stock: 4, out_of_stock: 2, expiring_soon: 0, pending_pos: 0 },
    });

    draw(quiet, cashier);

    expect(screen.getByText("Nothing needs your attention right now.")).toBeInTheDocument();
  });
});

describe("the empty state is a result, not a failure", () => {
  it("says so plainly rather than hiding the card", () => {
    draw(dashboard());

    expect(screen.getByText("Nothing needs your attention right now.")).toBeInTheDocument();
  });
});

describe("billing warnings outrank everything", () => {
  it("read-only mode is stated first", () => {
    draw(dashboard({ subscription_state: "read_only" }));

    expect(screen.getByText("Subscription expired — read-only mode")).toBeInTheDocument();
  });

  it("a shop mid-setup is told to finish it", () => {
    draw(dashboard({ setup_completed: false }));

    expect(screen.getByText("Shop setup is incomplete")).toBeInTheDocument();
  });
});
