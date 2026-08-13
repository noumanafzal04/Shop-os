import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { indexedDbAvailable, openDb, resetDbCache } from "./open";
import {
  clear,
  clearCaches,
  count,
  get,
  getAll,
  getAllByIndex,
  getSingleton,
  pendingCount,
  put,
  putMany,
  putSingleton,
  remove,
} from "./repo";
import { CACHE_STORES, DB_NAME, DB_VERSION, DURABLE_STORES, STORE, upgrade } from "./schema";

/**
 * The till's local database.
 *
 * Two properties matter more than the rest and are tested hardest:
 *
 *  1. A write is only real once the TRANSACTION commits. A request can succeed
 *     inside a transaction that aborts, and reporting that as saved is how a
 *     sale is lost while the screen says it went through.
 *  2. The outbox is never collateral damage. Every "clear the cache" path must
 *     leave unsent sales exactly where they are — clearing them is losing money
 *     that already crossed a counter.
 */

beforeEach(async () => {
  // A brand new IndexedDB per test. Without this, a store written in one test
  // is visible in the next and every isolation assumption below is a lie.
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

afterEach(() => {
  resetDbCache();
});

describe("opening", () => {
  it("reports IndexedDB as available when there is one", () => {
    expect(indexedDbAvailable()).toBe(true);
  });

  it("creates every store the schema declares", async () => {
    const db = await openDb();
    const names = Array.from(db.objectStoreNames).sort();

    expect(names).toEqual(Object.values(STORE).slice().sort());
  });

  it("opens at the declared version", async () => {
    const db = await openDb();

    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
  });

  it("hands every caller the same connection", async () => {
    // A second connection held open elsewhere is exactly what blocks an
    // upgrade, so sharing one is not an optimisation.
    const [a, b] = await Promise.all([openDb(), openDb()]);

    expect(a).toBe(b);
  });

  it("gives the outbox the indexes the flusher reads it by", async () => {
    const db = await openDb();
    const outbox = db.transaction(STORE.OUTBOX).objectStore(STORE.OUTBOX);

    // A queue that cannot be read in the order it was written is not a queue.
    expect(Array.from(outbox.indexNames).sort()).toEqual(["by_created", "by_status"]);
  });
});

describe("reading and writing", () => {
  it("round-trips a row", async () => {
    await put(STORE.CATALOG, { id: "p1", name: "Milkpak", price: 25000 });

    expect(await get(STORE.CATALOG, "p1")).toEqual({ id: "p1", name: "Milkpak", price: 25000 });
  });

  it("answers undefined for a row that is not there, rather than throwing", async () => {
    expect(await get(STORE.CATALOG, "nope")).toBeUndefined();
  });

  it("overwrites on a second put of the same key", async () => {
    await put(STORE.CATALOG, { id: "p1", price: 100 });
    await put(STORE.CATALOG, { id: "p1", price: 200 });

    expect(await count(STORE.CATALOG)).toBe(1);
    expect(await get<{ price: number }>(STORE.CATALOG, "p1")).toMatchObject({ price: 200 });
  });

  it("deletes", async () => {
    await put(STORE.CATALOG, { id: "p1" });
    await remove(STORE.CATALOG, "p1");

    expect(await get(STORE.CATALOG, "p1")).toBeUndefined();
  });

  it("writes many rows as one batch", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, price: i }));
    await putMany(STORE.CATALOG, rows);

    expect(await count(STORE.CATALOG)).toBe(500);
    expect(await getAll(STORE.CATALOG)).toHaveLength(500);
  });

  it("treats an empty batch as nothing to do", async () => {
    await putMany(STORE.CATALOG, []);

    expect(await count(STORE.CATALOG)).toBe(0);
  });

  it("reads by index", async () => {
    await putMany(STORE.OUTBOX, [
      { op: "a", status: "PENDING", createdAt: 1 },
      { op: "b", status: "ACKED", createdAt: 2 },
      { op: "c", status: "PENDING", createdAt: 3 },
    ]);

    const owed = await getAllByIndex<{ op: string }>(STORE.OUTBOX, "by_status", "PENDING");

    expect(owed.map((r) => r.op).sort()).toEqual(["a", "c"]);
  });
});

describe("a write is only real once the transaction commits", () => {
  // NOTE ON WHAT IS AND IS NOT TESTABLE HERE.
  //
  // `run()` issues exactly one request, and for a single-request transaction
  // "the request succeeded" and "the transaction committed" cannot be made to
  // disagree from a test: the only ways to part them are an external abort or a
  // quota failure, neither of which is reachable through this API. A test
  // asserting the difference would pass whichever way `run()` was written,
  // which is worse than no test — it claims a guarantee nobody is holding.
  //
  // The guarantee IS observable the moment a transaction carries more than one
  // request, which is what the batch below exercises, and it is the case that
  // actually matters: the catalog arrives as thousands of rows at once.

  it("aborts the whole batch when one row in it is bad", async () => {
    await putMany(STORE.CATALOG, [{ id: "good-1" }]);

    // A row with no key at all cannot be stored in a keyPath store. The whole
    // batch must fail — half a catalog is worse than none, because a barcode
    // resolving to a row whose price never landed sells at the wrong money.
    await expect(
      putMany(STORE.CATALOG, [{ id: "good-2" }, { notAnId: true } as unknown as { id: string }]),
    ).rejects.toThrow();

    expect(await count(STORE.CATALOG)).toBe(1);
    expect(await get(STORE.CATALOG, "good-2")).toBeUndefined();
  });

  it("rolls back a row that HAD succeeded earlier in the same batch", async () => {
    // The sharper half of the same rule. "good-3" is written and its request
    // succeeds; the bad row that follows aborts the transaction and takes it
    // with it. A layer that resolved per-request rather than per-transaction
    // would have reported "good-3" saved a moment before it vanished.
    await expect(
      putMany(STORE.CATALOG, [
        { id: "good-3" },
        { notAnId: true } as unknown as { id: string },
        { id: "good-4" },
      ]),
    ).rejects.toThrow();

    expect(await get(STORE.CATALOG, "good-3")).toBeUndefined();
    expect(await count(STORE.CATALOG)).toBe(0);
  });
});

