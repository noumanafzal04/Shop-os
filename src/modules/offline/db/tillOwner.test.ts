import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "./open";
import { getAll, getSingleton, put, putSingleton } from "./repo";
import { STORE } from "./schema";
import { ensureDatabaseBelongsTo } from "./tillOwner";
import type { SyncMeta } from "../sync/applyPull";
import { enqueue, newRow, owedCount } from "../outbox/outbox";

/**
 * ONE BROWSER, TWO SHOPS — THE CATALOG.
 *
 * The outbox has always fenced this case. The catalog never did: its rows
 * carry no tenant, `clearCaches()` was written for "a till handed to a
 * different shop" and called by nothing, and logout emptied the auth store
 * without touching IndexedDB.
 *
 * Proven in a browser against the live panel before any of this was written: a
 * till signed out of a mart and into a pharmacy went on holding Sugar, Tea,
 * Rice, Cooking Oil and Milk, and offered them for sale.
 */

const MART = "shop-mart";
const PHARMACY = "shop-pharmacy";

const meta = (over: Partial<SyncMeta> = {}): SyncMeta => ({
  cursors: { products: "cursor-1" } as SyncMeta["cursors"],
  clockSkewMs: 250,
  lastPullAt: "2026-08-29T08:00:00.000Z",
  tenantId: MART,
  ...over,
});

async function stockTheMart() {
  await put(STORE.CATALOG, { id: "p1", name: "Sugar 1kg" });
  await put(STORE.CUSTOMERS, { id: "c1", name: "A mart regular" });
  await put(STORE.BARCODE_INDEX, { code: "8961", productId: "p1" });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("a till handed to a different shop", () => {
  it("clears the first shop's catalogue, customers and codes", async () => {
    await stockTheMart();
    await putSingleton(STORE.SYNC_META, meta());

    const result = await ensureDatabaseBelongsTo(PHARMACY);

    expect(result.cleared).toBe(true);
    expect(result.previous).toBe(MART);
    expect(await getAll(STORE.CATALOG)).toEqual([]);
    expect(await getAll(STORE.CUSTOMERS)).toEqual([]);
    expect(await getAll(STORE.BARCODE_INDEX)).toEqual([]);
  });

  it("resets the cursors, or the next pull asks for a delta on someone else's position", async () => {
    // The half that would have been missed. SYNC_META is deliberately NOT a
    // cache store, so clearing the catalog and leaving the cursors would have
    // the till report a healthy sync while holding an empty shelf.
    await stockTheMart();
    await putSingleton(STORE.SYNC_META, meta());

    await ensureDatabaseBelongsTo(PHARMACY);

    const after = await getSingleton<SyncMeta>(STORE.SYNC_META);
    expect(after?.cursors).toEqual({});
    expect(after?.lastPullAt).toBeNull();
    expect(after?.tenantId).toBe(PHARMACY);
  });

  it("NEVER touches money that has not reached the server", async () => {
    // The one thing this must not do. A sale rung on this device is money that
    // crossed a counter and exists nowhere else; the outbox has its own fence
    // for the two-shop case and does not need saving from itself.
    await enqueue(newRow("op-1", "2026-08-29T08:00:00.000Z", "OFF-L1-AB-1", { total: 500 }, null, { tenantId: MART }));
    await putSingleton(STORE.RECEIPT_COUNTER, { next: 42 });
    await putSingleton(STORE.SYNC_META, meta());

    await ensureDatabaseBelongsTo(PHARMACY);

    expect(await owedCount(), "a shop switch destroyed an unsent sale").toBe(1);
    expect(await getSingleton(STORE.RECEIPT_COUNTER)).toEqual({ next: 42 });
  });
});

describe("what must NOT set it off", () => {
  it("leaves the same shop's data alone", async () => {
    // The denominator. Every assertion above passes against a function that
    // simply clears the database every time it is called.
    await stockTheMart();
    await putSingleton(STORE.SYNC_META, meta());

    const result = await ensureDatabaseBelongsTo(MART);

    expect(result.cleared).toBe(false);
    expect(await getAll(STORE.CATALOG)).toHaveLength(1);
    expect((await getSingleton<SyncMeta>(STORE.SYNC_META))?.cursors).toEqual({ products: "cursor-1" });
  });

  it("claims an unstamped database rather than wiping it", async () => {
    // Every till in the field is unstamped on the day this ships. Reading "no
    // owner" as "somebody else's" would empty all of them at once, for a
    // handover that has happened on none of them.
    await stockTheMart();
    await putSingleton(STORE.SYNC_META, meta({ tenantId: null }));

    const result = await ensureDatabaseBelongsTo(MART);

    expect(result.cleared).toBe(false);
    expect(await getAll(STORE.CATALOG)).toHaveLength(1);
    expect((await getSingleton<SyncMeta>(STORE.SYNC_META))?.tenantId).toBe(MART);
    // …and the cursors survive, so an existing till does not re-download its
    // whole catalogue on the morning it upgrades.
    expect((await getSingleton<SyncMeta>(STORE.SYNC_META))?.cursors).toEqual({ products: "cursor-1" });
  });

  it("does nothing at all while nobody is signed in", async () => {
    // A page that has not hydrated its auth store is not a handover. Wiping on
    // it would empty every device on every cold start.
    await stockTheMart();
    await putSingleton(STORE.SYNC_META, meta());

    const result = await ensureDatabaseBelongsTo(null);

    expect(result.cleared).toBe(false);
    expect(await getAll(STORE.CATALOG)).toHaveLength(1);
    expect((await getSingleton<SyncMeta>(STORE.SYNC_META))?.tenantId).toBe(MART);
  });

  it("stamps a brand-new database on the first pull", async () => {
    const result = await ensureDatabaseBelongsTo(MART);

    expect(result.cleared).toBe(false);
    expect((await getSingleton<SyncMeta>(STORE.SYNC_META))?.tenantId).toBe(MART);
  });
});
