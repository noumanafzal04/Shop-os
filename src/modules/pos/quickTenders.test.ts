import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { quickTendersFor } from "./quickTenders";

const AED = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25];
const PKR = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

describe("the amounts offered beside Exact (#AZ13)", () => {
  it("AED 99.75 is offered the note a customer hands over — 100 — and no AED 5,000", () => {
    expect(quickTendersFor(99.75, AED)).toEqual([99.75, 100, 200, 500]);
  });

  it("a rupee bill of 99.75 is offered Rs 100, 500 and 1,000", () => {
    expect(quickTendersFor(99.75, PKR)).toEqual([99.75, 100, 500, 1000]);
  });

  it("a rupee bill of 1,238.15 keeps the amounts a counter knows", () => {
    expect(quickTendersFor(1238.15, PKR)).toEqual([1238.15, 1500, 2000, 5000]);
  });

  it("never offers a note the shop does not have", () => {
    for (const v of quickTendersFor(99.75, AED).slice(1)) {
      expect(AED.some((n) => Number.isInteger(Math.round((v / n) * 1e6) / 1e6))).toBe(true);
    }
    expect(quickTendersFor(99.75, AED)).not.toContain(5000);
  });

  it("a bill bigger than every note still gets the next amounts up", () => {
    expect(quickTendersFor(5600, PKR)).toEqual([5600, 6000, 10000]);
  });

  it("nothing to pay is nothing to offer", () => {
    expect(quickTendersFor(0, PKR)).toEqual([]);
  });

  it("the till reads the shop's own notes", () => {
    const till = readFileSync(resolve(__dirname, "pages/PosPage.tsx"), "utf8");

    expect(till).toMatch(/quickTendersFor\(payable, currency\.cash\)/);
    expect(till).not.toMatch(/Math\.ceil\(payable \/ 5000\) \* 5000/);
  });
});
