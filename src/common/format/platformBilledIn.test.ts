import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PKR, platformBilledIn } from "./currency";

/**
 * #AZ9 — A-Z Phones trades in AED and read "AZ Plan — Rs 2,500 every month"
 * as its own money. The plan is the platform's price; that is now said.
 */
describe("a plan's price on a shop that trades in other money", () => {
  it("names the platform's currency for a dirham shop", () => {
    expect(platformBilledIn({ code: "AED" })).toBe(`Billed in ${PKR.name} (${PKR.code}) — the platform's money, not your shop's.`);
  });

  it("says nothing new to a shop that trades in the platform's money", () => {
    expect(platformBilledIn({ code: PKR.code })).toBeNull();
  });

  it("the subscription screen says it under the plan's price", () => {
    const page = readFileSync(resolve(__dirname, "../../modules/shop/pages/SubscriptionPage.tsx"), "utf8");

    expect(page).toMatch(/const billedIn = platformBilledIn\(useCurrency\(\)\)/);
    expect(page).toMatch(/\{billedIn && <p data-billed-in[^>]*>\{billedIn\}<\/p>\}/);
  });
});
