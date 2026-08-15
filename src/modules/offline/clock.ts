import { readMeta } from "./sync/applyPull";

/**
 * The shop's clock, on a till that cannot ask for it.
 *
 * ── Why the tablet's own time is not good enough ────────────────────────
 *
 * A cheap Android that has been flat for a week comes back believing it is the
 * day it left the factory. A tablet nobody ever set up is on the timezone it
 * shipped with. Neither is unusual, and neither announces itself — the clock in
 * the corner of the screen is simply wrong and nobody looks at it.
 *
 * Online that costs nothing, because the server stamps every sale. Offline it
 * is the most expensive field on the row: `sold_at` decides the trading day,
 * the shift, whose figures the sale lands in, and whether the day it belongs to
 * had already been counted, closed and banked. A sale filed three days back
 * makes two days' takings wrong at once and lands in a drawer that was counted
 * on Tuesday.
 *
 * ── The measurement already exists ──────────────────────────────────────
 *
 * Every catalog pull carries `server_time`, and `applyPull` records the gap as
 * `clockSkewMs`. This is the one place that turns it back into a moment, so
 * that "what time is it" has a single answer on this till instead of one per
 * caller. The pricing engine, the promotion windows and the sale's own stamp
 * all read from here.
 *
 * ── What it is NOT ──────────────────────────────────────────────────────
 *
 * Not a guarantee. A till that has never pulled has no measurement and reads
 * its own clock, unchanged — there is nothing else it could do. That case is
 * caught on arrival instead: the server refuses to file a sale in the future or
 * before the till's own last contact with it. This is the correction; that is
 * the bound; neither is sufficient on its own.
 */

/** How far this till's clock is behind the server, in ms. Ahead reads negative. */
export async function driftMs(): Promise<number> {
  try {
    const drift = (await readMeta()).clockSkewMs;

    return Number.isFinite(drift) ? drift : 0;
  } catch {
    // A till that cannot read its own sync metadata still has to sell. Zero is
    // the honest answer — "no measurement" — and it is what a till that has
    // never pulled reports anyway.
    return 0;
  }
}

/** What time it is in the shop, as best this till can tell. */
export async function shopNow(): Promise<Date> {
  return new Date(Date.now() + (await driftMs()));
}

/**
 * Any moment this till stamped from its OWN clock, moved onto the shop's.
 *
 * The same offset, because it is the same clock that was wrong when the moment
 * was recorded. `lastServerContact` is the one that matters: it is the floor
 * the server measures a sale against, and a floor left on the tablet's clock
 * while the sale moved onto the server's would be two numbers that no longer
 * describe the same day.
 */
export async function corrected(epochMs: number): Promise<Date> {
  return new Date(epochMs + (await driftMs()));
}
