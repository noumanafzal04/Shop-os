import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KpiRow } from "./KpiRow";
import type { Capabilities } from "./capabilities";
import type { PeriodTold } from "../../period";
import type { SeriesDay, ShopFigures, TenantDashboard } from "../../types";

/**
 * The top strip: which figures it shows, whose they are, and what they are called.
 *
 * ── The money it is allowed to leave out ───────────────────────────────
 *
 * A books-only tenant (Finance Manager) earns through Income rows, not sales.
 * This strip used to be money OUT only, so the entire earning side of the
 * business was missing from its own dashboard, and the `profit` the server
 * sent alongside was revenue − cost − expenses with no term for income at
 * all: a permanent loss the size of the rent.
 *
 * ── The period it is about ─────────────────────────────────────────────
 *
 * The dashboard is asked about a period now. Every tile here that is a flow
 * must show THAT period's figure and be named for it — the failure this
 * stands against is a tile still reading "Today's Sales" over last month.
 * So every fixture below carries a `today` that DISAGREES with its `period`,
 * and a test that passes by reading the wrong one cannot pass.
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

const selling = caps({ sells: true, pos: true, canSell: true, products: true, businessType: "mart" });

const NOTHING: ShopFigures = {
  sales_count: 0, revenue: 0, other_income: 0, refunds: 0, expenses: 0, profit: 0, customers_count: 0,
  deltas: { revenue: null, expenses: null, profit: null },
};

/** Friday 9 October 2026 is "today" throughout. */
function told(from: string, to: string, compared: [string, string], bucket: PeriodTold["series"]["bucket"] = "day"): PeriodTold {
  return {
    from, to,
    days: Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1,
    compared_from: compared[0], compared_to: compared[1],
    today: "2026-10-09", asked: true,
    series: { from, to, bucket },
  };
}

const TODAY = told("2026-10-09", "2026-10-09", ["2026-10-08", "2026-10-08"]);
const YESTERDAY = told("2026-10-08", "2026-10-08", ["2026-10-07", "2026-10-07"]);
const THIS_MONTH = told("2026-10-01", "2026-10-09", ["2026-09-01", "2026-09-09"]);
const SEPTEMBER = told("2026-09-01", "2026-09-30", ["2026-08-01", "2026-08-31"]);

const points = (n: number, of: Partial<SeriesDay> = {}): SeriesDay[] =>
  Array.from({ length: n }, (_, i) => ({
    day: `${i + 1}`, date: `2026-10-${`${i + 1}`.padStart(2, "0")}`,
    revenue: 100, other_income: 100, refunds: 0, expenses: 10, profit: 90, ...of,
  }));

function dashboard(period: PeriodTold, figures: Partial<ShopFigures>, overrides: Partial<TenantDashboard> = {}): TenantDashboard {
  return {
    // TODAY always disagrees with the period, on every figure.
    today: { ...NOTHING, sales_count: 7, revenue: 1111, other_income: 2222, expenses: 3333, profit: 4444, customers_count: 5 },
    period: { ...period, ...NOTHING, ...figures },
    expense_breakdown: [{ category: "Rent", total: 80000 }],
    sales_series: points(period.days === 1 ? 7 : period.days),
    ...overrides,
  } as TenantDashboard;
}

const draw = (data: TenantDashboard, c: Capabilities, compact = false) =>
  render(<KpiRow data={data} caps={c} money={money} compact={compact} />);

const BOOKS = { other_income: 300000, expenses: 80000, profit: 220000 };

describe("a books-only business is shown what it earned, not only what it spent", () => {
  it("names money in, money out and the net — for the period, with no day in the name", () => {
    draw(dashboard(THIS_MONTH, BOOKS), caps());

    expect(screen.getByText("Money In")).toBeInTheDocument();
    expect(screen.getByText("Money Out")).toBeInTheDocument();
    expect(screen.getByText("Net")).toBeInTheDocument();
  });

  it("names them for the day when the period IS a day", () => {
    draw(dashboard(TODAY, BOOKS), caps());

    expect(screen.getByText("Money In Today")).toBeInTheDocument();
    expect(screen.getByText("Money Out Today")).toBeInTheDocument();
    expect(screen.getByText("Net Today")).toBeInTheDocument();
  });

  it("prints the period's figures, income included — and not today's", () => {
    draw(dashboard(THIS_MONTH, BOOKS), caps());

    expect(screen.getByText("Rs 300,000")).toBeInTheDocument();
    // Money out, and the one category it all went on.
    expect(screen.getAllByText("Rs 80,000")).toHaveLength(2);
    expect(screen.getByText("Rs 220,000")).toBeInTheDocument();
    for (const todays of ["Rs 2,222", "Rs 3,333", "Rs 4,444"]) {
      expect(screen.queryByText(todays), `${todays} is today's, and the month was asked`).not.toBeInTheDocument();
    }
  });

  it("says what went out once, not twice under two names", () => {
    draw(dashboard(THIS_MONTH, BOOKS), caps());

    expect(screen.queryByText("Expenses")).not.toBeInTheDocument();
  });

  it("offers no sales tiles, because there are no sales", () => {
    draw(dashboard(THIS_MONTH, BOOKS), caps());

    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Orders")).not.toBeInTheDocument();
    expect(screen.queryByText("Customers")).not.toBeInTheDocument();
  });

  it("a loss still reads as a loss — income is added, never assumed", () => {
    draw(dashboard(THIS_MONTH, { other_income: 0, expenses: 80000, profit: -80000 }), caps());

    expect(screen.getByText("Rs -80,000")).toBeInTheDocument();
  });

  it("keeps the calm view to the three that are the question", () => {
    draw(dashboard(THIS_MONTH, BOOKS), caps(), true);

    expect(screen.queryByText("Biggest Category")).not.toBeInTheDocument();
    expect(screen.getByText("Net")).toBeInTheDocument();
  });
});

