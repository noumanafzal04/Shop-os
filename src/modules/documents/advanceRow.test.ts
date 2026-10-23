import { describe, expect, it } from "vitest";

import { advanceRow, handedBackBy } from "./advanceRow";

const now = new Date("2026-10-15T10:00:00Z");
const row = (over: Record<string, unknown>) =>
  advanceRow({ total: "5000.00", deposit_paid: "1000.00", status: "open", expires_at: "2026-11-01", last_paid_at: "2026-10-10T10:00:00Z", ...over } as never, now);

describe("one advance, as the counter reads it", () => {
  it("says what is paid, what is left, and how far along", () => {
    expect(row({})).toMatchObject({ paid: 1000, left: 4000, share: 0.2, state: "open", quiet: false });
  });

  it("is paid up — hand it over — when nothing is left, whatever the date", () => {
    expect(row({ deposit_paid: "5000.00", expires_at: "2026-09-01" })).toMatchObject({ left: 0, share: 1, state: "paid_up", quiet: false });
  });

  it("is overdue past its collect-by date, and quiet after 30 days with nothing paid in", () => {
    expect(row({ expires_at: "2026-10-14" }).state).toBe("overdue");
    expect(row({ last_paid_at: "2026-09-10T10:00:00Z" }).quiet).toBe(true);
    expect(row({ last_paid_at: "2026-09-20T10:00:00Z" }).quiet).toBe(false);
  });

  it("is collected or cancelled once it is no longer open", () => {
    expect(row({ status: "converted" }).state).toBe("collected");
    expect(row({ status: "cancelled", last_paid_at: "2026-01-01T00:00:00Z" })).toMatchObject({ state: "cancelled", quiet: false });
  });
});

describe("how a cancelled advance goes back (next rounds #18)", () => {
  it("starts from the way the money came in, and from cash when nothing says", () => {
    expect(handedBackBy([{ method: "card" }, { method: "cash" }])).toBe("card");
    expect(handedBackBy([{ method: "wallet" }])).toBe("wallet");
    expect(handedBackBy([])).toBe("cash");
    expect(handedBackBy(undefined)).toBe("cash");
    // Not a way the counter hands money back: cash, not a guess.
    expect(handedBackBy([{ method: "credit" }])).toBe("cash");
  });
});
