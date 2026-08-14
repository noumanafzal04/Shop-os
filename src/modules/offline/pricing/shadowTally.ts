import { getSingleton, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";

/**
 * How many carts this till has shadow-checked — and how they came out.
 *
 * ── Why a count of findings is not evidence on its own ──────────────────
 *
 * Offline selling is allowed once shadow mode has run over real trading and
 * found nothing. But an empty findings list is produced identically by two very
 * different worlds:
 *
 *   the engine agreed on 1,284 real carts     ← what we are hoping for
 *   the engine never ran once                 ← a till that never finished its
 *                                               catalog pull, so every check
 *                                               skipped, silently
 *
 * Only the first makes shipping safe, and the second is the quieter of the two:
 * nothing to see is exactly what it looks like. `checked` is what separates
 * them, which is why it is counted here rather than inferred from the pile of
 * findings — a pile that is pruned at 200 rows and stops being a count the day
 * a till gets busy.
 *
 * ── Why skips are counted, and counted by reason ────────────────────────
 *
 * A skip is not agreement. A fortnight of trading where nine carts in ten were
 * skipped for "an item is not in the local catalog yet" says the PROJECTION is
 * incomplete, which is a finding about the offline engine every bit as much as
 * a wrong total is — and one that would otherwise look like a clean sheet.
 */

/** What this till has done with the offline engine so far. */
export interface ShadowTally {
  checked: number;
  matched: number;
  skipped: number;
  differed: number;
  /** ISO. When this till started counting — reset when local storage is wiped. */
  since: string;
  /** Why checks were skipped, most useful diagnostic in the whole tally. */
  skips: Record<string, number>;
}

/**
 * Distinct skip reasons kept before the rest are lumped together.
 *
 * Bounded because the catch-all path reports an error message verbatim, and an
 * unbounded map of those on a till whose database is failing would grow without
 * limit in the storage that exists to hold unsent sales.
 */
export const MAX_REASONS = 12;

export function emptyTally(startedAt: string): ShadowTally {
  return { checked: 0, matched: 0, skipped: 0, differed: 0, since: startedAt, skips: {} };
}

export async function readTally(): Promise<ShadowTally | undefined> {
  return getSingleton<ShadowTally>(STORE.SHADOW_TALLY);
}

/**
 * Record one outcome.
 *
 * Never throws. It runs after the customer has paid, and a diagnostic counter
 * failing must not become the cashier's problem — but note that a bump lost to
 * a failed write costs the DENOMINATOR, not the finding, so it errs toward
 * under-claiming exactly like everything else here.
 */
export async function bumpTally(
  outcome: "matched" | "skipped" | "differed",
  reason?: string,
): Promise<void> {
  try {
    const tally = (await readTally()) ?? emptyTally(new Date().toISOString());

    tally.checked += 1;
    tally[outcome] += 1;

    if (outcome === "skipped") {
      const key = reason ?? "unknown";
      // A reason already being counted is always kept, however full the map is
      // — otherwise the first twelve reasons a till ever saw would lock out the
      // one that starts happening today.
      if (key in tally.skips || Object.keys(tally.skips).length < MAX_REASONS) {
        tally.skips[key] = (tally.skips[key] ?? 0) + 1;
      } else {
        tally.skips.other = (tally.skips.other ?? 0) + 1;
      }
    }

    await putSingleton(STORE.SHADOW_TALLY, tally);
  } catch {
    // A closed database, an evicted store, a quota. The sale is already done.
  }
}
