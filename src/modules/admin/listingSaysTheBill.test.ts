import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE LISTING SAYS WHAT A SHOP IS BILLED (the user, 2026-10-27).
 *
 * The row printed the plan's price only — 4,999 for a shop billed 5,699 with
 * its add-ons — although `package.bill` was on the row all along. And "Paid"
 * held 26 shops that had never paid; they have a bucket of their own.
 */
const page = readFileSync(resolve(__dirname, "pages/AdminTenantsPage.tsx"), "utf8");

describe("the businesses list", () => {
  it("prints the whole bill, and the split when there are add-ons", () => {
    expect(page).toMatch(/platformMoney\(t\.package\.bill\.total\)/);
    expect(page).toMatch(/t\.package\.bill\.addons_monthly > 0/);
    expect(page).not.toMatch(/Rs \{Number\(t\.plan\.price\)/);
  });

  it("offers the not-paid-yet bucket beside Paid", () => {
    expect(page).toMatch(/\{ value: "paid", label: "Paid" \},[\s\S]*?\{ value: "awaiting_payment", label: "Not paid yet" \}/);
  });
});
