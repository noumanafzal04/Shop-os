import type { CashSession } from "../../pos/services/posService";
import { getAllByIndex, put, remove } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * The shift this till is standing at, kept on the device.
 *
 * ── The bug this exists for ─────────────────────────────────────────────
 *
 * The POS disables Tender/Pay when there is no open shift, and the open shift
 * came from a live query with nothing behind it — no query persistence, and a
 * service worker that caches product images and no API responses. So the shift
 * lived in memory and nowhere else.
 *
 * An outage with the page still mounted sold fine, because the query kept its
 * last answer. **A reload while offline could not sell at all**, and a reload is
 * a tablet waking up, a PWA relaunch, or the power cut the Help Centre names by
 * name — after which the device reboots, the page reloads, and the whole offline
 * module sat behind a gate that needed the server it was built to do without.
 *
 * `STORE.SHIFT` was created for this in the first schema, listed among the
 * stores that are never dropped, and covered by a migration test. Nothing had
 * ever written to it.
 *
 * ── What it is safe to remember, and what is not ────────────────────────
 *
 * Only IDENTITY travels usefully: which session id this till is standing at,
 * whether it is a practice shift, which register, and the opening float. Every
 * one of those is fixed when the shift opens and cannot go stale.
 *
 * The MONEY on a session row can. `cash_sales`, `expected_cash` and
 * `sales_count` were true when the server last answered and are wrong the
 * moment the next sale is rung offline. They are stored — the mirror keeps the
 * row whole rather than inventing a smaller one — but nothing at the till reads
 * them, and nothing should start to. A drawer count is Phase C; presenting a
 * remembered `expected_cash` as a live figure would be a money reading a shop
 * acts on, and it would be wrong.
 *
 * ── Why the tenant is on the row ────────────────────────────────────────
 *
 * IndexedDB is scoped to the ORIGIN, so one laptop used for two shops has one
 * database. Without the fence, signing into shop B would hand it shop A's open
 * shift, and every sale rung on it would name a session that shop does not own.
 * The outbox is fenced the same way and for the same reason.
 */
export interface MirroredShift {
  /** The server's `cash_sessions.id`. Also the store's key. */
  id: string;
  status: "open" | "closed";
  /** The shop that was signed in when this was mirrored. Never crosses shops. */
  tenantId: string | null;
  /** The session row exactly as the server last described it. */
  session: CashSession;
  /** When the server last confirmed it — for support, not for arithmetic. */
  mirroredAt: number;
}

/**
 * Remember what the server just said, or forget what it says is gone.
 *
 * Called on every successful answer rather than only when the shift changes: an
 * answer is the only moment the device can be sure, and writing one small row
 * costs nothing against being wrong after a reload.
 *
 * A null session means the server says no shift is open. The mirror is cleared,
 * not left behind — a remembered shift that the shop has since closed is worse
 * than no shift at all, because the till would go on selling into it.
 */
export async function mirrorShift(
  session: CashSession | null,
  tenantId: string | null,
): Promise<void> {
  // The one row worth keeping — nothing when the server says no shift is open,
  // and nothing when it hands back a CLOSED one either. A closed drawer is not
  // a shift to sell into, and remembering it under its own id is how a till
  // goes on ringing sales into a drawer that has already been counted.
  const keep = session !== null && session.status === "open" ? session.id : null;

  const stale = await getAllByIndex<MirroredShift>(STORE.SHIFT, "by_status", "open");

  for (const row of stale) {
    // ONLY this shop's rows. Clearing every open row would mean signing into
    // shop B quietly destroyed shop A's remembered drawer — and shop A's till
    // would then be unable to sell after a reload, which is the exact failure
    // this whole module exists to prevent. Written after a test caught it.
    if (row.tenantId !== tenantId) continue;

    if (row.id !== keep) await remove(STORE.SHIFT, row.id);
  }

  if (keep === null || session === null) return;

  await put<MirroredShift>(STORE.SHIFT, {
    id: session.id,
    status: "open",
    tenantId,
    session,
    mirroredAt: Date.now(),
  });
}

/**
 * The open shift this device remembers for THIS shop, if any.
 *
 * Returns the session row itself, so a caller that has lost the server can carry
 * on with exactly what the server last said rather than a reduced copy of it.
 */
export async function mirroredShift(tenantId: string | null): Promise<CashSession | null> {
  const rows = await getAllByIndex<MirroredShift>(STORE.SHIFT, "by_status", "open");

  // A row belonging to another shop is not "no shift" — it is somebody else's,
  // and it is left alone rather than deleted. The other tenant's till will want
  // it back when that account signs in again.
  const mine = rows.find((row) => row.tenantId === tenantId);

  return mine?.session ?? null;
}

/** Drops every remembered shift. Tests only — a shop never wants this. */
export async function forgetShiftMirror(): Promise<void> {
  const rows = await getAllByIndex<MirroredShift>(STORE.SHIFT, "by_status", "open");
  for (const row of rows) await remove(STORE.SHIFT, row.id);
}
