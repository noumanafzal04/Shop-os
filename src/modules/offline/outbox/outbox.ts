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
  /**
   * ISO. When the money crossed the counter, never when it was queued.
   *
   * On the SHOP's clock — this till's own reading with its measured drift
   * applied. It becomes `sold_at`, which decides the trading day, the shift,
   * whose figures it lands in and whether that day was already signed off, so
   * a tablet three days out would file a whole outage into days that had been
   * counted and banked before the cut began.
   */
  at: string;
  /**
   * The same moment on the TABLET's own clock, uncorrected.
   *
   * Never used for a figure. It exists so the shop can be told that counter
   * two is three days behind — a correction nobody can see is a clock that
   * goes on being wrong every morning for ever. Optional: rows written by a
   * build older than the correction have no such reading to report.
   */
  clientAt?: string;
  /**
   * WHO rang it.
   *
   * Not who sends it. The queue is flushed by whoever reconnects — the evening
   * cashier, a manager, an owner opening the till after a week — and the
   * server stamps `created_by` from whoever is authenticated. Without this, one
   * cashier's whole day lands in another's staff report.
   */
  rungBy?: string | null;
  /** OFF-{register}-{device}-{seq}. What the customer's slip says. */
  offlineNumber: string;
  /** When this device last reached the server, so lateness can be judged. */
  offlineSince: string | null;
  /**
   * WHICH SHOP this sale belongs to.
   *
   * The outbox lives in IndexedDB, which is scoped to the browser ORIGIN — not
   * to the shop that is signed in. One laptop, two shops (an owner with two
   * tenants, a support machine, a demo) share one queue. Without this the boot
   * after switching accounts would flush shop A's unsent sales under shop B's
   * token, and the server would do exactly as it was told: record them as
   * shop B's, priced from shop B's catalog, in shop B's books.
   *
   * Nothing about that is recoverable by a shopkeeper. So a row names its shop,
   * and a row whose shop is not the one signed in is not sent.
   */
  tenantId: string | null;
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
  // Bundled rather than trailing positionals: two of these are a boolean and a
  // string, and `newRow(op, at, num, payload, null, false, "019f…")` is a call
  // nobody can read and anybody can transpose.
  {
    training = false,
    tenantId = null,
    clientAt,
    rungBy = null,
  }: {
    training?: boolean;
    tenantId?: string | null;
    clientAt?: string;
    rungBy?: string | null;
  } = {},
): OutboxRow {
  return {
    op,
    at,
    clientAt,
    rungBy,
    offlineNumber,
    offlineSince,
    sale,
    training,
    tenantId,
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
export async function dueRows(
  now: number = Date.now(),
  tenantId: string | null = null,
  /**
   * A PERSON PRESSED SYNC, so the backoff does not apply.
   *
   * The exponential wait is right for the automatic sync — a till back from two
   * days away must not re-send its whole queue in its first minute. It is wrong
   * for a press. The backoff caps at ten minutes, so a cashier who watched four
   * sales fail, pressed "Sync now", and was told "Up to date" was reading the
   * literal truth about a flush that found nothing DUE and sent nothing at all.
   *
   * A press is not a poll. Somebody is standing there, with the shop's money in
   * the queue, asking for it to go now.
   */
  force = false,
): Promise<OutboxRow[]> {
  const pending = await getAllByIndex<OutboxRow>(STORE.OUTBOX, "by_status", OUTBOX_STATUS.PENDING);

  return pending
    .filter((r) => force || r.nextAttemptAt === null || Date.parse(r.nextAttemptAt) <= now)
    .filter((r) => belongsHere(r, tenantId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * WHY THIS DOES NOT COUNT ANYTHING ITSELF.
 *
 * The till badge already answers "how much is this device holding" through
 * `pendingCount()` — which counts sales AND unsent shift events, because a
 * drawer counted with no server is work owed exactly as much as a sale is.
 *
 * The first version of this function walked the outbox again and counted only
 * sales. That would have put a second number on the same screen as the badge,
 * disagreeing with it by however many shift events were queued — which is the
 * precise defect this whole change exists to remove. A control that says
 * "3 still to send" beside a badge reading 4 is no better than one that said
 * "Up to date" beside a badge reading 4.
 *
 * So it reuses the counters the badge reuses, and the two cannot drift.
 */
export async function queueSummary(tenantId: string | null = null): Promise<{
  waiting: number;
  failed: number;
  /** Of the waiting, how many the fence will never let go. See strandedRows. */
  stranded: number;
  lastError: string | null;
}> {
  const { pendingCount } = await import("../db/repo");
  // BOTH QUEUES, because the badge counts both.
  //
  // `pendingCount` is sales + shift events, and the first version of this asked
  // only the sale queue for its stranded figure. A till holding one orphaned
  // drawer event therefore read "1 still to send" for ever: counted by the
  // badge, withheld by the shift queue's own fence, and absent from the one
  // number whose whole job is to say why nothing moves. Exactly the bug this
  // function was written to end, surviving in the half nobody looked at.
  const { strandedShiftOps } = await import("../shift/shiftQueue");
  const [waiting, failed, rows, stranded, strandedShifts] = await Promise.all([
    pendingCount(),
    refusedCount(),
    allRows(),
    strandedRows(tenantId),
    strandedShiftOps(tenantId),
  ]);

  return {
    waiting,
    failed,
    stranded: stranded.length + strandedShifts.length,
    // The most recent thing the server or the link actually said. A count with
    // no reason beside it is what sends a shopkeeper to a phone call.
    lastError: rows.map((r) => r.error).find((e) => e !== null) ?? null,
  };
}

/**
 * Is this row's shop the shop that is signed in?
 *
 * The rule that keeps one browser's two shops apart. IndexedDB is scoped to the
 * ORIGIN, so a laptop used for two tenants has ONE queue, and a flush after
 * switching accounts would post shop A's sales under shop B's token. The server
 * would do exactly as told and file them as shop B's — money moved between two
 * businesses, silently, with no way for a shopkeeper to unpick it.
 *
 * An UNKNOWN tenant is held rather than sent. Everywhere else in this file the
 * asymmetry is "sending twice costs a lookup, not sending costs the sale" — but
 * there is a third outcome here and it is worse than both, so the tie breaks
 * the other way. A stuck row can still be read, counted and recovered; a row
 * filed under the wrong business cannot.
 *
 * `tenantId === null` means the caller did not say which shop is signed in, and
 * the only safe reading of that is the same one: do not send.
 */
export function belongsHere(row: OutboxRow, tenantId: string | null): boolean {
  return tenantId !== null && row.tenantId === tenantId;
}

/**
 * SALES THIS TILL IS HOLDING THAT NO AMOUNT OF SYNCING WILL SEND.
 *
 * The tenant fence is right, and its reasoning is worth repeating: a stuck row
 * can be read, counted and recovered; a row filed under the wrong business
 * cannot. So a row that names another shop — or names none at all, because the
 * auth store had not hydrated when Complete was pressed — is held rather than
 * guessed at.
 *
 * What was NOT true is the first half of that sentence. Nothing read them.
 * `owedCount` counted them, `dueRows` never offered them, and every press of
 * Sync came back having sent nothing with no explanation available anywhere.
 * A shop watched "7 still to send" for days while the till did exactly what it
 * was designed to do, silently.
 *
 * Being held is a decision. It has to be a VISIBLE one.
 */
export async function strandedRows(tenantId: string | null): Promise<OutboxRow[]> {
  const rows = await allRows();
  const finished: string[] = [OUTBOX_STATUS.ACKED, OUTBOX_STATUS.FAILED];

  return rows.filter((r) => !finished.includes(r.status) && !belongsHere(r, tenantId));
}

/**
 * THE RECOVERY THE FENCE ALWAYS PROMISED.
 *
 * "A stuck row can be read, counted and recovered" is the sentence the tenant
 * fence is justified by. Reading and counting arrived with `strandedRows`;
 * this is the recovering, and it is deliberately narrow.
 *
 * It adopts ONLY rows that name no shop at all — sales this device rang while
 * the auth store had not hydrated its tenant, which is a bug of ours and not
 * anything a shopkeeper did. A row that names a DIFFERENT shop is never
 * touched: that is the case the fence exists for, and no button should be able
 * to move one business's takings into another's books.
 *
 * Never automatic. A person has to ask for it, having been shown what they are
 * about to claim — because the till genuinely cannot know, and a silent guess
 * is the exact failure being guarded against.
 */
export async function adoptStranded(tenantId: string | null): Promise<number> {
  if (tenantId === null) return 0;

  const orphans = (await strandedRows(tenantId)).filter((r) => r.tenantId == null);
  for (const row of orphans) {
    await put(STORE.OUTBOX, {
      ...row,
      tenantId,
      // Clear the wait too: the shop has just asked for these to go.
      nextAttemptAt: null,
    });
  }

  return orphans.length;
}

/**
 * Why this row is going nowhere, in words a shopkeeper can act on.
 *
 * Takes the shop stamp rather than a whole outbox row, because the shift queue
 * is held by the identical fence for the identical reason and a second copy of
 * this sentence would drift from the first.
 */
export function strandedReason(row: { tenantId: string | null }): string {
  return row.tenantId == null
    ? "This was saved without recording which shop it belongs to, so the till will not guess."
    : "This belongs to a different shop that was signed in on this device.";
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

/**
 * SALES THE SERVER REFUSED FOR GOOD, AND NOBODY HAS BEEN TOLD ABOUT.
 *
 * `owedCount` above answers "how much is still to SEND", and refused rows are
 * rightly not in it — sending them again cannot change the answer. But that
 * left them in no count at all, and `markFailed` keeps a row precisely so the
 * shop can act on it. Its own note says a dropped one would leave "a customer
 * holding a receipt for something the shop has no record of, and nobody would
 * ever know to look" — and then nothing looked.
 *
 * What that costs a shop is the worst thing in this module. The line drops, a
 * cashier rings an item the mirror still thinks is on the shelf, the customer
 * pays and walks out. The line returns, the server refuses the sale, the row
 * goes quiet, **the pill reads "Online"**, and the day closes with cash in the
 * drawer against no sale at all. The drawer is over and nobody can say why.
 *
 * So a refusal is not finished. It is owed to a PERSON rather than to the
 * server, and this is the question that says so.
 *
 * Not reported by the offline report either, and it could not be: that screen
 * asks the SERVER what happened while the shop was away, and a refused sale is
 * the one thing that never reached it.
 */
export async function refusedRows(): Promise<OutboxRow[]> {
  const rows = await allRows();

  return rows
    .filter((r) => r.status === OUTBOX_STATUS.FAILED)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function refusedCount(): Promise<number> {
  return (await refusedRows()).length;
}

/**
 * The money on a refused row, read back out of the payload it was queued with.
 *
 * Defensive about the shape on purpose: this row may have been written by an
 * older build, and a screen that throws while listing refused sales is a
 * screen that hides them — which is the defect it exists to fix. An amount
 * that cannot be read comes back null and the list says so rather than
 * printing "Rs 0", which a shopkeeper would read as a sale worth nothing.
 */
export function refusedTotal(row: OutboxRow): number | null {
  const total = (row.sale as { total?: unknown } | null)?.total;
  const n = typeof total === "string" ? Number(total) : total;

  return typeof n === "number" && Number.isFinite(n) ? n : null;
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
