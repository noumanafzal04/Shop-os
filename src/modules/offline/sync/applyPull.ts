import { clear, getAll, getSingleton, put, putMany, putSingleton, remove } from "../db/repo";
import { STORE, type StoreName } from "../db/schema";
import {
  isTombstone,
  PROJECTIONS,
  type CatalogItem,
  type CatalogPull,
  type Projection,
} from "./catalogService";
import { indexEntriesFor, type BarcodeEntry } from "./barcodeIndex";

/**
 * Writing what the server sent into the till's own database.
 *
 * ── The one rule this file exists to keep ───────────────────────────────
 *
 * **The cursors are persisted only after EVERY row write has succeeded.**
 *
 * Fail partway and nothing moves: the same pages are fetched again next time,
 * which costs a request and changes nothing, because every write here is an
 * upsert keyed by id. Applying a page twice lands exactly where applying it
 * once does, so a repeat is free.
 *
 * Persist the cursors any earlier and a failure loses those rows FOR GOOD. The
 * till resumes past changes it never received, nothing ever asks for them
 * again, and there is no error, no retry and no way to notice — the catalog is
 * simply, permanently, slightly wrong.
 *
 * That asymmetry — repeating is free, skipping is unrecoverable — is why this
 * is not a transaction spanning rows and cursors. A transaction would be
 * tidier and would buy nothing the ordering does not already give.
 */

/** Where each projection's rows live. */
const STORE_FOR: Record<Projection, StoreName> = {
  products: STORE.CATALOG,
  categories: STORE.CATEGORIES,
  promotions: STORE.PROMOTIONS,
  tax_groups: STORE.TAX_CONFIG,
  customer_groups: STORE.CUSTOMER_GROUPS,
  customers: STORE.CUSTOMERS,
};

/** Where the till is up to, per projection. */
export type Cursors = Partial<Record<Projection, string | null>>;

export interface SyncMeta {
  cursors: Cursors;
  /** Server time minus this device's clock, in ms. Positive = we are slow. */
  clockSkewMs: number;
  /** When the last successful pull finished, by SERVER time. */
  lastPullAt: string | null;
}

/**
 * A FUNCTION, not a constant.
 *
 * `applyPull` mutates the object it gets back — it walks the projections
 * writing cursors into it. A shared constant returned as the "empty" default
 * would be mutated in place, so the module's own idea of empty would quietly
 * fill up with the cursors of whichever till ran first, and a reset would write
 * that back out as though it were a fresh start.
 */
const emptyMeta = (): SyncMeta => ({ cursors: {}, clockSkewMs: 0, lastPullAt: null });

export async function readMeta(): Promise<SyncMeta> {
  return (await getSingleton<SyncMeta>(STORE.SYNC_META)) ?? emptyMeta();
}

/**
 * Apply one pull, projection by projection.
 *
 * Returns what actually landed, so a caller can tell "nothing changed" from
 * "there is more to fetch" without inspecting the database.
 */
