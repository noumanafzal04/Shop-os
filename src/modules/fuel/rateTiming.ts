import { instantOf } from "../../common/time/localInput";

/**
 * WHEN A NEW RATE TAKES EFFECT.
 *
 * A fuel price is notified in the evening and applies at midnight. The server
 * has always been able to hold a rate until its hour (`effective_at`, applied
 * by `fuel:apply-rates`) — and the form had no box for the hour, so the only
 * rate a station could enter was one that applied THE MOMENT IT WAS SAVED.
 * The Help said, in so many words, to be at the screen "at the moment it
 * takes effect": somebody at a forecourt at midnight, on the busiest night of
 * the fortnight, pressing Apply.
 *
 * Two answers: now, or at a time. This is what the second one sends, and how
 * the list says a rate that is waiting.
 */

/** Midnight tonight — the hour nearly every rate change is for — as a `datetime-local` value. */
export function nextMidnight(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
}

export interface RateTiming {
  /** What to send as `effective_at`; undefined means "now". */
  effectiveAt: string | undefined;
  /** Why the form cannot be sent, or null. */
  problem: string | null;
}

/**
 * @param later  did the station choose "at a time"?
 * @param local  the `datetime-local` value typed
 */
export function rateTiming(later: boolean, local: string, now: Date = new Date()): RateTiming {
  if (!later) return { effectiveAt: undefined, problem: null };

  const at = instantOf(local);
  if (at === undefined) return { effectiveAt: undefined, problem: "Say when it takes effect." };
  // A rate "for later" that is already past would apply at once while the form
  // said it would wait — the opposite of what was asked for.
  if (new Date(at).getTime() <= now.getTime()) {
    return { effectiveAt: undefined, problem: "That time has passed — choose Now, or a time still to come." };
  }

  return { effectiveAt: at, problem: null };
}

/** Is this rate recorded but not yet at the pumps? */
export function isWaiting(change: { effective_at: string; applied_at?: string | null }, now: Date = new Date()): boolean {
  return !change.applied_at && new Date(change.effective_at).getTime() > now.getTime();
}
