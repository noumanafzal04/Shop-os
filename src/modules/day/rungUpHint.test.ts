import { describe, expect, it } from "vitest";

import { rungUpHint } from "./rungUpHint";

describe("what the day's takings are made of", () => {
  it("says how many no drawer took", () => {
    expect(rungUpHint({ sales_count: 8, away_from_drawers: { sales_count: 2, sales_total: 8890 } })).toBe("8 sales · 2 not at a counter");
  });

  it("says nothing extra when every sale was at a counter", () => {
    expect(rungUpHint({ sales_count: 1, away_from_drawers: { sales_count: 0, sales_total: 0 } })).toBe("1 sale");
    expect(rungUpHint({ sales_count: 3 })).toBe("3 sales");
  });
});
