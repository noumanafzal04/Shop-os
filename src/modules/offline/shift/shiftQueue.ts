import { getAll, getAllByIndex, put } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * Shift events rung with no server: opened, drawer moved, counted out.
 *
 * ── Why this is not the outbox ──────────────────────────────────────────
 *
 * It is the outbox's sibling and holds work that exists nowhere else, so it is
 * durable for the same reason. It is a SEPARATE queue because it has to be
 * flushed AROUND the sale queue rather than inside it:
 *
 *   opens   → BEFORE the sales, so a synced sale has a shift to name
 *   sales
 *   the rest → AFTER, so the drawer is counted against every sale inside it
 *
 * A close that overtook its own sales would report a variance the exact size of
 * the day's takings, and a shop would spend the evening looking for money that
 * had not gone anywhere.
 *
 * ── Why the till mints the session id ───────────────────────────────────
 *
 * A shift has to have an id before it reaches the server, because the sales
 * queued behind it already name one. A uuid does not collide, so this needs no
 * `OFF-…` scheme: that exists because an invoice NUMBER is a position in one
 * shop-wide sequence and two tills would take the same one. An id is not a
 * sequence.
 */

export const SHIFT_OP_STATUS = {
  PENDING: "pending",
  SENDING: "sending",
  ACKED: "acked",
  FAILED: "failed",
} as const;

export type ShiftOpStatus = (typeof SHIFT_OP_STATUS)[keyof typeof SHIFT_OP_STATUS];

/** What happened at the drawer. The server applies each in the order given. */
export type ShiftOpKind = "open" | "movement" | "close";

export interface ShiftOpRow {
  /** The operation id, minted when the cashier acted. Also the key. */
  op: string;
  kind: ShiftOpKind;
  /**
   * ISO, on the SHOP's clock — this till's reading with its measured drift
   * applied. When the shift was opened or the drawer counted, never when it was
   * queued: a shift opened Tuesday and synced Friday belongs to Tuesday, and
   * every figure would still add up if it did not.
   */
  at: string;
  /** The shift this is about. Minted here for an `open`, carried by the rest. */
  sessionId: string;
  /** The shop signed in when it was rung. See `belongsHere` in the outbox. */
  tenantId: string | null;
  /** Everything the endpoint needs for this kind, already in wire shape. */
  payload: Record<string, unknown>;
  status: ShiftOpStatus;
  createdAt: string;
  attempts: number;
  /** Null = send now. Set by a retry's backoff. */
  nextAttemptAt: string | null;
  lastError?: string;
}

export function newShiftOp(
  op: string,
  kind: ShiftOpKind,
  at: string,
  sessionId: string,
  payload: Record<string, unknown>,
  tenantId: string | null,
): ShiftOpRow {
  return {
    op,
    kind,
    at,
    sessionId,
    tenantId,
    payload,
    status: SHIFT_OP_STATUS.PENDING,
    createdAt: new Date().toISOString(),
    attempts: 0,
    nextAttemptAt: null,
  };
}

export async function enqueueShiftOp(row: ShiftOpRow): Promise<void> {
  await put(STORE.SHIFT_QUEUE, row);
}

/** Every shift event this device holds, whatever its status or its shop. */
export async function allShiftOps(): Promise<ShiftOpRow[]> {
  return getAll<ShiftOpRow>(STORE.SHIFT_QUEUE);
}

/**
 * What is owed, in the order it happened, for the shop that is signed in.
 *
 * `kinds` is the flush order, not a filter for convenience: the caller asks for
 * opens, sends the sales, then asks for the rest. Sorting by `createdAt` inside
 * each pass keeps two movements on one shift in the order the cashier made
 * them.
 *
 * An unknown tenant sends nothing — the same tie-break as the outbox, and for
 * the harder of its two reasons: a stuck row can be read, counted and
 * recovered; a drawer filed under the wrong business cannot.
 */