describe("a shop that sells keeps its own strip", () => {
  const TRADE = { sales_count: 37, revenue: 48200, expenses: 3500, profit: 9100, customers_count: 31 };

  it("leads with today's sales and profit, in the words it always has", () => {
    draw(dashboard(TODAY, TRADE), selling);

    expect(screen.getByText("Today's Sales")).toBeInTheDocument();
    expect(screen.getByText("Today's Profit")).toBeInTheDocument();
    expect(screen.getByText("Orders Today")).toBeInTheDocument();
    expect(screen.getByText("Shoppers Today")).toBeInTheDocument();
    // The books-only strip must not leak into a shop's dashboard.
    expect(screen.queryByText("Money In Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Net Today")).not.toBeInTheDocument();
  });

  it("says Yesterday when that is what it is showing", () => {
    draw(dashboard(YESTERDAY, TRADE), selling);

    expect(screen.getByText("Yesterday's Sales")).toBeInTheDocument();
    expect(screen.getByText("Yesterday's Expenses")).toBeInTheDocument();
    expect(screen.getByText("Orders Yesterday")).toBeInTheDocument();
    expect(screen.queryByText(/today/i)).not.toBeInTheDocument();
  });

  it("never says Today over a month's figures", () => {
    draw(dashboard(THIS_MONTH, TRADE), selling);

    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Profit")).toBeInTheDocument();
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Shoppers")).toBeInTheDocument();
    expect(screen.queryByText(/today/i)).not.toBeInTheDocument();
  });

  it("shows the period's figures, not today's", () => {
    draw(dashboard(THIS_MONTH, TRADE), selling);

    expect(screen.getByText("Rs 48,200")).toBeInTheDocument();
    expect(screen.getByText("Rs 9,100")).toBeInTheDocument();
    expect(screen.getByText("37")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.queryByText("Rs 1,111"), "today's sales, under a month").not.toBeInTheDocument();
    expect(screen.queryByText("7"), "today's count, under a month").not.toBeInTheDocument();
  });

  it("says what a pill is a percentage of", () => {
    draw(dashboard(THIS_MONTH, { ...TRADE, deltas: { revenue: 12.5, expenses: null, profit: null } }), selling);
    expect(screen.getByTitle("Compared with 1 – 9 Sep")).toBeInTheDocument();
  });

  it("says yesterday when that is what today is set against", () => {
    draw(dashboard(TODAY, { ...TRADE, deltas: { revenue: 12.5, expenses: null, profit: null } }), selling);
    expect(screen.getByTitle("Compared with yesterday")).toBeInTheDocument();
  });

  it("only owns up to a refund when there was one in the period", () => {
    draw(dashboard(THIS_MONTH, TRADE), selling);
    expect(screen.queryByText("Refunded")).not.toBeInTheDocument();
  });

  it("names the refund for the period too", () => {
    draw(dashboard(THIS_MONTH, { ...TRADE, refunds: 900 }), selling);
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.getByText("Rs 900")).toBeInTheDocument();
  });

  it("shows expenses only when the shop keeps books", () => {
    draw(dashboard(TODAY, TRADE), caps({ sells: true, pos: true, canSell: true, keepsBooks: false, expenses: false }));

    expect(screen.queryByText("Today's Expenses")).not.toBeInTheDocument();
  });
});

describe("the bars behind the leading figure say what they are", () => {
  /** The bars of the filled card. */
  const bars = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("span[aria-hidden] > span[style]"));

  it("one day: the seven that led to it, the day itself solid", () => {
    const { container } = draw(dashboard(TODAY, { revenue: 100 }), selling);

    expect(screen.getByText("Last seven days — today solid")).toBeInTheDocument();
    expect(bars(container)).toHaveLength(7);
    expect(bars(container).filter((b) => b.className.includes("bg-white/35"))).toHaveLength(6);
  });

  it("yesterday is not called today under its own bars", () => {
    draw(dashboard(YESTERDAY, { revenue: 100 }), selling);

    expect(screen.getByText("The seven days up to it — this day solid")).toBeInTheDocument();
  });

  it("a run of days: every bar is part of the figure, so none stands out", () => {
    const { container } = draw(dashboard(THIS_MONTH, { revenue: 900 }), selling);

    expect(screen.getByText("Each bar a day")).toBeInTheDocument();
    expect(bars(container)).toHaveLength(9);
    // One bright bar at the end would say the month was its last day.
    expect(bars(container).filter((b) => b.className.includes("bg-white/80"))).toHaveLength(9);
  });

  it("a month has more days than there is room for, and says how many a bar is", () => {
    const { container } = draw(dashboard(SEPTEMBER, { revenue: 3000 }), selling);

    // Thirty points, fourteen bars at most: three days to a bar, ten bars.
    expect(screen.getByText("Each bar 3 days")).toBeInTheDocument();
    expect(bars(container)).toHaveLength(10);
  });

  it("a year drawn a month at a time says so", () => {
    const year = told("2026-01-01", "2026-10-09", ["2025-01-01", "2025-10-09"], "month");
    draw(dashboard(year, { revenue: 1000 }, { sales_series: points(10) }), selling);

    expect(screen.getByText("Each bar a month")).toBeInTheDocument();
  });
});
