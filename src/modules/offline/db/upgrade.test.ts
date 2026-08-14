import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "./open";
import { getAll } from "./repo";
import { DB_NAME, DB_VERSION, DURABLE_STORES, STORE, upgrade } from "./schema";

/**
 * Upgrading the till's database while it is holding money.
 *
 * ── The failure this exists to make impossible ──────────────────────────
 *
 * A shop trades through a two-day outage and has two hundred sales queued. On
 * the third morning the app updates — a service worker picking up a release
 * that happens to add a store. If that upgrade drops, renames or recreates the
 * outbox, two hundred sales that already crossed a counter are gone, with no
 * copy anywhere in the world and nobody aware they ever existed.
 *
 * Nothing else in the app can fail this way. A lost catalog re-downloads; a
 * lost cursor re-bootstraps. The outbox is the one store with no upstream.
 *
 * ── What the tests below actually do ────────────────────────────────────
 *
 * They open the database at an OLD version, write the kind of rows a real till
 * would be holding, then reopen at the current version through the real
 * `upgrade()` — the same function that runs on a shop's tablet. If a future
 * release adds a destructive step, these fail.
 */

/**
 * The shape each old version ACTUALLY had, written out by hand.
 *
 * It has to be a fixture and cannot be produced by calling today's `upgrade()`
 * with a low version — that runs every block and builds today's schema under an
 * old version number, which is a database no till has ever had. The first
 * attempt at this test did exactly that and failed with a ConstraintError,
 * which looked like a schema bug for a minute and was a test bug.
 *
 * A real version-1 till was built by an app whose `upgrade()` only had the
 * version-1 block. That is what is recreated here.
 */
const HISTORICAL: Record<number, (db: IDBDatabase) => void> = {
  1: (db) => {
    db.createObjectStore(STORE.CATALOG, { keyPath: "id" });
    db.createObjectStore(STORE.BARCODE_INDEX, { keyPath: "code" });
    db.createObjectStore(STORE.TAX_CONFIG, { keyPath: "id" });
    db.createObjectStore(STORE.PROMOTIONS, { keyPath: "id" });
    db.createObjectStore(STORE.CUSTOMERS, { keyPath: "id" });
    const outbox = db.createObjectStore(STORE.OUTBOX, { keyPath: "op" });
    outbox.createIndex("by_status", "status");
    outbox.createIndex("by_created", "createdAt");
    const shift = db.createObjectStore(STORE.SHIFT, { keyPath: "id" });
    shift.createIndex("by_status", "status");
    db.createObjectStore(STORE.DEVICE);
    db.createObjectStore(STORE.SYNC_META);
  },
  2: (db) => {
    HISTORICAL[1](db);
    db.createObjectStore(STORE.CATEGORIES, { keyPath: "id" });
    db.createObjectStore(STORE.CUSTOMER_GROUPS, { keyPath: "id" });
    db.createObjectStore(STORE.SETTINGS);
  },
};

/** A till as it was on an old release. */
function seedAt(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => HISTORICAL[version](request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Open through the REAL upgrade path — the same code a shop's tablet runs. */
function openAt(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = (event) => {
      upgrade(request.result, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    for (const row of rows) tx.objectStore(store).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const sale = (i: number) => ({
  op: `op-${String(i).padStart(3, "0")}`,
  at: "2026-08-16T10:00:00.000Z",
  offlineNumber: `OFF-L1-AB-${String(i).padStart(6, "0")}`,
  sale: { items: [{ product_id: "p1", quantity: 2 }] },
  status: "pending",
  createdAt: "2026-08-16T10:00:00.000Z",
  attempts: 0,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("upgrading with money in the queue", () => {
  it("KEEPS every unsent sale across the whole version history", async () => {
    // Two hundred sales, written by a version-1 till, read by today's.
    const old = await seedAt(1);
    await write(old, STORE.OUTBOX, Array.from({ length: 200 }, (_, i) => sale(i)));
    old.close();
    resetDbCache();

    await openAt(DB_VERSION);
    resetDbCache();

    const rows = await getAll<{ op: string; sale: unknown }>(STORE.OUTBOX);
    expect(rows).toHaveLength(200);
    // Not just the count — the CONTENT. A row whose cart was emptied would
    // still count, and would still be worthless.
    expect(rows.every((r) => r.sale !== undefined)).toBe(true);
  });

  it("keeps a queued sale when the till skipped three releases", async () => {
    // The commonest real case: a tablet that has not been opened for months.
    // Every step replays in order, so this is the same path as one upgrade.
    const old = await seedAt(2);
    await write(old, STORE.OUTBOX, [sale(1)]);
    old.close();
    resetDbCache();

    await openAt(DB_VERSION);
    resetDbCache();

    expect(await getAll(STORE.OUTBOX)).toHaveLength(1);
  });

  it("keeps the shift log too, which is the other thing with no upstream", async () => {
    const old = await seedAt(1);
    await write(old, STORE.SHIFT, [{ id: "s1", status: "open", openedAt: "2026-08-16T08:00:00Z" }]);
    old.close();
    resetDbCache();

    await openAt(DB_VERSION);
    resetDbCache();

    expect(await getAll(STORE.SHIFT)).toHaveLength(1);
  });

  it("keeps the receipt counter, so the numbering does not restart", async () => {
    // Restarting it would print a slip that a previous sale already carries,
    // on the same till — two receipts, one identity.
    const old = await openAt(DB_VERSION);
    await new Promise<void>((resolve, reject) => {
      const tx = old.transaction(STORE.RECEIPT_COUNTER, "readwrite");
      tx.objectStore(STORE.RECEIPT_COUNTER).put({ seq: 417 }, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    old.close();
    resetDbCache();

    // A release that has not been written yet. Read back on THIS connection
    // rather than through the repo, which opens at today's version and would
    // be refused for being older than the database it just upgraded.
    const next = await openAt(DB_VERSION + 1);
    const kept = await new Promise((resolve, reject) => {
      const request = next
        .transaction(STORE.RECEIPT_COUNTER, "readonly")
        .objectStore(STORE.RECEIPT_COUNTER)
        .get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    next.close();

    expect(kept).toEqual({ seq: 417 });
  });
});

describe("the upgrade steps themselves", () => {
  it("creates every store a fresh till needs", async () => {
    const db = await openAt(DB_VERSION);

    for (const store of Object.values(STORE)) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    db.close();
  });

  it("arrives at the same shape whether upgraded or built fresh", async () => {
    // A till that has been through every version must not end up subtly
    // different from one installed today — that difference is where a bug
    // lives that only reproduces on old devices.
    const stepped = await seedAt(1);
    stepped.close();
    resetDbCache();
    const upgraded = await openAt(DB_VERSION);
    const upgradedStores = [...upgraded.objectStoreNames].sort();
    upgraded.close();

    globalThis.indexedDB = new IDBFactory();
    resetDbCache();
    const fresh = await openAt(DB_VERSION);
    const freshStores = [...fresh.objectStoreNames].sort();
    fresh.close();

    expect(upgradedStores).toEqual(freshStores);
  });

  it("names the outbox and the shift as things that are never dropped", async () => {
    // The list is what `clearCaches` reads to decide what is disposable, so a
    // store missing from it is a store that can be wiped with a sale in it.
    expect(DURABLE_STORES).toContain(STORE.OUTBOX);
    expect(DURABLE_STORES).toContain(STORE.SHIFT);
    expect(DURABLE_STORES).toContain(STORE.RECEIPT_COUNTER);
  });
});
