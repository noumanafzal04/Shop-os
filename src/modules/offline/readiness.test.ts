import { describe, expect, it } from "vitest";

import { readinessLabel, type OfflineReadiness } from "./readiness";

/**
 * A shop turned its wifi off to see what would happen and got an empty till.
 * The catalog syncs on its own and always has — but a shopkeeper had no way to
 * ask whether THIS device was ready, so the only way to find out was to have
 * the outage.
 */
const state = (over: Partial<OfflineReadiness> = {}): OfflineReadiness => ({
  products: 1284,
  customers: 96,
  codes: 1102,
  lastPullAt: "2026-08-27T09:00:00Z",
  ready: true,
  ...over,
});

describe("what a till says it is holding", () => {
  it("counts what is actually on the device", () => {
    expect(readinessLabel(state())).toContain("1,284 products");
    expect(readinessLabel(state())).toContain("96 customers");
  });

  it("is blunt when there is nothing to sell from", () => {
    // The one state where a shop must not be reassured.
    expect(readinessLabel(state({ products: 0 }))).toMatch(/cannot sell/i);
  });

  it("says so when the catalog is there but no scanner will work", () => {
    // A till with products and no codes can be searched and cannot be scanned.
    // Those are different shops and the difference is invisible until a queue
    // has formed.
    expect(readinessLabel(state({ codes: 0 }))).toMatch(/scanning will not work/i);
  });

  it("does not mention scanning when scanning is fine", () => {
    expect(readinessLabel(state())).not.toMatch(/scanning/i);
  });
});
