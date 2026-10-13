import { describe, expect, it } from "vitest";

import { isCatalogueNews } from "./catalogueNews";

/**
 * Which of this device's own writes mean its catalogue is behind.
 *
 * Written as what is NOT news, so a screen nobody has built yet is news by
 * default — the safe direction: one small pull too many, never a till that
 * cannot sell what its own owner just made.
 */

describe("what changes the shelf is news", () => {
  it.each([
    "/products",
    "/products/01a1-product",
    "/products/01a1-product/variants",
    "/products/import",
    "/categories",
    "/categories/01a1-cat",
    "/customers",
    "/customers/01a1-cust",
    "/customer-groups",
    "/promotions/01a1-promo",
    "/tax-groups",
    "/shop/settings",
    "/purchases/01a1-po/receive",
    "/inventory/adjustments",
    "/branches",
  ])("%s", (path) => {
    expect(isCatalogueNews(path)).toBe(true);
  });

  it("a screen that does not exist yet is news too", () => {
    expect(isCatalogueNews("/something-built-next-year/42")).toBe(true);
  });
});

describe("the till's own traffic is not", () => {
  it.each([
    // The pull makes these itself. If they were news, one pull would start the next.
    "/pos/devices",
    "/pos/sync",
    "/pos/sync/shifts",
    "/pos/pricing-variances",
    // Working the till.
    "/pos/session/open",
    "/pos/session/close",
    "/pos/session/movements",
    "/pos/held",
    "/pos/held/01a1/claim",
    "/pos/unlock",
    "/pos-devices/01a1",
    "/pos-devices/01a1/restore",
    // Ringing. A pull behind every bill is a request a customer waits behind.
    "/sales",
    "/sales/worth",
    "/sales/01a1/returns",
    "/sales/01a1/cancel",
    // The session and the bell.
    "/auth/logout",
    "/auth/till-pin",
    "/notifications/01a1/read",
    "/notifications/read-all",
    "/devices",
  ])("%s", (path) => {
    expect(isCatalogueNews(path)).toBe(false);
  });
});

describe("a path that only LOOKS like the till's", () => {
  it("is still news — the rule reads whole words, not beginnings", () => {
    // None of these exist today. They are here because `^/pos` without a
    // boundary would swallow every one, silently, the day somebody adds it.
    expect(isCatalogueNews("/positions")).toBe(true);
    expect(isCatalogueNews("/postage-rates")).toBe(true);
    expect(isCatalogueNews("/sales-targets")).toBe(true);
    expect(isCatalogueNews("/authors")).toBe(true);
    expect(isCatalogueNews("/devices-allowed")).toBe(true);
  });

  it("is read the same with a query, or as a whole address", () => {
    expect(isCatalogueNews("/sales?draft=1")).toBe(false);
    expect(isCatalogueNews("http://localhost:8000/api/v1/pos/sync")).toBe(false);
    expect(isCatalogueNews("http://localhost:8000/api/v1/products/7")).toBe(true);
    expect(isCatalogueNews("products/7")).toBe(true);
  });
});
