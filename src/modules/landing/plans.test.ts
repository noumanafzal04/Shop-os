import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PLANS, pointsOf, priceOf } from "./plans";

/**
 * The page's plans against the product's.
 *
 * The seeder is PHP in another repository that sits beside this one on the
 * machine where either is changed. Where it is not there — a checkout of the
 * panel alone — the comparison is skipped and says so; the wording tests
 * below run everywhere.
 */
const SEEDER = resolve(__dirname, "../../../../backend/database/seeders/PlanSeeder.php");

/** One tier's block of the seeder, by its code. */
function tier(php: string, code: string): string {
  const from = php.indexOf(`'code' => '${code}'`);
  expect(from, `the seeder has no plan coded ${code}`).toBeGreaterThan(-1);
  const to = php.indexOf("],\n", from);

  return php.slice(from, to);
}

/** A figure in a tier: a number, or null where the seeder writes null. */
function figure(block: string, key: string): number | null {
  const found = new RegExp(`'${key}' => (null|\\d+)`).exec(block);
  expect(found, `the seeder's plan has no ${key}`).not.toBeNull();

  return found![1] === "null" ? null : Number(found![1]);
}

describe("the plans on the page are the plans in the product", () => {
  it.skipIf(!existsSync(SEEDER))("every name, price and figure is the seeder's", () => {
    const php = readFileSync(SEEDER, "utf8");

    // The same ladder, the same rungs: none added here, none left out.
    expect(PLANS.map((p) => p.code)).toEqual([...php.matchAll(/'code' => '([a-z]+)',\n\s+'name'/g)].map((m) => m[1]));

    for (const plan of PLANS) {
      const block = tier(php, plan.code);
      const said = `${plan.name}:`;

      expect(/'name' => '([^']+)'/.exec(block)?.[1], `${said} name`).toBe(plan.name);
      expect(figure(block, "price"), `${said} price`).toBe(plan.price);
      expect(figure(block, "max_branches"), `${said} branches`).toBe(plan.branches);
      expect(figure(block, "max_staff"), `${said} staff`).toBe(plan.staff);
      expect(figure(block, "max_registers"), `${said} tills`).toBe(plan.tills);
      expect(figure(block, "max_orders_month"), `${said} bills a month`).toBe(plan.bills);
      expect(figure(block, "max_products"), `${said} products`).toBe(plan.products);
      expect(figure(block, "retention_months"), `${said} months of history`).toBe(plan.historyMonths);
      // Offline is a switch and a length: off means the length is not offered.
      const sellsOffline = figure(block, "max_offline_selling") === 1;
      expect(sellsOffline ? figure(block, "max_offline_days") : null, `${said} days offline`).toBe(plan.offlineDays);
    }
  });
});

describe("what a card says is written from the figures", () => {
  const [basic, standard, pro, enterprise] = PLANS;

  it("counts in words a person writes — one branch, three tills", () => {
    expect(pointsOf(basic).map((p) => p.text).slice(0, 3)).toEqual(["1 branch", "3 staff logins", "1 till"]);
    expect(pointsOf(standard).map((p) => p.text).slice(0, 3)).toEqual(["3 branches", "10 staff logins", "3 tills"]);
  });

  it("says a ceiling as a figure, and no ceiling as none", () => {
    expect(pointsOf(basic).map((p) => p.text)).toContain("5,000 bills a month");
    expect(pointsOf(basic).map((p) => p.text)).toContain("1,000 products");
    expect(pointsOf(pro).map((p) => p.text)).toContain("Products without a ceiling");
    expect(pointsOf(enterprise).map((p) => p.text)).toContain("Bills without a meter");
  });

  it("says history in years, and for good where nothing is thrown away", () => {
    expect(pointsOf(basic).map((p) => p.text)).toContain("2 years of history");
    expect(pointsOf(pro).map((p) => p.text)).toContain("10 years of history");
    expect(pointsOf(enterprise).map((p) => p.text)).toContain("History kept for good");
  });

  it("does not leave out what a plan lacks: selling offline is named on Basic, and marked as not in it", () => {
    // The page's whole pitch is the till that carries on. A card that simply
    // omitted the line would let a buyer assume it.
    expect(pointsOf(basic).slice(-1)).toEqual([{ text: "Selling with no internet", off: true }]);
    expect(pointsOf(standard).slice(-1)).toEqual([{ text: "Sells with no internet — 3 days" }]);
    expect(pointsOf(standard).some((p) => p.off)).toBe(false);
  });

  it("every card has the same lines in the same order, so they can be read across", () => {
    expect(new Set(PLANS.map((p) => pointsOf(p).length))).toEqual(new Set([7]));
  });

  it("prints a price with its thousands", () => {
    expect(PLANS.map(priceOf)).toEqual(["2,499", "4,999", "7,999", "15,000"]);
  });

  it("recommends exactly one plan", () => {
    expect(PLANS.filter((p) => p.featured).map((p) => p.name)).toEqual(["Standard"]);
  });
});
