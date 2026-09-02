import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { OfflineReportTab } from "./OfflineReportTab";
import { offlineReportService } from "./offlineReportService";

/**
 * What happened while the shop was offline.
 *
 * The morning after a power cut an owner does not want a log — they want to
 * know whether anything is WRONG, before the shop opens. So the two things that
 * need a person come first, and the rest is reassurance:
 *
 *   sales that broke a rule  → a decision, usually chasing a customer
 *   stock below zero         → a recount, five minutes with a clipboard
 */

const report = (over: Record<string, unknown> = {}) => ({
  from: "2026-08-02T00:00:00.000Z",
  summary: {
    sales: 2,
    total: 550,
    flagged: 0,
    beyond_window: 0,
    after_close: 0,
    after_close_total: 0,
    clock_off: 0,
    shifts: 0,
    shifts_flagged: 0,
    oldest: "2026-08-14T09:00:00.000Z",
    newest: "2026-08-14T17:00:00.000Z",
  },
  sales: [
    {
      id: "s1",
      invoice_number: "INV-1043",
      offline_number: "OFF-LANE1-AB12-000007",
      sold_at: "2026-08-14T09:00:00.000Z",
      synced_at: "2026-08-14T15:00:00.000Z",
      held_hours: 6,
      total: 200,
      till: "Counter tablet",
      register: "Lane 1",
      violations: [],
      beyond_window: false,
      after_close: false,
    },
  ],
  oversold: [],
  shifts: [],
  clocks: [],
  ...over,
});

