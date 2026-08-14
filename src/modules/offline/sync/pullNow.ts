import { applyPull, readMeta } from "./applyPull";
import { catalogService, PROJECTIONS, type Projection } from "./catalogService";
import { flushVariances } from "../pricing/varianceService";
import { touchIfDue } from "../device/touch";
import { flushOutbox } from "../outbox/flush";
import { useAuthStore } from "../../../stores/authStore";

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
}

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

export function pullNow(): Promise<PullResult> {
  if (inFlight) return inFlight;

  inFlight = run().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Is a pull happening right now? Drives the indicator, nothing else. */
export function isPulling(): boolean {
  return inFlight !== null;
}

async function run(): Promise<PullResult> {
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
  await flushOutbox(useAuthStore.getState().user?.tenant?.id ?? null).catch(() => ({}));

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

  return { applied, rounds, truncated };
}
