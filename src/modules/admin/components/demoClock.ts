import { elapsedLabel } from "../../../common/time/elapsed";
import type { Tone } from "./face";

/**
 * A DEMO SHOP'S CLOCK, in words.
 *
 * A demo lives a day from the moment it was opened and then clears itself
 * away — unless somebody keeps it. Two things an admin reads off a row: how
 * long ago it was opened (which is how they find the one opened ten minutes
 * ago, across the counter) and how long it has left.
 */

/** "opened 12m ago" · "opened just now" */
export function opened(createdAt: string | null): string {
  if (!createdAt) return "opened some time ago";
  const ago = elapsedLabel(createdAt);

  return ago === "just now" ? "opened just now" : `opened ${ago} ago`;
}

/**
 * How long a demo has left, and how worried to be about it.
 *
 * Past its day is AMBER, not red: the shop is still there — the clearing-away
 * is a job on a timer — and it can still be kept. Red would say it is gone.
 */
export function ends(expiresAt: string | null, now: number = Date.now()): { text: string; tone: Tone } {
  if (!expiresAt) return { text: "No end set", tone: "slate" };

  const minutes = Math.floor((new Date(expiresAt).getTime() - now) / 60_000);

  if (minutes <= 0) return { text: "Past its day", tone: "amber" };
  if (minutes < 60) return { text: `Ends in ${minutes} min`, tone: "amber" };

  return { text: `Ends in ${Math.floor(minutes / 60)} h`, tone: "sky" };
}
