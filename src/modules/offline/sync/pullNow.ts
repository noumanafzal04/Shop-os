import { applyPull, readMeta } from "./applyPull";
import { catalogService, PROJECTIONS, type Projection } from "./catalogService";

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

  return { applied, rounds, truncated };
}
