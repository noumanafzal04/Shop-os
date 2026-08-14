import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { count, putMany } from "../db/repo";
import { STORE } from "../db/schema";
import { flushVariances, varianceService } from "./varianceService";
import type { PricingVariance } from "./shadow";

/**
 * Sending what a till found, and forgetting it locally only once it lands.
 *
 * The ordering is the same one the catalog cursor follows and it is here for
 * the same reason: delete first and a failed request loses a finding
 * permanently, silently, with nothing left to retry — and a finding lost is a
 * bug that stays in the engine. Delete after and a lost acknowledgement costs a
 * re-send, which the server absorbs by upserting on (tenant, sale).
 */

const variance = (saleId: string): PricingVariance => ({
  saleId,
  at: `2026-08-14T10:00:${saleId.slice(-2)}.000Z`,
  server: { subtotal: 100, discount: 0, tax: 17, total: 117 },
  local: { subtotal: 100, discount: 0, tax: 17.01, total: 117.01 },
  differences: [{ field: "tax", server: 17, local: 17.01, by: 0.01 }],
  cart: { settings: { default_tax_rate: 0, tax_inclusive: false }, discount: 0, lines: [] },
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
});

describe("sending", () => {
  it("does nothing when there is nothing to send", async () => {
    const report = vi.spyOn(varianceService, "report");

    expect(await flushVariances()).toEqual({ sent: 0 });
    expect(report).not.toHaveBeenCalled();
  });

  it("sends what the till found and then forgets it", async () => {
    await putMany(STORE.PRICING_VARIANCES, [variance("sale-01"), variance("sale-02")]);
    const report = vi.spyOn(varianceService, "report").mockResolvedValue(envelope({ stored: 2 }));

    expect(await flushVariances()).toEqual({ sent: 2 });

    expect(report).toHaveBeenCalledTimes(1);
    expect(await count(STORE.PRICING_VARIANCES)).toBe(0);
  });

  it("names the device, so one till's findings can be told from another's", async () => {
    // A disagreement on one device and not another is a stale catalog; on every
    // device it is the engine.
    await putMany(STORE.PRICING_VARIANCES, [variance("sale-01")]);
    const report = vi.spyOn(varianceService, "report").mockResolvedValue(envelope({ stored: 1 }));

    await flushVariances();

    expect(report).toHaveBeenCalledWith([expect.objectContaining({ saleId: "sale-01" })]);
  });

  it("sends a large pile in batches rather than one enormous request", async () => {
    const many = Array.from({ length: 250 }, (_, i) => variance(`sale-${String(i).padStart(2, "0")}`));
    await putMany(STORE.PRICING_VARIANCES, many);
    const report = vi.spyOn(varianceService, "report").mockResolvedValue(envelope({ stored: 100 }));

    expect(await flushVariances()).toEqual({ sent: 250 });

    expect(report).toHaveBeenCalledTimes(3);
    expect(await count(STORE.PRICING_VARIANCES)).toBe(0);
  });
});

describe("when the send fails", () => {
  it("KEEPS the findings rather than losing them", async () => {
    // The whole reason the deletion comes second. A finding lost is a bug that
    // stays in the engine, and nothing would ever ask for it again.
    await putMany(STORE.PRICING_VARIANCES, [variance("sale-01")]);
    vi.spyOn(varianceService, "report").mockRejectedValue(new Error("Network Error"));

    expect(await flushVariances()).toEqual({ sent: 0 });

    expect(await count(STORE.PRICING_VARIANCES)).toBe(1);
  });

  it("keeps the batches it has not sent when one fails partway", async () => {
    const many = Array.from({ length: 150 }, (_, i) => variance(`sale-${String(i).padStart(2, "0")}`));
    await putMany(STORE.PRICING_VARIANCES, many);
    let call = 0;
    vi.spyOn(varianceService, "report").mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("dropped");

      return envelope({ stored: 100 });
    });

    await flushVariances();

    // The first hundred landed and were forgotten; the rest are still owed.
    expect(await count(STORE.PRICING_VARIANCES)).toBe(50);
  });

  it("never throws, because it rides along with the catalog sync", async () => {
    // A till must not stop learning its catalog because a diagnostic did not go.
    vi.spyOn(varianceService, "report").mockRejectedValue(new Error("boom"));
    await putMany(STORE.PRICING_VARIANCES, [variance("sale-01")]);

    await expect(flushVariances()).resolves.toEqual({ sent: 0 });
  });

  it("does not throw when there is no local database at all", async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();

    await expect(flushVariances()).resolves.toEqual({ sent: 0 });

    globalThis.indexedDB = real;
    resetDbCache();
  });
});