export async function dueShiftOps(
  kinds: readonly ShiftOpKind[],
  now: number = Date.now(),
  tenantId: string | null = null,
  /**
   * A PERSON PRESSED SYNC, so the backoff does not apply — the same rule the
   * sale queue already had, and the half of it that was never written.
   *
   * `dueRows` learned this when a cashier who watched four sales fail pressed
   * "Sync now" and was told "Up to date". The shift queue climbs the SAME
   * ladder, capped at the same ten minutes, and kept the old behaviour: a
   * press forced the sales and left the drawer events waiting. A till holding
   * only shift events answered every press by doing nothing at all, while the
   * badge — which counts both queues — went on reading seven.
   */
  force = false,
): Promise<ShiftOpRow[]> {
  if (tenantId === null) return [];

  const pending = await getAllByIndex<ShiftOpRow>(
    STORE.SHIFT_QUEUE,
    "by_status",
    SHIFT_OP_STATUS.PENDING,
  );

  return pending
    .filter((r) => kinds.includes(r.kind))
    .filter((r) => r.tenantId === tenantId)
    .filter((r) => force || r.nextAttemptAt === null || Date.parse(r.nextAttemptAt) <= now)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * SHIFT EVENTS THIS TILL IS HOLDING THAT NO AMOUNT OF SYNCING WILL SEND.
 *
 * The sale queue grew this reader after a shop watched "7 still to send" for
 * days while the fence did exactly what it was designed to do, silently. The
 * shift queue has the identical fence — `dueShiftOps` returns nothing at all
 * for an unknown tenant, and skips any row naming another shop — and nothing
 * ever read the rows it holds.
 *
 * That gap is worse here than it was there, because `owedShiftOps` counts
 * every pending row REGARDLESS of tenant. So a single orphaned drawer event
 * was added to the badge, withheld from the flush, and left out of the
 * stranded count that exists to explain exactly this — three numbers agreeing
 * that seven were waiting, and no screen anywhere able to say why none moved.
 */
export async function strandedShiftOps(tenantId: string | null): Promise<ShiftOpRow[]> {
  const rows = await allShiftOps();
  const finished: string[] = [SHIFT_OP_STATUS.ACKED, SHIFT_OP_STATUS.FAILED];

  return rows.filter((r) => !finished.includes(r.status) && r.tenantId !== tenantId);
}

/**
 * Adopting the drawer events this device rang before it knew its own shop.
 *
 * Deliberately as narrow as the sale queue's: ONLY rows naming no shop at all,
 * which is a bug of ours and not anything a shopkeeper did. A row naming a
 * DIFFERENT shop is never touched — that is the case the fence exists for.
 */
export async function adoptStrandedShiftOps(tenantId: string | null): Promise<number> {
  if (tenantId === null) return 0;

  const orphans = (await strandedShiftOps(tenantId)).filter((r) => r.tenantId == null);
  for (const row of orphans) {
    await put(STORE.SHIFT_QUEUE, { ...row, tenantId, nextAttemptAt: null });
  }

  return orphans.length;
}

export async function markShiftOpsSending(rows: readonly ShiftOpRow[]): Promise<void> {
  for (const row of rows) {
    await put(STORE.SHIFT_QUEUE, { ...row, status: SHIFT_OP_STATUS.SENDING, attempts: row.attempts + 1 });
  }
}

export async function markShiftOpAcked(row: ShiftOpRow): Promise<void> {
  await put(STORE.SHIFT_QUEUE, { ...row, status: SHIFT_OP_STATUS.ACKED, nextAttemptAt: null });
}

/** The same ladder the sale queue climbs, for the same reasons. */
export const SHIFT_BACKOFF_MS = [0, 5_000, 30_000, 120_000, 600_000];

export async function markShiftOpRetry(
  row: ShiftOpRow,
  error: string,
  now: number = Date.now(),
): Promise<void> {
  const wait = SHIFT_BACKOFF_MS[Math.min(row.attempts, SHIFT_BACKOFF_MS.length - 1)];

  await put(STORE.SHIFT_QUEUE, {
    ...row,
    status: SHIFT_OP_STATUS.PENDING,
    nextAttemptAt: new Date(now + wait).toISOString(),
    lastError: error,
  });
}

/**
 * An answer that will not change.
 *
 * Reserved for a refusal the server has actually made — never for a connection
 * that dropped. A shift event marked failed is one a person has to be told
 * about, because the drawer it describes was real.
 */
export async function markShiftOpFailed(row: ShiftOpRow, error: string): Promise<void> {
  await put(STORE.SHIFT_QUEUE, {
    ...row,
    status: SHIFT_OP_STATUS.FAILED,
    nextAttemptAt: null,
    lastError: error,
  });
}

/**
 * How many shift events this till is still holding.
 *
 * Counted as "everything not definitively finished" rather than "everything
 * pending", the same way the sale queue counts: this store is read by builds
 * newer than the one that wrote a row, so a status this build does not
 * recognise will happen. An over-count makes somebody ask a question; an
 * under-count makes nobody ask anything.
 */
export async function owedShiftOps(): Promise<number> {
  const rows = await getAllByIndex<ShiftOpRow>(STORE.SHIFT_QUEUE, "by_status", SHIFT_OP_STATUS.PENDING);
  const sending = await getAllByIndex<ShiftOpRow>(STORE.SHIFT_QUEUE, "by_status", SHIFT_OP_STATUS.SENDING);

  return rows.length + sending.length;
}
