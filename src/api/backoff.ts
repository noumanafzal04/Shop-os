/**
 * SLOW DOWN WHEN THE SERVER SAYS SO.
 *
 * ── The shape of the risk ────────────────────────────────────────────
 *
 * The API allows 240 requests a minute per user. What this app spends on its
 * own is small — a rider's board every fifteen seconds is four, an order
 * screen every ten is six, the position heartbeat is under two — so nothing it
 * does deliberately comes close.
 *
 * The danger is not the steady state. It is a phone that has been asleep
 * waking every timer at once, a list that refetches on focus while three
 * screens are mounted, or a user on a shared connection behind one IP. Those
 * arrive as a 429, and the honest response to a 429 is to stop asking — not to
 * keep the poll running and let the server refuse it four times a minute for
 * the next hour.
 *
 * ── Why this is a module and not a query option ──────────────────────
 *
 * The limit is per USER, not per query. One endpoint refusing means every
 * endpoint is about to, so the pause has to be shared — a per-query backoff
 * would have five queries each discovering the same wall separately.
 *
 * React Query is already told not to retry a 4xx, so nothing here fights it.
 * This is only about the POLLS, which retry by the clock rather than by
 * failure.
 */

/** When the pause ends, as epoch milliseconds. Zero means no pause. */
let until = 0;

/**
 * A safety net for a server that returns 429 with no `Retry-After`.
 *
 * Laravel's throttle always sends one, so this is the case that should not
 * happen — a proxy stripping headers, a gateway of its own. Fifteen seconds is
 * long enough to be a real pause and short enough not to look like a hang.
 */
const DEFAULT_PAUSE_MS = 15_000;

/**
 * A ceiling, because `Retry-After` is a number somebody else controls.
 *
 * A misconfigured gateway answering `Retry-After: 86400` would otherwise
 * switch this app's live screens off for a day.
 */
const MAX_PAUSE_MS = 60_000;

/** Called by the API client when the server refuses for rate. */
export function noteRateLimit(retryAfterSeconds?: number): void {
  const ms =
    retryAfterSeconds != null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, MAX_PAUSE_MS)
      : DEFAULT_PAUSE_MS;

  // The LONGER of the two: a second refusal arriving mid-pause must not shorten
  // the one already running.
  until = Math.max(until, Date.now() + ms);
}

/** True while the app should be asking for less. */
export function isRateLimited(): boolean {
  return Date.now() < until;
}

/**
 * A polling interval, held back while the server is refusing.
 *
 * `false` stops React Query's timer entirely; the next successful request —
 * from a pull, a screen change, or the pause expiring — starts it again.
 */
export function pollEvery(ms: number): number | false {
  return isRateLimited() ? false : ms;
}

/** Test seam. Nothing in the app calls this. */
export function resetRateLimit(): void {
  until = 0;
}
