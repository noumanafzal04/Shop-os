import type { OrdersWaiting } from "../../layout/ordersWaiting";

/**
 * THE COUNT BESIDE "ORDERS" IS KEPT, NOT ASKED FOR.
 *
 * It was asked from every screen on every load, and again every half minute:
 * one more request each time the app opened, for a number that had not
 * changed. The owner: "aise to theek nahi, har baar load ho — tab update ho
 * jab order create ho; invalidate tab, jab order on/off ho". And a browser
 * test that reloads thirty-five screens a minute was refused by the API's own
 * limit because of it.
 *
 * So the last answer is kept on the device (`waitingStore`), and the server
 * is asked again only when something says an order was made or has moved:
 *
 *   this device did it     taking, confirming, cancelling — the query lives
 *                          under the `["orders"]` key those already invalidate
 *   the bell said so       a new order is told to everyone who can work it
 *                          (`order.placed`), and the bell is asked anyway —
 *                          `isNews` below
 *   the Orders screen      has the figure in its own list; it tells the menu,
 *                          and nothing more is asked (`useTellTheMenu`)
 *
 * ── The one thing still asked on a clock ─────────────────────────────
 *
 * Another device can accept an order and tell nobody: no bell rings for it,
 * and this device did nothing. Without some asking, its count would blink
 * "1 new" until the app was closed. So a kept answer is trusted for
 * `HEAL_AFTER` and no longer — two minutes, a quarter as often as before,
 * and not at all on a reload inside them.
 */
export const HEAL_AFTER = 2 * 60_000;

/** What the server last said, and when this device heard it. */
export interface KeptCount extends OrdersWaiting {
  /** This device's clock, compared only with itself. */
  at: number;
}

/** What is kept on the device, and whose it is. */
export interface Kept {
  /** `shop:person`. A count is never shown to another shop, or to another person in the same one. */
  owner: string;
  count?: KeptCount;
  /**
   * The newest thing the bell had said about an order when the menu last
   * acted on it. Absent — not null — until the bell has been heard once: null
   * is a bell that was heard and had nothing to say.
   */
  heard?: string | null;
}

/** Whose a kept count is. Null while nobody is signed in to a shop. */
export function ownerOf(shop: string | null | undefined, user: string | null | undefined): string | null {
  return shop && user ? `${shop}:${user}` : null;
}

/** What is kept for this person in this shop — nothing, if it is somebody else's. */
export function keptFor(kept: Kept | null, owner: string | null): Kept | null {
  return kept !== null && owner !== null && kept.owner === owner ? kept : null;
}

/**
 * When a kept count was heard, as the query should believe it.
 *
 * Never in the future: a device whose clock was put back would otherwise hold
 * a count "fresh" for as long as the difference, and never ask.
 */
export function heardAt(count: KeptCount, now: number): number {
  return Math.min(count.at, now);
}

/**
 * The newest thing the bell says about an order.
 *
 * `undefined` — the bell has not answered, and nothing can be told from that.
 * `null` — it answered, and nothing on its first page is about an order.
 * The bell is newest first, so the first one found is the newest.
 */
export function newestOrderNews(bell: ReadonlyArray<{ id: string; type: string }> | undefined): string | null | undefined {
  if (bell === undefined) return undefined;

  return bell.find((said) => said.type.startsWith("order."))?.id ?? null;
}

/**
 * Has the bell said something about an order since the menu last looked?
 *
 * Told apart by WHICH notification is newest, never by a time: the server's
 * clock and this device's are two clocks, and a device five minutes behind
 * would find every notification "new" on every poll and ask for ever.
 *
 * The first hearing is not news. There is nothing to compare it with, and the
 * count beside it was asked for — or kept — moments ago.
 */
export function isNews(heard: string | null | undefined, news: string | null | undefined): boolean {
  return news !== undefined && heard !== undefined && heard !== news;
}
