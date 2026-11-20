import type { Order } from "./services/ordersService";

/**
 * A NEW ORDER RINGS UNTIL SOMEBODY ANSWERS IT — foodpanda's vendor app.
 *
 * The queue already polled every 15 s, but an order that arrived while the
 * phone lay on the counter was a row nobody saw. Now any WAITING (pending)
 * order takes the screen with Accept / Reject, and the phone vibrates, until
 * it is answered or put off with "Later". Later puts off THAT order only; the
 * next new one rings again.
 *
 * Oldest first: the customer who has waited longest is answered first.
 */
export function nextToRing(pending: Order[], later: ReadonlySet<string>): Order | null {
  const waiting = pending
    .filter((o) => o.status === "pending" && !later.has(o.id))
    .sort((a, b) => Date.parse(a.placed_at) - Date.parse(b.placed_at));
  return waiting[0] ?? null;
}

/** How many more are waiting behind the one on screen. */
export function waitingBehind(pending: Order[], later: ReadonlySet<string>): number {
  return Math.max(0, pending.filter((o) => o.status === "pending" && !later.has(o.id)).length - 1);
}

/** Buzz, pause, buzz — repeated while the order is on screen. */
export const RING_PATTERN = [0, 700, 600];

/** "2 min ago" — how long the customer has been waiting. */
export function waited(placedAt: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.floor((now.getTime() - Date.parse(placedAt)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min ago`;
}
