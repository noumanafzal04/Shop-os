import { uuid } from "../../common/uuid";
import type { HeldSale } from "./services/posService";

/**
 * Tickets parked on THIS till, when there is no server to park them on.
 *
 * ── Why an offline hold is a different thing, not a queued one ──────────
 *
 * Online, a held ticket is shop-wide: a customer parked at lane 1 walks to lane
 * 3 and is picked up there, and the server hands the cart over in one locked
 * step so two lanes cannot ring the same basket twice.
 *
 * With no server none of that is available, and pretending otherwise would be
 * worse than not offering it. So an offline hold is honestly smaller: it is
 * **parked on this device**, and only this device can recall it. The offline
 * plan says the same in one word — "local only".
 *
 * ── Why it is never pushed to the server afterwards ─────────────────────
 *
 * A held ticket is an INTENT, not money. The outbox exists because a sale that
 * never arrives is a customer who paid and vanished from the books; nothing of
 * the sort is true here. Syncing them would be actively wrong: the queue can
 * only flush after the line returns, by which time the tickets have usually
 * been recalled and rung — so the shop would find its lanes offering baskets
 * that had already been sold.
 *
 * ── Why localStorage and not the till's database ────────────────────────
 *
 * The same place, and the same lifetime, as the open cart (`cartStorage.ts`).
 * Both are a basket someone means to come back to within the hour, both are
 * per device, and both hold intent that the server recomputes anyway — every
 * price on a recalled line is priced again at checkout. It also keeps this out
 * of the offline schema, whose stores are either work owed to the server or a
 * cache of it, and this is neither.
 */

const KEY = "shopos-pos-held";

/** Older than this and it is yesterday's ticket, not a parked customer. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface LocalHeld extends HeldSale {
  /** Marks the row wherever it is shown beside the shop-wide ones. */
  local: true;
  /** The shop that was signed in. One browser can serve two of them. */
  tenantId: string | null;
  savedAt: number;
}

function read(): LocalHeld[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];

    const rows = JSON.parse(raw) as LocalHeld[];

    return Array.isArray(rows) ? rows : [];
  } catch {
    // A corrupt or half-written value must not stop the till opening. An empty
    // list is the honest reading of "this cannot be understood".
    return [];
  }
}

function write(rows: LocalHeld[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    // Out of quota. A ticket that could not be parked is a cashier who has to
    // ring the basket now — annoying, and not a reason to lose the basket by
    // throwing here.
  }
}

/** This shop's parked tickets, newest first, minus anything stale. */
export function localHeld(tenantId: string | null, now: number = Date.now()): LocalHeld[] {
  return read()
    .filter((row) => row.tenantId === tenantId)
    .filter((row) => now - row.savedAt < MAX_AGE_MS)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function holdLocally(
  payload: { label?: string; cart: HeldSale["cart"]; total_estimate: number },
  tenantId: string | null,
  now: number = Date.now(),
): LocalHeld {
  const row: LocalHeld = {
    id: `local-${uuid()}`,
    label: payload.label ?? null,
    total_estimate: payload.total_estimate,
    cart: payload.cart,
    created_at: new Date(now).toISOString(),
    local: true,
    tenantId,
    savedAt: now,
  };

  // Stale rows are dropped on write rather than only on read, so a till left
  // open for a week does not accumulate a year of baskets in localStorage.
  write([...read().filter((r) => now - r.savedAt < MAX_AGE_MS), row]);

  return row;
}

/**
 * Take a ticket back, and remove it in the same step.
 *
 * The server's claim is one locked operation for a reason — two lanes must not
 * both ring one basket. On a single device the same rule is trivially true, and
 * keeping the shape identical means the caller does not branch.
 */
export function claimLocalHeld(id: string, tenantId: string | null): LocalHeld | null {
  const rows = read();
  const found = rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;

  if (found !== null) write(rows.filter((r) => r.id !== id));

  return found;
}

export function removeLocalHeld(id: string, tenantId: string | null): void {
  write(read().filter((r) => !(r.id === id && r.tenantId === tenantId)));
}

/** Is this one of ours? The id says so, so a caller needs no second lookup. */
export function isLocalHeld(id: string): boolean {
  return id.startsWith("local-");
}
