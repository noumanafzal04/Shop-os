import { applyPull, readMeta } from "./applyPull";
import { catalogService, PROJECTIONS, type Projection } from "./catalogService";
import { flushVariances } from "../pricing/varianceService";
import { touchIfDue } from "../device/touch";
import { flushOutbox, type FlushResult } from "../outbox/flush";
import { flushShifts, type ShiftFlushResult } from "../shift/flushShifts";
import { ensureDatabaseBelongsTo } from "../db/tillOwner";
import { useAuthStore } from "../../../stores/authStore";
import { useOfflineStore } from "../offlineStore";

/**
 * Fetching everything the server has for this till, and stopping.
 *
 * ── Why there is a round limit ──────────────────────────────────────────
 *
 * The loop continues while any projection reports `has_more`, which is exactly
 * what a 20,000-item first load needs. It is also an unbounded loop driven by a
 * value the server supplies, so a server bug that always answered `has_more`
 * would spin a till forever, on a metered connection, silently. The cap turns
 * that into a bounded amount of wasted work that shows up in the result.
 *
 * 200 rounds is 200,000 items at the current page size — far past any real
 * catalog, and far short of forever.
 */
const MAX_ROUNDS = 200;

export interface PullResult {
  /** Rows written, by projection, across every round. */
  applied: Record<Projection, number>;
  rounds: number;
  /** True when the cap stopped the loop rather than the server did. */
  truncated: boolean;
  /** What happened to the QUEUE on the way in. See the note on the flush. */
  flushed: FlushResult;
  /**
   * And what happened to the OTHER queue — the drawer events.
   *
   * Kept apart from `flushed` because they are two stores with two flushes,
   * and reported at all because the till badge adds them together. A press
   * that sent four shift events and no sales used to answer "0 sent, 4 still
   * waiting" on its way to sending them, which is a screen arguing with
   * itself while it works.
   */
  shifts: ShiftFlushResult;
}

const NO_SHIFTS: ShiftFlushResult = { sent: 0, acked: 0, failed: 0 };

/**
 * Only one pull at a time, per tab.
 *
 * Two overlapping pulls are not dangerous — every write is an upsert keyed by
 * id, so the worst case is duplicated work — but on a slow shop connection they
 * are two catalogs downloaded instead of one, and the second finishes with
 * older cursors than the first.
 *
 * Deliberately NOT a cross-tab lock. For a pull that would buy correctness
 * nobody is missing; the outbox in Phase 3 is where a Web Locks leader
 * genuinely matters, because sending a sale twice is not the same as fetching a
 * page twice.
 */
let inFlight: Promise<PullResult> | null = null;

