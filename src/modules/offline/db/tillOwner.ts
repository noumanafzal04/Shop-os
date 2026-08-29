import { clearCaches, getSingleton, putSingleton } from "./repo";
import { STORE } from "./schema";
import type { SyncMeta } from "../sync/applyPull";

/**
 * WHOSE SHOP IS THIS TILL HOLDING?
 *
 * ── The hole this closes ────────────────────────────────────────────────
 *
 * IndexedDB is scoped to the ORIGIN. One browser used by two shops therefore
 * has ONE database, and the outbox has always known it: `belongsHere` checks
 * every queued sale against the shop that is signed in, because posting shop
 * A's takings under shop B's token would move money between two businesses
 * with no way to unpick it.
 *
 * The CATALOG had no such rule. Its rows carry no tenant at all. `clearCaches`
 * was written for exactly this — its docblock says "when a till is handed to a
 * different shop" — and **nothing ever called it**. Logout clears the auth
 * store and the query cache and does not touch this database.
 *
 * Proven in a browser against the live panel: a till signed out of a mart and
 * into a pharmacy went on holding the mart's products, and offered them for
 * sale on the pharmacy's till.
 *
 * ── Why a stamp, and not a wipe on logout ───────────────────────────────
 *
 * Logout is not the only door. A token expires, a tab is closed, a tablet is
 * handed over and somebody signs straight in as another shop. A wipe wired to
 * the sign-out button covers the one path a person takes deliberately and
 * misses every path they take by accident — and the accidental ones are the
 * ones nobody is watching.
 *
 * A stamp is checked at the moment of USE, so no route can go around it.
 *
 * ── What it does NOT clear ──────────────────────────────────────────────
 *
 * Only `CACHE_STORES`, which is server state and rebuildable. The outbox, the
 * shift queue, the shift and the receipt counter are untouched: they hold work
 * that has not reached the server — money that crossed a counter — and they
 * have their own fence for the two-shop case. Losing them to a shop switch
 * would be a far worse bug than the one being fixed.
 */

/** What happened, so a caller can say so rather than guess. */
export interface OwnershipCheck {
  /** True when this database was holding another shop's data and was cleared. */
  cleared: boolean;
  /** The shop it used to belong to, when it belonged to a different one. */
  previous: string | null;
}

export async function ensureDatabaseBelongsTo(tenantId: string | null): Promise<OwnershipCheck> {
  // No shop signed in is not a handover. It is a page that has not finished
  // hydrating its auth store, and wiping a till's catalog on that would empty
  // every device on every cold start.
  if (tenantId === null) return { cleared: false, previous: null };

  const meta = (await getSingleton<SyncMeta>(STORE.SYNC_META)) ?? null;
  const owner = meta?.tenantId ?? null;

  if (owner === tenantId) return { cleared: false, previous: null };

  // UNKNOWN IS CLAIMED, NOT WIPED.
  //
  // A database written before this stamp existed has no owner recorded, and
  // every till in the field is in that state on the day this ships. Reading
  // "no owner" as "somebody else's" would clear all of them at once, to fix a
  // handover that has not happened on any of them.
  if (owner === null) {
    await putSingleton(STORE.SYNC_META, { ...(meta ?? emptyish()), tenantId });
    return { cleared: false, previous: null };
  }

  // A DIFFERENT shop. Everything cached here describes a business this login
  // has no right to see.
  await clearCaches();

  // AND THE CURSORS WITH IT, which is the half that would have been missed.
  // `SYNC_META` is deliberately not a cache store — it holds the clock skew and
  // the cursors — so clearing the catalog while leaving them behind would send
  // the next pull asking for a DELTA against the other shop's position. The
  // till would report a healthy sync and hold an empty shelf.
  await putSingleton(STORE.SYNC_META, {
    cursors: {},
    clockSkewMs: meta?.clockSkewMs ?? 0,
    lastPullAt: null,
    tenantId,
  } satisfies SyncMeta);

  return { cleared: true, previous: owner };
}

const emptyish = (): SyncMeta => ({ cursors: {}, clockSkewMs: 0, lastPullAt: null, tenantId: null });
