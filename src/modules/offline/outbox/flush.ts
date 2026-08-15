import { apiPost } from "../../../common/api/client";
import { deviceId } from "../device/deviceId";
import {
  dueRows,
  markAcked,
  markFailed,
  markRetry,
  markSending,
  type OutboxRow,
} from "./outbox";

/**
 * Sending the sales this till is holding.
 *
 * ── Why exactly one tab may run this ────────────────────────────────────
 *
 * A cashier with the POS open in two tabs has two flushers reading the same
 * IndexedDB. Both would see the same PENDING rows, both would mark them SENDING
 * — the read and the write are not one atomic step across tabs — and both would
 * post them. The server's idempotency catches that and returns `duplicate`, so
 * no money is banked twice; but the whole batch is sent twice over a shop's
 * connection, and every ack races the other tab's write.
 *
 * Web Locks makes it one. The lock is held for the whole flush, and any second
 * caller simply does not run rather than queueing behind it — a queued flush
 * would fire the moment the first finished, against rows it had just retired.
 *
 * On a browser with no Web Locks the flush still runs. Being single-tab is a
 * saving of bandwidth and contention; correctness is the server's `op` key, and
 * it is not conditional on a browser API.
 *
 * ── Why results are applied one row at a time ───────────────────────────
 *
 * The server answers per operation: applied, duplicate, or failed. Applying
 * that as a batch would mean one unrecognised row leaves forty-nine correct
 * acknowledgements unwritten, and the next flush sends all fifty again.
 */

const LOCK = "shopos-outbox-flush";

/** How many go in one request. Matched to the server's own ceiling. */
export const BATCH = 50;

export interface FlushResult {
  sent: number;
  acked: number;
  failed: number;
  /** True when another tab already held the lock. Not an error. */
  skipped: boolean;
}

interface OperationResult {
  op: string;
  status: "applied" | "duplicate" | "failed";
  invoice_number: string | null;
  violations?: string[];
  message?: string;
  retryable?: boolean;
}

export const outboxApi = {
  sync: (operations: unknown[]) =>
    apiPost<{ results: OperationResult[]; accepted: number }>("/pos/sync", {
      device_id: deviceId(),
      operations,
    }),
};

/** The wire shape. Deliberately built here, so the stored row can widen freely. */
function wire(row: OutboxRow): Record<string, unknown> {
  return {
    op: row.op,
    at: row.at,
    // What the tablet's own clock said, before the drift was applied. Sent so
    // the shop can be told its clock is wrong; never used for a figure.
    client_at: row.clientAt ?? null,
    // The cashier who rang it, which is not the login sending it. The server
    // checks it names a live user of this shop and falls back to the sender.
    rung_by: row.rungBy ?? null,
    offline_number: row.offlineNumber,
    offline_since: row.offlineSince,
    // `=== true` rather than a cast: a row written by an older build has no
    // such field, and "we don't know" has to mean "real". A practice sale
    // recorded as real is visible and can be voided; a real sale recorded as
    // practice is invisible, which is exactly what the flag guards against.
    training: row.training === true,
    sale: row.sale,
  };
}

export async function flushOutbox(tenantId: string | null = null): Promise<FlushResult> {
  const locks = navigator.locks;
  if (locks === undefined) return runFlush(tenantId);

  let result: FlushResult = { sent: 0, acked: 0, failed: 0, skipped: true };

  // ifAvailable: a second tab declines rather than waits. A queued flush would
  // wake against rows the first tab had just retired.
  await locks.request(LOCK, { ifAvailable: true }, async (lock) => {
    if (lock === null) return;
    result = await runFlush(tenantId);
  });

  return result;
}

/**
 * A queue this long is a till that has been away for weeks, not a bug — but the
 * loop is driven by what the database keeps returning, so it gets a ceiling for
 * the same reason the catalog pull has one.
 */
const MAX_ROUNDS = 200;

async function runFlush(tenantId: string | null): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, acked: 0, failed: 0, skipped: false };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Counted per round, not across the flush. Using the running totals would
    // mean one successful batch made every later all-retried batch look like
    // progress, and the loop would never end.
    let moved = 0;
    const batch = (await dueRows(Date.now(), tenantId)).slice(0, BATCH);
    if (batch.length === 0) return result;

    await markSending(batch);

    let results: OperationResult[];
    try {
      results = (await outboxApi.sync(batch.map(wire))).data.results;
    } catch (error) {
      // The link died, or the server refused the whole batch. Every row goes
      // back to PENDING with a wait — NOT to FAILED, which is reserved for an
      // answer that will not change.
      const message = error instanceof Error ? error.message : "Could not reach the server";
      for (const row of batch) await markRetry(row, message);

      return result;
    }

    const byOp = new Map(results.map((r) => [r.op, r]));
    for (const row of batch) {
      const answer = byOp.get(row.op);

      if (answer === undefined) {
        // The server said nothing about this row. It may or may not have
        // landed, and only one of those assumptions can lose money — so it is
        // sent again, and the server's `op` key absorbs the duplicate.
        await markRetry(row, "The server did not answer for this sale");
        continue;
      }

      if (answer.status === "failed") {
        if (answer.retryable === true) {
          await markRetry(row, answer.message ?? "Could not be recorded");
        } else {
          await markFailed(row, answer.message ?? "The shop refused this sale");
          result.failed += 1;
          moved += 1;
        }
        continue;
      }

      // `duplicate` is a success: the server already has it, which is exactly
      // what this row was owed. Treating it as an error would leave a sale
      // queued for ever against a server that has already banked it.
      await markAcked(row, answer.invoice_number, answer.violations ?? []);
      result.acked += 1;
      moved += 1;
    }

    result.sent += batch.length;

    // A round where every row went back to PENDING made no progress. Looping
    // on it would spin against the same rows.
    if (moved === 0) return result;
  }

  return result;
}
