import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { ApiError } from "../../../common/types/api";
import { enqueue, KEEP_ACKED_MS, newRow, OUTBOX_STATUS, owedCount, pruneAcked, readRow, refusedCount, type OutboxRow } from "./outbox";
import { onHand, unsyncedDeltas } from "./localStock";
import { refusedSalesApi, sendOwedSettlements, settleRefused } from "./settleRefused";

/**
 * B49: a refused sale is settled at the till — rung again as a named sale, or
 * dealt with and said how. Written HERE first, so the slip leaves the refused
 * list at once and can never be rung twice; then told to the shop, now or with
 * the next sync, like a sale.
 */
const SHOP = "shop-a";
const refused = (op: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  ...newRow(op, "2026-10-17T07:00:00.000Z", `OFF-L1-AB-${op}`, { items: [{ product_id: "p1", quantity: 2 }] }, null, { tenantId: SHOP, tillTotal: 1200 }),
  status: OUTBOX_STATUS.FAILED,
  error: "Old Shampoo was deleted since it was rung.",
  ...over,
});
const ok = { success: true, message: "", data: { id: "r", settled_as: "dealt_with" }, errors: {}, meta: {} };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});
afterEach(() => vi.restoreAllMocks());

describe("settling a refused sale", () => {
  it("takes it off the refused list and tells the shop, with the till's own copy", async () => {
    const settle = vi.spyOn(refusedSalesApi, "settle").mockResolvedValue(ok as never);
    await enqueue(refused("1"));

    const settled = await settleRefused(refused("1"), { how: "dealt_with", note: "  Money handed back ", by: "bilal" });

    expect(settled).toMatchObject({ how: "dealt_with", note: "Money handed back", by: "bilal", sent: true, error: null });
    expect(await refusedCount(), "the strip clears").toBe(0);
    expect(await owedCount(), "nothing left to send").toBe(0);
    expect((await readRow("1"))?.status).toBe(OUTBOX_STATUS.RESOLVED);
    expect(settle).toHaveBeenCalledWith("1", {
      how: "dealt_with", note: "Money handed back", sale_id: null, settled_by: "bilal",
      offline_number: "OFF-L1-AB-1", sold_at: "2026-10-17T07:00:00.000Z", till_total: 1200,
      reason: "Old Shampoo was deleted since it was rung.",
    });
  });

  it("names the sale that rang it again", async () => {
    const settle = vi.spyOn(refusedSalesApi, "settle").mockResolvedValue(ok as never);
    await enqueue(refused("1"));

    await settleRefused(refused("1"), { how: "rung_again", saleId: "sale-9", invoiceNumber: "INV-0050", by: "bilal" });

    expect(settle.mock.calls[0][1]).toMatchObject({ how: "rung_again", sale_id: "sale-9", note: null });
    expect((await readRow("1"))?.settlement?.invoiceNumber).toBe("INV-0050");
  });

  it("is settled here even with no line — and owed to the shop until it lands", async () => {
    const settle = vi.spyOn(refusedSalesApi, "settle").mockRejectedValue(new Error("Network Error"));
    await enqueue(refused("1"));

    const settled = await settleRefused(refused("1"), { how: "dealt_with", note: "Written in the book", by: "bilal" });

    expect(settled.sent).toBe(false);
    expect(await refusedCount(), "never rung twice: it is settled on the till").toBe(0);
    expect(await owedCount(), "counted with the queue until the shop hears").toBe(1);

    // The line returns: the next sync sends it.
    settle.mockResolvedValue(ok as never);
    expect(await sendOwedSettlements(SHOP)).toBe(1);
    expect(await owedCount()).toBe(0);
    expect((await readRow("1"))?.settlement?.sent).toBe(true);
  });

  it("takes the shop's own answer as final, and keeps its words", async () => {
    vi.spyOn(refusedSalesApi, "settle").mockRejectedValue(new ApiError("OFF-L1-AB-1 was already settled.", 409, "REFUSAL_SETTLED"));
    await enqueue(refused("1"));

    const settled = await settleRefused(refused("1"), { how: "dealt_with", note: "Handed back", by: null });

    expect(settled).toMatchObject({ sent: true, error: "OFF-L1-AB-1 was already settled." });
    expect(await owedCount(), "sending it again changes nothing").toBe(0);
  });

  it("waits out a sign-in that lapsed or a throttle — those are not answers", async () => {
    vi.spyOn(refusedSalesApi, "settle").mockRejectedValue(new ApiError("Unauthenticated.", 401));
    await enqueue(refused("1"));

    expect((await settleRefused(refused("1"), { how: "dealt_with", note: "Handed back", by: null })).sent).toBe(false);
    expect(await owedCount()).toBe(1);
  });

  it("sends only this shop's, and stops at the first that cannot go", async () => {
    const settle = vi.spyOn(refusedSalesApi, "settle").mockRejectedValue(new Error("Network Error"));
    await enqueue(refused("a"));
    await enqueue(refused("b"));
    await enqueue(refused("c", { tenantId: "shop-b" }));
    for (const op of ["a", "b", "c"]) await settleRefused((await readRow(op)) as OutboxRow, { how: "dealt_with", note: "Handed back", by: null });
    settle.mockClear();

    expect(await sendOwedSettlements(SHOP)).toBe(0);
    expect(settle, "the line is down: one try, not one per slip").toHaveBeenCalledTimes(1);

    settle.mockResolvedValue(ok as never);
    expect(await sendOwedSettlements(SHOP)).toBe(2);
    expect(settle.mock.calls.map((c) => c[0]).sort()).toEqual(["a", "a", "b"]);
    expect((await readRow("c"))?.settlement?.sent, "another shop's waits for its own sign-in").toBe(false);
  });

  it("holds no stock off the shelf, and keeps the slip once the cart is pruned", async () => {
    vi.spyOn(refusedSalesApi, "settle").mockResolvedValue(ok as never);
    const old = new Date(Date.now() - KEEP_ACKED_MS * 2).toISOString();
    await enqueue(refused("1", { createdAt: old }));
    await settleRefused((await readRow("1")) as OutboxRow, { how: "dealt_with", note: "Handed back", by: null });

    expect(onHand(10, await unsyncedDeltas(), "p1"), "a settled refusal took nothing off the shelf").toBe(10);
    expect(await pruneAcked()).toBe(1);
    const kept = await readRow("1");
    expect(kept?.sale).toEqual({});
    expect(kept?.offlineNumber).toBe("OFF-L1-AB-1");
    expect(kept?.settlement?.note).toBe("Handed back");
  });

  it("keeps the cart of one whose settlement has not reached the shop", async () => {
    vi.spyOn(refusedSalesApi, "settle").mockRejectedValue(new Error("Network Error"));
    const old = new Date(Date.now() - KEEP_ACKED_MS * 2).toISOString();
    await enqueue(refused("1", { createdAt: old }));
    await settleRefused((await readRow("1")) as OutboxRow, { how: "dealt_with", note: "Handed back", by: null });

    expect(await pruneAcked()).toBe(0);
    expect((await readRow("1"))?.sale).not.toEqual({});
  });
});
