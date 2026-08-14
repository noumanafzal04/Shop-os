/**
 * The shape of the till's local database, and the only place it changes.
 *
 * Nine stores, not a hundred and one tables. What lives here is a PROJECTION of
 * what the till needs to sell, never a mirror of the server: no cost prices, no
 * descriptions, no customer balances, no other branch's stock. A projection
 * that grows into a mirror is how a stolen tablet becomes a leaked pricing book.
 *
 * ── Versioning, and why it is written down rather than inferred ──────────
 *
 * An app update can change this schema while the outbox still holds sales that
 * have never reached the server. Losing those is losing money that already
 * crossed a counter, so the rules are:
 *
 *   1. `OUTBOX` and `SHIFT` are append-only and their row shape is NEVER
 *      changed destructively. Add fields; never rename or drop one. A reader
 *      must be able to send a row written by an older version of the app.
 *   2. Every other store is a cache. It may be dropped and rebuilt from the
 *      server at will, because the server is its only source of truth.
 *   3. An upgrade step must be additive and must not touch OUTBOX rows.
 *
 * Bump VERSION and add a case to `upgrade()`. Never edit an existing case: a
 * till that skipped three releases replays every step in order.
 */

export const DB_NAME = "shopos-till";

/**
 * Version history — append only.
 *
 *   1  catalog, barcode index, tax config, promotions, customers, outbox,
 *      shift, device, sync meta
 *   2  categories, customer groups and settings — the projections that turned
 *      out to need syncing of their own once the server started sending them
 */
export const DB_VERSION = 2;

/** Every object store, by the name used to open a transaction on it. */
export const STORE = {
  /** One row per sellable item — the POS projection. Key: product id. */
  CATALOG: "catalog",
  /** barcode → { productId, variantId, unitId }. Key: the barcode itself. */
  BARCODE_INDEX: "barcodeIndex",
  /** Tax groups. Key: tax group id. */
  TAX_CONFIG: "taxConfig",
  /** Category rows, so a rename costs one row and not the whole catalog. */
  CATEGORIES: "categories",
  /** Price level and standing discount per group — pricing needs both. */
  CUSTOMER_GROUPS: "customerGroups",
  /** The shop's till settings, whole. Key: fixed. */
  SETTINGS: "settings",
  /** Only the promotion rules that are safe to apply offline. Key: promo id. */
  PROMOTIONS: "promotions",
  /** id, name, phone, customer_group_id — and nothing else. Key: customer id. */
  CUSTOMERS: "customers",
  /**
   * Sales rung with no server. APPEND-ONLY, never destructively migrated, and
   * never cleared on sync — a row moves to `acked` and is pruned much later.
   * Key: the operation id (which is also the sale's idempotency key).
   */
  OUTBOX: "outbox",
  /** Local shift + drawer movements, pushed on reconnect. Append-only. */
  SHIFT: "shift",
  /** This device's identity and the policy the server handed it. Key: fixed. */
  DEVICE: "device",
  /** Sync cursor, clock skew, schema version. Key: fixed. */
  SYNC_META: "syncMeta",
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** Stores holding work that has not reached the server. Never dropped. */
export const DURABLE_STORES: readonly StoreName[] = [STORE.OUTBOX, STORE.SHIFT];

/** Stores that are a cache of server state and may be rebuilt at any time. */
export const CACHE_STORES: readonly StoreName[] = [
  STORE.CATALOG,
  STORE.BARCODE_INDEX,
  STORE.TAX_CONFIG,
  STORE.CATEGORIES,
  STORE.CUSTOMER_GROUPS,
  STORE.SETTINGS,
  STORE.PROMOTIONS,
  STORE.CUSTOMERS,
];

/** Single-row stores use one fixed key, so reading needs no id from anywhere. */
export const SINGLETON_KEY = "current";

/**
 * Build the schema for a fresh database, and carry an older one forward.
 *
 * Runs inside IndexedDB's `versionchange` transaction, which is the only place
 * stores and indexes may be created — and which cannot await anything, so every
 * step here is synchronous by necessity.
 */
export function upgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore(STORE.CATALOG, { keyPath: "id" });

    db.createObjectStore(STORE.BARCODE_INDEX, { keyPath: "code" });

    db.createObjectStore(STORE.TAX_CONFIG, { keyPath: "id" });
    db.createObjectStore(STORE.PROMOTIONS, { keyPath: "id" });
    db.createObjectStore(STORE.CUSTOMERS, { keyPath: "id" });

    const outbox = db.createObjectStore(STORE.OUTBOX, { keyPath: "op" });
    // The flusher asks for everything still owed, oldest first — a queue is
    // useless if it cannot be read in the order it was written.
    outbox.createIndex("by_status", "status");
    outbox.createIndex("by_created", "createdAt");

    const shift = db.createObjectStore(STORE.SHIFT, { keyPath: "id" });
    shift.createIndex("by_status", "status");

    db.createObjectStore(STORE.DEVICE);
    db.createObjectStore(STORE.SYNC_META);
  }

  if (oldVersion < 2) {
    // Additive, and deliberately nowhere near OUTBOX or SHIFT: an upgrade must
    // never touch work that has not reached the server. A till upgrading from
    // version 1 keeps every unsent sale and simply pulls these three afresh,
    // because they are caches and the server is their only source of truth.
    db.createObjectStore(STORE.CATEGORIES, { keyPath: "id" });
    db.createObjectStore(STORE.CUSTOMER_GROUPS, { keyPath: "id" });
    db.createObjectStore(STORE.SETTINGS);
  }
}
