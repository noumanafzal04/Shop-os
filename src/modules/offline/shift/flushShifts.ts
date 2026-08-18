import { apiPost } from "../../../common/api/client";
import { deviceId } from "../device/deviceId";
import {
  dueShiftOps,
  markShiftOpAcked,
  markShiftOpFailed,
  markShiftOpRetry,
  markShiftOpsSending,
  type ShiftOpKind,
  type ShiftOpRow,
} from "./shiftQueue";

/**
 * Sending the shift events this till is holding.
 *
 * ── Called twice per sync, and the order is the point ───────────────────
 *
 * `pullNow` runs this for `["open"]`, then the sale queue, then for
 * `["movement", "close"]`. A shift has to exist before the sales that name it,
 * and the drawer has to be counted after them — a close that overtook its own
 * sales would report a variance the exact size of the day's takings, and the
 * shop would spend the evening looking for money that never moved.
 *
 * ── Why there is no lock here ───────────────────────────────────────────
 *
 * The sale flush takes a Web Lock so two tabs do not both post the same batch.
 * This runs inside that same sync pass, which is already single-flight per tab
 * via `pullNow`, and every operation carries an idempotency key the server
 * honours — a replayed open finds its session, a replayed close finds the shift
 * already counted, and a replayed movement finds its key. Two tabs racing costs
 * a duplicate request and changes nothing.
 */

/** How many go in one request. Matched to the server's own ceiling. */
export const SHIFT_BATCH = 50;

export interface ShiftFlushResult {
  sent: number;
  acked: number;
  failed: number;
}

interface ShiftOpResult {
  op: string;
  status: "applied" | "duplicate" | "failed";
  session_id: string | null;
  shift_status: string | null;
  violations?: string[];
  message?: string;
  retryable?: boolean;
}

export const shiftSyncApi = {
  sync: (operations: unknown[]) =>
    apiPost<{ results: ShiftOpResult[]; accepted: number }>("/pos/sync/shifts", {
      device_id: deviceId(),
      operations,
    }),
};

/** The wire shape. Built here so the stored row can widen freely. */
function wire(row: ShiftOpRow): Record<string, unknown> {
  return {
    op: row.op,
    kind: row.kind,
    at: row.at,
    session_id: row.sessionId,
    ...row.payload,
  };
}

export async function flushShifts(
  kinds: readonly ShiftOpKind[],
  tenantId: string | null = null,
): Promise<ShiftFlushResult> {
  const result: ShiftFlushResult = { sent: 0, acked: 0, failed: 0 };

  const due = await dueShiftOps(kinds, Date.now(), tenantId);
  const batch = due.slice(0, SHIFT_BATCH);
  if (batch.length === 0) return result;

  await markShiftOpsSending(batch);

  let results: ShiftOpResult[];
  try {
    results = (await shiftSyncApi.sync(batch.map(wire))).data.results;
  } catch (error) {
    // The link died, or the server refused the whole batch. Every row goes back
    // to PENDING with a wait — never to FAILED, which is reserved for an answer
    // that will not change.
    const message = error instanceof Error ? error.message : "Could not reach the server";
    for (const row of batch) await markShiftOpRetry(row, message);

    return result;
  }

  const byOp = new Map(results.map((r) => [r.op, r]));

  for (const row of batch) {
    const answer = byOp.get(row.op);

    if (answer === undefined) {
      // The server said nothing about this one. It may or may not have landed,
      // and only one of those assumptions can lose a drawer — so it is sent
      // again, and the operation key absorbs the duplicate.
      await markShiftOpRetry(row, "The server did not answer for this shift event");
      continue;
    }

    if (answer.status === "failed") {
      // A movement or close whose shift has not arrived is retryable BY
      // DESIGN: the next pass carries the open. Marking it failed for good
      // would throw away money that left the drawer.
      if (answer.retryable === true) {
        await markShiftOpRetry(row, answer.message ?? "Could not be recorded");
      } else {
        await markShiftOpFailed(row, answer.message ?? "The shop refused this shift event");
        result.failed += 1;
      }
      continue;
    }

    // `duplicate` is a success: the server already has it, which is exactly
    // what this row was owed.
    await markShiftOpAcked(row);
    result.acked += 1;
  }

  result.sent += batch.length;

  return result;
}
