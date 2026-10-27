import { describe, expect, it } from "vitest";

import { notSavedYet, readinessLabel, type OfflineReadiness } from "./readiness";

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
  onServer: null,
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

/**
 * "Save everything on this device" on a 50,000-item shop (the user,
 * 2026-10-27): the device says how much it holds AGAINST how much the shop
 * has, so a half-finished save is never read as a finished one.
 */
describe("saved, out of how many", () => {
  it("says how many of the shop's items are here while some are missing", () => {
    const half = state({ products: 48000, customers: 1200, onServer: { products: 50000, customers: 1250 } });

    expect(readinessLabel(half)).toContain("48,000 of 50,000 products");
    expect(readinessLabel(half)).toContain("1,200 of 1,250 customers");
    expect(readinessLabel(half)).toMatch(/rest are not saved yet/);
    expect(notSavedYet(half)).toBe(2050);
  });

  it("says all of them once everything is here", () => {
    const whole = state({ products: 50000, customers: 1250, onServer: { products: 50000, customers: 1250 } });

    expect(readinessLabel(whole)).toMatch(/^All 50,000 products and all 1,250 customers are saved/);
    expect(readinessLabel(whole)).not.toMatch(/not saved yet/);
    expect(notSavedYet(whole)).toBe(0);
  });

  it("a device holding more than the last count (the server just deleted some) is not 'missing' any", () => {
    const ahead = state({ products: 101, customers: 9, onServer: { products: 100, customers: 10 } });

    expect(notSavedYet(ahead)).toBe(1);
    expect(readinessLabel(ahead)).toMatch(/^All 101 products/);
    expect(readinessLabel(ahead)).toContain("9 of 10 customers");
  });

  it("before any count has arrived, says only what is here", () => {
    expect(readinessLabel(state())).toMatch(/^1,284 products and 96 customers are saved/);
    expect(notSavedYet(state())).toBe(0);
  });
});
