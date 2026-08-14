import { get, getAll, getAllByIndex, put, putMany } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * The queue of sales that have happened but not yet reached the server.
 *
 * This is the only store in the whole till that holds money. Everything else is
 * a cache the server can send again; a row in here is a customer who has paid
 * and walked out, and it exists nowhere else in the world.
 *
 * ── The status machine, and the one transition that matters ─────────────
 *
 *   PENDING  → queued, owed to the server
 *   SENDING  → in flight right now
 *   ACKED    → the server has it; kept a while, then pruned
 *   FAILED   → the server refused it for a reason retrying cannot change
 *
 * `SENDING` is not a state a row may be left in. The tab was closed, or the
 * tablet's battery died, mid-request — and nobody knows whether the server got
 * it. Left alone, that row is never sent again and the sale is gone. So on
 * every boot every SENDING row is moved back to PENDING and sent again, and the
 * duplicate that may cause is absorbed by the server's idempotency on `op`.
 *
 * Sending twice is a lookup. Not sending at all is lost money. That asymmetry
 * decides every doubtful case in this file.
 */

export const OUTBOX_STATUS = {
  PENDING: "pending",
  SENDING: "sending",
  ACKED: "acked",
  FAILED: "failed",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/** One sale, exactly as the till will send it. */
export interface OutboxRow {
  /** The operation id — minted when Complete was pressed. Also the key. */
  op: string;
  /** ISO. When the money crossed the counter, never when it was queued. */
  at: string;
  /** OFF-{register}-{device}-{seq}. What the customer's slip says. */
  offlineNumber: string;
  /** When this device last reached the server, so lateness can be judged. */
  offlineSince: string | null;
  /** The sale payload, in the shape the sync endpoint takes. */
  sale: Record<string, unknown>;
  /**
   * Was this till standing at a PRACTICE drawer when it rang this?
   *
   * Sent alongside the sale, and read as false whenever it is missing. The
   * server needs both this and the shift to agree before a synced sale counts
   * as practice, because a shift id alone — named by a client, hours later —
   * would be a way to make a real sale take no stock and earn no revenue.
   *
   * It is also what keeps the till's own shelf honest: practice takes nothing
   * off it, here as well as on the server.
   */
  training: boolean;
  status: OutboxStatus;
  createdAt: string;
  attempts: number;
  /** When it may next be tried. Backoff, so a dead link is not hammered. */
  nextAttemptAt: string | null;
  /** What the server said, when it refused. */
  error: string | null;
  /** The real invoice number, once it lands — so the slip can be reconciled. */
  invoiceNumber: string | null;
  /** What offline was not allowed to do, as the server reported it back. */
  violations: string[];
}

/**
 * A row is never destructively rewritten — fields are added to it.
 *
 * The schema note calls the outbox append-only for a reason: a reader on an app
 * version three releases newer must still be able to send a row written by an
 * older one. Widening is safe; renaming is how a queue of paid sales becomes
 * unreadable during an upgrade.
 */
export function newRow(
  op: string,
  at: string,
  offlineNumber: string,
  sale: Record<string, unknown>,
  offlineSince: string | null,
  training = false,
): OutboxRow {
  return {
    op,
    at,
    offlineNumber,
    offlineSince,
    sale,
    training,
    status: OUTBOX_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
    error: null,
    invoiceNumber: null,
    violations: [],
  };
}

export async function enqueue(row: OutboxRow): Promise<void> {
  await put(STORE.OUTBOX, row);
}

export async function readRow(op: string): Promise<OutboxRow | undefined> {
  return get<OutboxRow>(STORE.OUTBOX, op);
}

export async function allRows(): Promise<OutboxRow[]> {
  return getAll<OutboxRow>(STORE.OUTBOX);
}

/**
 * What is owed to the server, oldest first.
 *
 * Oldest first because a queue that sent its newest rows first would, on a link
 * that keeps dropping, leave the oldest sale unsent for ever — and the oldest
 * sale is the one closest to being forgotten by everyone who was there.
 */
export async function dueRows(now: number = Date.now()): Promise<OutboxRow[]> {
  const pending = await getAllByIndex<OutboxRow>(STORE.OUTBOX, "by_status", OUTBOX_STATUS.PENDING);

  return pending
    .filter((r) => r.nextAttemptAt === null || Date.parse(r.nextAttemptAt) <= now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * How much unsent money this till is holding. The number the cashier sees.
 *
 * Counted as "everything not definitively finished" rather than "everything
 * marked pending", and the difference matters on exactly the day it is hardest
 * to notice. This store is append-only and read by app versions newer than the
 * one that wrote a row, so a status this build does not recognise WILL happen.
 * Counting only the statuses we know would quietly report zero owed while the
 * till was still holding sales.
 *
 * An over-count makes a cashier ask a question. An under-count makes nobody
 * ask anything.
 */
export async function owedCount(): Promise<number> {
  const rows = await allRows();
  const finished: string[] = [OUTBOX_STATUS.ACKED, OUTBOX_STATUS.FAILED];

  return rows.filter((r) => !finished.includes(r.status)).length;
}

export async function markSending(rows: OutboxRow[]): Promise<void> {
  await putMany(
    STORE.OUTBOX,
    rows.map((r) => ({ ...r, status: OUTBOX_STATUS.SENDING, attempts: r.attempts + 1 })),
  );
}

export async function markAcked(
  row: OutboxRow,
  invoiceNumber: string | null,
  violations: string[] = [],
): Promise<void> {
  await put(STORE.OUTBOX, {
    ...row,
    status: OUTBOX_STATUS.ACKED,
    invoiceNumber,
    violations,
    error: null,
  });
}

/**
 * Back to PENDING with a wait — the link was down, or the answer may change.
 *
 * Exponential, capped. A till that has been away for two days must not spend
 * its first minute back re-sending its whole queue at once, and must not have
 * backed off to once an hour by then either.
 */
export const BACKOFF_MS = [0, 5_000, 30_000, 120_000, 600_000];

export async function markRetry(row: OutboxRow, error: string, now: number = Date.now()): Promise<void> {
  const wait = BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)];

  await put(STORE.OUTBOX, {
    ...row,
    status: OUTBOX_STATUS.PENDING,
    error,
    nextAttemptAt: new Date(now + wait).toISOString(),
  });
}

/**
 * The server refused it for a reason sending it again cannot change.
 *
 * Kept, not deleted. A till that quietly dropped a refused sale would leave a
 * customer holding a receipt for something the shop has no record of, and
 * nobody would ever know to look.
 */
export async function markFailed(row: OutboxRow, error: string): Promise<void> {
  await put(STORE.OUTBOX, { ...row, status: OUTBOX_STATUS.FAILED, error });
}

/**
 * Every row left mid-flight goes back in the queue.
 *
 * Run on boot, before anything else touches the outbox. See the note at the
 * top: a SENDING row is a sale whose fate nobody knows, and the only safe
 * assumption is that it did not arrive.
 */
export async function recoverInFlight(): Promise<number> {
  const stuck = await getAllByIndex<OutboxRow>(STORE.OUTBOX, "by_status", OUTBOX_STATUS.SENDING);
  if (stuck.length === 0) return 0;

  await putMany(
    STORE.OUTBOX,
    // The attempt count is NOT reset. A row that keeps dying mid-flight has to
    // reach its backoff eventually, or a till stuck in a crash loop would
    // hammer the server every time it opened.
    stuck.map((r) => ({ ...r, status: OUTBOX_STATUS.PENDING, nextAttemptAt: null })),
  );

  return stuck.length;
}

/**
 * Drop the CART of what the server has definitely got, once it is old enough.
 *
 * The row itself stays, for ever, and that is the point: it is the only thing
 * that can answer "what became of the slip marked OFF-L1-AB-000123" — the one
 * reference a customer holds. That mapping is two short strings. The cart
 * behind it can be hundreds of lines, and the server has had it for a week.
 *
 * Not done immediately on ack, because an owner asking "did Tuesday's sales
 * go?" on Wednesday deserves an answer from the till itself.
 */
export const KEEP_ACKED_MS = 7 * 24 * 60 * 60 * 1000;

export async function pruneAcked(now: number = Date.now()): Promise<number> {
  const rows = await allRows();
  const stale = rows.filter(
    (r) => r.status === OUTBOX_STATUS.ACKED && now - Date.parse(r.createdAt) > KEEP_ACKED_MS,
  );

  for (const row of stale) {
    await put(STORE.OUTBOX, { ...row, sale: {} });
  }

  return stale.length;
}