/** A shift that was opened, run and counted with no server. */
const shift = (over: Record<string, unknown> = {}) => ({
  id: "cs1",
  opened_at: "2026-08-14T04:00:00.000Z",
  synced_at: "2026-08-14T14:00:00.000Z",
  held_hours: 10,
  closed: true,
  opening_float: 3000,
  counted_cash: 8200,
  variance: 0,
  till: "Counter tablet",
  register: "Lane 1",
  cashier: "Ali",
  violations: [],
  ...over,
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

function show(data: ReturnType<typeof report>) {
  vi.spyOn(offlineReportService, "load").mockResolvedValue(envelope(data) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <OfflineReportTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("the usual day", () => {
  it("says the tills were in touch, rather than showing an empty table", async () => {
    // Most days this screen has nothing on it, and "nothing" must read as good
    // news rather than as a report that failed to load.
    show(report({ summary: { sales: 0, total: 0, flagged: 0, beyond_window: 0, after_close: 0, after_close_total: 0, clock_off: 0, shifts: 0, shifts_flagged: 0, oldest: null, newest: null }, sales: [], oversold: [], shifts: [], clocks: [] }));

    expect(await screen.findByText(/Nothing came in late/)).toBeInTheDocument();
    expect(screen.getByText(/in touch the whole time/)).toBeInTheDocument();
  });
});

describe("after a power cut", () => {
  it("leads with the reassurance when nothing needs a decision", async () => {
    show(report());

    expect(await screen.findByText(/went through cleanly/)).toBeInTheDocument();
  });

  it("says how much money came in late and that it is in the books", async () => {
    show(report());

    // Scoped to its own card: the headline sentence interpolates the same
    // figure across several text nodes, so a loose match would pass on the
    // sentence and prove nothing about the number an owner actually reads.
    expect((await screen.findByText("Value")).parentElement).toHaveTextContent("Rs 550");
    expect(screen.getByText(/against the day they actually happened/)).toBeInTheDocument();
  });

  it("shows the slip the customer is holding beside the real invoice number", async () => {
    // That slip is the only reference the customer has.
    show(report());

    expect(await screen.findByText("INV-1043")).toBeInTheDocument();
    expect(screen.getByText(/OFF-LANE1-AB12-000007/)).toBeInTheDocument();
  });

  it("says how long the till held it", async () => {
    show(report());

    expect(await screen.findByText("6 hours")).toBeInTheDocument();
  });

  it("names the till, because a fault on one is a different problem", async () => {
    show(report());

    expect(await screen.findByText(/Counter tablet/)).toBeInTheDocument();
  });
});

describe("when something needs a person", () => {
  it("changes its headline rather than burying it in a table", async () => {
    show(report({ summary: { ...report().summary, flagged: 1 } }));

    expect(await screen.findByText(/needs a look/)).toBeInTheDocument();
  });

  it("shows each reason a sale was flagged", async () => {
    show(
      report({
        summary: { ...report().summary, flagged: 1 },
        sales: [{ ...report().sales[0], violations: ["Khata needs the connection"] }],
      }),
    );

    expect(await screen.findByText("Khata needs the connection")).toBeInTheDocument();
  });

  it("marks a sale rung past the shop's window", async () => {
    show({ ...report(), sales: [{ ...report().sales[0], beyond_window: true }] });

    expect(await screen.findByText(/Past the offline window/)).toBeInTheDocument();
  });

  it("says in rupees what landed after a day was signed off", async () => {
    // The owner counted Tuesday, closed it and banked the cash; Tuesday's
    // sales then arrived. The books cannot move — a day signed off in March
    // has to read the same in September — so the AMOUNT is the whole message,
    // because an adjustment is written from a figure and not from a count.
    show(
      report({
        summary: { ...report().summary, after_close: 3, after_close_total: 12400 },
        sales: [{ ...report().sales[0], after_close: true }],
      }),
    );

    expect(await screen.findByText(/Rs 12,400 arrived after those days were closed/)).toBeInTheDocument();
    expect(screen.getByText(/After the day was closed/)).toBeInTheDocument();
  });

  it("treats it as needing a person, not as a footnote", async () => {
    // Nothing else on this screen will ever mention it. If the headline still
    // read "went through cleanly", the shortfall would be found at audit.
    show(report({ summary: { ...report().summary, after_close: 1, after_close_total: 500 } }));

    expect(await screen.findByText(/needs a look/)).toBeInTheDocument();
  });

  it("stays silent when every sale beat its close", async () => {
    // A warning that fires on an ordinary day is a warning nobody reads.
    show(report());

    expect(await screen.findByText(/went through cleanly/)).toBeInTheDocument();
    expect(screen.queryByText(/arrived after those days were closed/)).not.toBeInTheDocument();
  });

  it("lists what to count again, and says nothing here is a mistake", async () => {
    // Two tills with no connection can each sell the last one and both are
    // telling the truth. Calling it an error would send an owner looking for
    // somebody to blame instead of for a clipboard.
    show(
      report({
        oversold: [{ product: "Milkpak 1L", sku: "MLK", branch: "Main", quantity: -2 }],
      }),
    );

    expect(await screen.findByText("Count these again")).toBeInTheDocument();
    expect(screen.getByText(/both are telling the/)).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
  });

  it("counts the recounts beside the sales, so neither hides the other", async () => {
    show(
      report({
        oversold: [
          { product: "A", sku: null, branch: "Main", quantity: -1 },
          { product: "B", sku: null, branch: "Main", quantity: -3 },
        ],
      }),
    );

    expect(await screen.findByText("Need a recount")).toBeInTheDocument();
    expect(screen.getByText("Need a recount").parentElement).toHaveTextContent("2");
  });
});

describe("when it cannot be read", () => {
  it("says so rather than looking like a quiet day", async () => {
    // The dangerous confusion on this screen: a failure that renders as
    // "nothing came in late" would tell an owner everything was fine.
    vi.spyOn(offlineReportService, "load").mockRejectedValue(new Error("nope"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OfflineReportTab />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Couldn't load this report/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing came in late/)).toBeNull();
  });
});

describe("the shifts that ran with no server", () => {
  const quiet = { sales: 0, total: 0, flagged: 0, beyond_window: 0, after_close: 0, after_close_total: 0, clock_off: 0, shifts: 1, shifts_flagged: 0, oldest: null, newest: null };

  it("names the cashier, the lane and the tablet it arrived from", async () => {
    // A different tablet from the one in the sales table on purpose: the queue
    // lives on the DEVICE, so a shift can arrive from a tablet that rang
    // nothing, and the owner walks over to that one.
    show(report({ shifts: [shift({ till: "Stockroom tablet" })] }));

    expect(await screen.findByText("Ali")).toBeInTheDocument();
    expect(screen.getByText("Lane 1")).toBeInTheDocument();
    expect(screen.getByText("Stockroom tablet")).toBeInTheDocument();
  });

  it("shows each rule the shift broke by existing", async () => {
    // Recorded and never corrected, because a counted drawer cannot be left
    // belonging to nothing. This row is the only place an owner learns of it.
    show(
      report({
        summary: { ...report().summary, shifts: 1, shifts_flagged: 1 },
        shifts: [shift({ violations: ["Lane 1 already had an open shift (Sana)."] })],
      }),
    );

    expect(await screen.findByText(/already had an open shift/)).toBeInTheDocument();
    expect(screen.getByText(/needs a look/)).toBeInTheDocument();
  });

  it("counts a flagged shift in the decisions tile beside the sales", async () => {
    // A 0 there beside a flagged shift below is the screen contradicting
    // itself, which is worse than not showing shifts at all.
    show(
      report({
        summary: { ...report().summary, flagged: 1, shifts: 1, shifts_flagged: 1 },
        shifts: [shift({ violations: ["This cashier already had an open shift."] })],
      }),
    );

    const tile = (await screen.findByText("Need a decision")).parentElement;
    expect(tile).toHaveTextContent("2");
  });

  it("says when a drawer that arrived has still not been counted", async () => {
    show(
      report({
        summary: { ...report().summary, shifts: 1 },
        shifts: [shift({ closed: false, counted_cash: null, variance: null })],
      }),
    );

    expect(await screen.findByText(/nobody has counted this drawer/)).toBeInTheDocument();
    // Uncounted money is a decision, so the headline must not read "cleanly".
    expect(screen.getByText(/needs a look/)).toBeInTheDocument();
  });

  it("does not read as a quiet day when the only thing that happened was a shift", async () => {
    // "Nothing came in late" over a shift opened on a lane somebody else held
    // is the report telling an owner the opposite of what it knows.
    show(report({ summary: quiet, sales: [], shifts: [shift()] }));

    expect(await screen.findByText(/No sales were rung out of contact/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing came in late/)).not.toBeInTheDocument();
  });
});

describe("tills with the wrong time", () => {
  it("names the tablet, how far out it is and which way", async () => {
    // Signed on purpose: BEHIND files sales into days already banked, AHEAD
    // into a day nobody has traded yet. One row per tablet, because the unit
    // of the fix is the tablet and not the forty sales it produced.
    show(report({ clocks: [{ till: "Counter tablet", sales: 40, skew_seconds: 3 * 86400 }] }));

    expect(await screen.findByText("3 days behind")).toBeInTheDocument();
    expect(screen.getByText("40 sales")).toBeInTheDocument();
  });

  it("reads ahead rather than hiding the sign", async () => {
    show(report({ clocks: [{ till: "Lane 2", sales: 3, skew_seconds: -7200 }] }));

    expect(await screen.findByText("2 hr ahead")).toBeInTheDocument();
  });

  it("says the books are fine and the tablet is not", async () => {
    show(report({ clocks: [{ till: "Lane 2", sales: 3, skew_seconds: -7200 }] }));

    expect(await screen.findByText(/Nothing in your books is wrong/)).toBeInTheDocument();
  });
});
