import { isDue } from "../../../common/kept/kept";
import { useAuthStore } from "../../../stores/authStore";
import { queueTally } from "../db/repo";
import { ensureDatabaseBelongsTo } from "../db/tillOwner";
import { readMeta } from "./applyPull";
import { PROJECTIONS } from "./catalogService";

/**
 * How long a till that has everything goes without asking again merely
 * because a screen was opened.
 *
 * The same five minutes as the announcement (`TOUCH_EVERY_MS`), and for the
 * same reason: it is short against everything the catalogue is for. A price
 * corrected at the office reaches an open till in fifteen at the outside
 * (`HEARTBEAT_MS`); a till reloaded more often than that is not behind one
 * that was left alone.
 */
export const PULL_ON_OPEN_EVERY_MS = 5 * 60 * 1000;

/**
 * DOES OPENING A SCREEN NEED A PULL?
 *
 * It always did one: every load of every screen sent what was queued and
 * asked "what changed in the catalogue" — a moment after the last screen had
 * asked the same. So the question is put to the device first.
 *
 *   something is waiting to be sent   yes, and at once. Money out is the one
 *                                     thing a till never puts off.
 *   it has never had the catalogue    yes — a new device, a cleared one, or
 *                                     one just handed to another shop
 *   the last pull stopped part-way    yes; `pulledAt` is null until a pull
 *                                     reaches the end
 *   it had everything five minutes    no
 *   ago or less
 *
 * What this does NOT decide: a line that came back, the quarter-hour
 * heartbeat, the Sync button, and anything this device has just changed
 * (`useKeepInSync`) all pull without asking here.
 *
 * Unknown is yes. A till that cannot read its own database cannot know it
 * owes nothing, and asking costs one small request.
 */
export async function pullIsDue(now: number = Date.now()): Promise<boolean> {
  try {
    // Whose catalogue is this? Before a word of it is believed: a till handed
    // to another shop holds the last shop's "pulled a minute ago".
    await ensureDatabaseBelongsTo(useAuthStore.getState().user?.tenant?.id ?? null);

    if ((await queueTally()).owed > 0) return true;

    const meta = await readMeta();
    if (!PROJECTIONS.some((projection) => meta.cursors[projection])) return true;

    return isDue(meta.pulledAt, now, PULL_ON_OPEN_EVERY_MS);
  } catch {
    return true;
  }
}