export function pullNow(options: { force?: boolean } = {}): Promise<PullResult> {
  if (inFlight) return inFlight;

  inFlight = run(options.force === true).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Is a pull happening right now? Drives the indicator, nothing else. */
export function isPulling(): boolean {
  return inFlight !== null;
}

async function run(force = false): Promise<PullResult> {
  // MONEY OUT BEFORE CATALOG IN, and the order is the whole point. A till that
  // reconnects for ninety seconds on a bad shop link has time for one of these.
  // A stale price costs a wrong figure on one sale; an unsent sale costs the
  // sale. Whichever finishes, the more valuable one went first.
  //
  // It cannot fail the pull: a till must not stop learning its catalog because
  // its queue would not go, and the queue keeps everything it could not send.
  //
  // The shop that is SIGNED IN, not the shop the queue came from. IndexedDB is
  // scoped to the origin, so one laptop used for two tenants has one queue —
  // and without naming the shop here, the boot after switching accounts would
  // post shop A's unsent sales under shop B's token. Rows that do not belong to
  // this shop are held, not sent.
  //
  // The pill is told how far this got, and told it is finished either way.
  // `finally` rather than a line after the await: a flush that throws must not
  // leave "Sending 12 of 47" frozen on the till for the rest of the shift,
  // which is a worse lie than saying nothing.
  const { setSyncing } = useOfflineStore.getState();
  const tenantId = useAuthStore.getState().user?.tenant?.id ?? null;

  // WHOSE DATA IS ALREADY HERE? Before anything is read or written.
  //
  // IndexedDB is scoped to the origin, so a browser used by two shops has one
  // database, and the catalog in it carries no tenant. A till signed out of a
  // mart and into a pharmacy went on holding — and offering for sale — the
  // mart's products. Checked here because a pull is the one thing that happens
  // on every route into the till, so no door goes around it.
  //
  // It cannot fail the pull: a till that could not check ownership must still
  // sync, and the check runs again on the next pull a few seconds later.
  await ensureDatabaseBelongsTo(tenantId).catch(() => undefined);

  // SHIFT OPENS FIRST, and the order is not a preference.
  //
  // A sale rung offline names the shift it was rung into, and a shift opened
  // offline exists only on the device until this lands. Sending the sales first
  // would have every one of them naming a session the server has never heard
  // of — each answered "not yet", each retried, and the whole day held behind a
  // shift that would have gone through in one request.
  //
  // It cannot fail the rest: a till must not stop sending money because its
  // shift would not go, and the queue keeps everything it could not send.
  const opened = await flushShifts(["open"], tenantId, force).catch(() => NO_SHIFTS);

  const flushed = await flushOutbox(tenantId, (sent, total) => {
    // Nothing owed is not a sync worth narrating. Announcing "Sending 0 of 0"
    // every fifteen minutes teaches a cashier to stop reading the pill.
    if (total > 0) setSyncing({ sent, total });
  }, force)
    // Swallowed on purpose — a till must not stop learning its catalog because
    // its queue would not go. But the RESULT is kept and handed back, because
    // "Sync now" used to answer "Up to date" off the back of a pull that
    // succeeded while the queue it had just failed to send sat untouched.
    .catch((): FlushResult => ({ sent: 0, acked: 0, failed: 0, skipped: false }))
    .finally(() => setSyncing(null));

  // AND THE COUNT LAST. A close that overtook its own sales would compare the
  // counted cash against a drawer the server thinks is empty, and report a
  // variance the exact size of the day's takings — sending a shop looking all
  // evening for money that never moved. Drawer movements ride with it: they
  // only have to follow their own open.
  const counted = await flushShifts(["movement", "close"], tenantId, force).catch(() => NO_SHIFTS);
  const shifts: ShiftFlushResult = {
    sent: opened.sent + counted.sent,
    acked: opened.acked + counted.acked,
    failed: opened.failed + counted.failed,
  };

  const applied = Object.fromEntries(PROJECTIONS.map((p) => [p, 0])) as Record<Projection, number>;
  let rounds = 0;
  let truncated = false;

  for (;;) {
    const meta = await readMeta();
    const known = PROJECTIONS.filter((p) => meta.cursors[p]);

    // No cursor for ANYTHING means this till has never pulled, or its database
    // was cleared or evicted. Either way it needs the first load, and the first
    // load is the recovery path — there is deliberately no separate one.
    const { data } =
      known.length === 0
        ? await catalogService.bootstrap()
        : await catalogService.delta(meta.cursors);

    const result = await applyPull(data);
    rounds += 1;

    for (const projection of PROJECTIONS) {
      applied[projection] += result.applied[projection];
    }

    if (!result.hasMore) break;

    if (rounds >= MAX_ROUNDS) {
      truncated = true;
      break;
    }
  }

  // Diagnostics ride along with the catalog pull rather than on a timer of
  // their own: the moment a till can reach the server is the moment to send
  // what it found, and it costs one request that usually carries nothing.
  // It cannot fail the pull — a till must not stop learning its catalog
  // because a variance report did not go.
  const variances = await flushVariances();

  // And say we are still here. Registration happens once per app start, so
  // without this a tablet left open all week reads as a week out of contact
  // while it is syncing every quarter of an hour. It also carries the shadow
  // tally up, which matters most for the till that never finds anything and so
  // never has a variance to report.
  //
  // FORCED when findings just went up, rather than waiting for the five-minute
  // clock. Those two travel by different roads — a variance goes on this pull,
  // the tally rides the device touch — so a shop that has just found something
  // reads "9 carts priced differently" above "Carts checked: 2", which is a
  // screen contradicting itself at the exact moment somebody is trying to read
  // it. The denominator has to arrive with the numerator or it is not a
  // denominator.
  await touchIfDue(Date.now(), { force: variances.sent > 0 });

  return { applied, rounds, truncated, flushed, shifts };
}