describe("single-row stores", () => {
  it("round-trips without needing an id from anywhere", async () => {
    await putSingleton(STORE.DEVICE, { id: "dev-1", name: "Counter tablet" });

    expect(await getSingleton(STORE.DEVICE)).toEqual({ id: "dev-1", name: "Counter tablet" });
  });

  it("cannot end up holding two", async () => {
    await putSingleton(STORE.SYNC_META, { cursor: 1 });
    await putSingleton(STORE.SYNC_META, { cursor: 2 });

    expect(await count(STORE.SYNC_META)).toBe(1);
    expect(await getSingleton(STORE.SYNC_META)).toEqual({ cursor: 2 });
  });
});

describe("the outbox is never collateral damage", () => {
  it("survives clearing every cache", async () => {
    // The most important test in this file. clearCaches() runs when a catalog
    // is rebuilt or a till changes hands, and it must never take unsent sales
    // with it — those are sales that already happened.
    await putMany(STORE.OUTBOX, [
      { op: "sale-1", status: "PENDING", createdAt: 1 },
      { op: "sale-2", status: "PENDING", createdAt: 2 },
    ]);
    await putMany(STORE.SHIFT, [{ id: "shift-1", status: "open" }]);
    await putMany(STORE.CATALOG, [{ id: "p1" }, { id: "p2" }]);
    await putMany(STORE.CUSTOMERS, [{ id: "c1" }]);
    await putSingleton(STORE.TAX_CONFIG, { rate: 17 });

    await clearCaches();

    expect(await pendingCount()).toBe(2);
    expect(await count(STORE.SHIFT)).toBe(1);
    expect(await count(STORE.CATALOG)).toBe(0);
    expect(await count(STORE.CUSTOMERS)).toBe(0);
    expect(await count(STORE.TAX_CONFIG)).toBe(0);
  });

  it("keeps the durable stores out of the disposable list", async () => {
    // clearCaches() derives its list from CACHE_STORES rather than repeating
    // it, so this is the assertion that keeps the two from drifting apart.
    for (const durable of DURABLE_STORES) {
      expect(CACHE_STORES).not.toContain(durable);
    }
  });

  it("names every store as either disposable or durable — none forgotten", async () => {
    // A store in neither list is one nobody has decided about, which is how a
    // queue quietly gets cleared by a cache wipe two releases later.
    const classified = [...CACHE_STORES, ...DURABLE_STORES, STORE.DEVICE, STORE.SYNC_META];

    expect(classified.slice().sort()).toEqual(Object.values(STORE).slice().sort());
  });
});

describe("upgrades", () => {
  it("carries an existing database forward without touching its outbox", async () => {
    // An app update can change the schema while unsent sales are still queued.
    // Losing them is losing money, so an upgrade step is additive and never
    // rewrites the outbox.
    await putMany(STORE.OUTBOX, [{ op: "sale-1", status: "PENDING", createdAt: 1 }]);
    (await openDb()).close();
    resetDbCache();

    // Reopen a version higher, running the real upgrade path.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
      request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    resetDbCache();

    const survived = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION + 1);
      request.onsuccess = () => {
        const db = request.result;
        const all = db.transaction(STORE.OUTBOX).objectStore(STORE.OUTBOX).getAll();
        all.onsuccess = () => {
          resolve(all.result);
          db.close();
        };
        all.onerror = () => reject(all.error);
      };
      request.onerror = () => reject(request.error);
    });

    expect(survived).toHaveLength(1);
  });
});

describe("when there is no IndexedDB at all", () => {
  it("rejects with something a person can act on instead of throwing raw", async () => {
    // Safari private mode, and some locked-down enterprise profiles.
    const real = globalThis.indexedDB;
    // @ts-expect-error deliberately removing it for this test
    delete globalThis.indexedDB;
    resetDbCache();

    expect(indexedDbAvailable()).toBe(false);
    await expect(openDb()).rejects.toThrow(/no local storage/i);

    globalThis.indexedDB = real;
    resetDbCache();
  });
});

describe("isolation between stores", () => {
  it("keeps rows in the store they were written to", async () => {
    await put(STORE.CATALOG, { id: "same-id", from: "catalog" });
    await put(STORE.CUSTOMERS, { id: "same-id", from: "customers" });

    expect(await get<{ from: string }>(STORE.CATALOG, "same-id")).toMatchObject({ from: "catalog" });
    expect(await get<{ from: string }>(STORE.CUSTOMERS, "same-id")).toMatchObject({ from: "customers" });
  });

  it("clears one store without touching its neighbours", async () => {
    await put(STORE.CATALOG, { id: "p1" });
    await put(STORE.CUSTOMERS, { id: "c1" });

    await clear(STORE.CATALOG);

    expect(await count(STORE.CATALOG)).toBe(0);
    expect(await count(STORE.CUSTOMERS)).toBe(1);
  });
});