export async function applyPull(pull: CatalogPull): Promise<{
  applied: Record<Projection, number>;
  hasMore: boolean;
}> {
  const meta = await readMeta();
  const applied = {} as Record<Projection, number>;
  let hasMore = false;

  for (const projection of PROJECTIONS) {
    const page = pull[projection];
    applied[projection] = page.items.length;
    hasMore = hasMore || page.has_more;

    if (page.items.length > 0) {
      await applyRows(projection, page.items);
    }

    // Held in memory only. Nothing is persisted until every projection above
    // has written its rows without throwing — see the note at the top.
    meta.cursors[projection] = page.cursor;
  }

  // The clock the till measures a promotion's window against, and files its
  // sales by. Its own is not trustworthy: a tablet three days slow would run a
  // sale that ended and stamp its takings into the wrong trading day.
  meta.clockSkewMs = new Date(pull.server_time).getTime() - Date.now();
  meta.lastPullAt = pull.server_time;

  await putSingleton(STORE.SYNC_META, meta);

  // Settings are sent whole every time and have no id to page by, so they are
  // replaced rather than merged. A merge would leave a removed setting behind
  // for ever.
  await putSingleton(STORE.SETTINGS, {
    ...pull.settings,
    offline_days: pull.offline_days,
    // The kill switch. It arrives HERE, on the one call a till makes while it
    // still has a connection — which is the only moment the answer can change
    // hands. `=== true` rather than a cast, so a server too old to send it, or
    // a response that lost it, reads as OFF: a shop that has not been granted
    // offline selling must never get it by accident.
    offline_selling: pull.offline_selling === true,
    // The harder ceiling, and it arrives the same way for the same reason.
    // `?? null` rather than a cast: a server too old to send it, or a shop
    // that never asked for one, must read as NO CEILING — the direction is
    // opposite to the switch above, because this one refuses trade and a
    // ceiling invented by a missing field would close a counter for nothing.
    offline_hard_stop_days: pull.offline_hard_stop_days ?? null,
    // Where the SERVER thinks this till's slip counter had got to. Stored
    // rather than applied here, because the counter is only ever advanced at
    // the moment a number is minted — see `nextSequence`. `?? null` so a
    // server too old to send it leaves the local counter exactly as it is.
    offline_sequence: pull.offline_sequence ?? null,
    // The SHOP's calendar, which every promotion window is written in. A till
    // judging "Fridays, 6pm to 9pm" against UTC would open a Karachi shop's
    // evening sale five hours early.
    timezone: pull.timezone,
    ...(pull.branch_id === undefined ? {} : { branch_id: pull.branch_id }),
  });

  return { applied, hasMore };
}

/** Write one projection's page: tombstones removed, everything else upserted. */
async function applyRows(projection: Projection, items: CatalogPull[Projection]["items"]): Promise<void> {
  const store = STORE_FOR[projection];
  const gone = items.filter(isTombstone);
  const live = items.filter((row) => !isTombstone(row));

  if (live.length > 0) {
    await putMany(store, live);
  }
  for (const row of gone) {
    await remove(store, row.id);
  }

  // The barcode index is DERIVED, so it is rebuilt from the rows that just
  // changed rather than synced on its own. Keeping it as a second server-fed
  // projection would give a scanner two sources of truth that could disagree.
  if (projection === "products") {
    await reindexBarcodes(live as CatalogItem[], gone.map((row) => row.id));
  }
}

/**
 * Keep the barcode index in step with the products that just changed.
 *
 * Every code that reaches it has to be dropped first, not merely overwritten: a
 * product whose barcode was CORRECTED would otherwise leave the old code
 * pointing at it for ever, and scanning a retired code would ring up an item
 * the shop believes it no longer carries under that number.
 */
async function reindexBarcodes(changed: CatalogItem[], removedIds: string[]): Promise<void> {
  const touched = new Set([...changed.map((p) => p.id), ...removedIds]);
  if (touched.size === 0) return;

  const existing = await getAll<BarcodeEntry>(STORE.BARCODE_INDEX);

  for (const entry of existing) {
    if (touched.has(entry.productId)) {
      await remove(STORE.BARCODE_INDEX, entry.code);
    }
  }

  const entries = changed.flatMap(indexEntriesFor);
  if (entries.length > 0) {
    await putMany(STORE.BARCODE_INDEX, entries);
  }
}

/**
 * Throw away everything the server can send again and start over.
 *
 * For a device whose local database was cleared or evicted, and for a till
 * being handed to a different shop. It deliberately does NOT touch the outbox:
 * those are sales that already happened, and clearing them is losing money that
 * crossed a counter.
 */
export async function resetCatalog(): Promise<void> {
  for (const store of Object.values(STORE_FOR)) {
    await clear(store);
  }
  await clear(STORE.BARCODE_INDEX);
  await put(STORE.SYNC_META, emptyMeta(), "current");
}
