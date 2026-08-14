import { allRows, OUTBOX_STATUS, type OutboxRow } from "./outbox";

/**
 * What is actually left on the shelf, while sales are still queued.
 *
 * ── The problem, as it happens in a shop ────────────────────────────────
 *
 * The power goes, the internet goes with it, and the counter keeps trading.
 * Over the next two hours the same items sell again and again — a mart shifts
 * forty cartons of milk in a load-shedding evening. The till's catalog still
 * says what the server last told it: forty in stock, forty, forty. The cashier
 * has no way to know they are down to three, and finds out when a customer
 * asks for a fourth.
 *
 * So on-hand has to move as sales are rung, not as they are sent.
 *
 * ── Why this is DERIVED and not stored ──────────────────────────────────
 *
 * The obvious build is a second store of stock deltas, written when a sale is
 * rung and cleared when it syncs. Two records of the same fact, kept in step by
 * hand — and the day they disagree, the one the cashier reads is the wrong one,
 * silently, with no way to tell which.
 *
 * The outbox already holds every unsynced sale and every line in it. Summing
 * that IS the delta, and it cannot drift from the queue because it IS the
 * queue. The cost is walking a few hundred rows, which is nothing next to a
 * number that can quietly go wrong.
 *
 * ── Why deltas and never a fresh figure ─────────────────────────────────
 *
 * The catalog pull overwrites a row's `stock` with the server's own count, and
 * that count already includes every sale that has synced. Writing an absolute
 * would mean the pull and the queue fighting over one field, and whichever
 * wrote last would win. A delta layered ON TOP survives the pull and expires on
 * its own: the moment a sale is acked it leaves the queue, and its stock is
 * already inside the server's figure.
 */

/** `productId` or `productId:variantId` — the same key the catalog stock uses. */
export function stockKey(productId: string, variantId?: string | null): string {
  return variantId ? `${productId}:${variantId}` : productId;
}

/** A row is still holding stock off the shelf until the server has the sale. */
function stillOwed(row: OutboxRow): boolean {
  return row.status !== OUTBOX_STATUS.ACKED && row.status !== OUTBOX_STATUS.FAILED;
}

/**
 * How much each item is down by, across everything not yet synced.
 *
 * Negative numbers: they are subtracted from what the catalog says.
 */
export async function unsyncedDeltas(): Promise<Map<string, number>> {
  const deltas = new Map<string, number>();

  for (const row of await allRows()) {
    if (!stillOwed(row)) continue;

    // Practice takes nothing off the shelf — the server's rule, and it has to
    // hold here as well or a trainee's afternoon would walk the till's stock
    // figure down through goods that never moved. The cashier standing beside
    // them would read three cartons where there are forty, and stop selling.
    if (row.training === true) continue;

    const items = row.sale.items;
    if (!Array.isArray(items)) continue;

    for (const line of items as Array<Record<string, unknown>>) {
      const productId = line.product_id;
      if (typeof productId !== "string") continue;

      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity)) continue;

      // A pack draws its factor in base units — a carton of twelve takes
      // twelve off the shelf, not one. The same arithmetic the server does.
      const factor = Number(line.unit_factor);
      const base = quantity * (Number.isFinite(factor) && factor > 0 ? factor : 1);

      const key = stockKey(productId, line.variant_id as string | null | undefined);
      deltas.set(key, (deltas.get(key) ?? 0) - base);
    }
  }

  return deltas;
}

/**
 * The catalog's figure, less what this till has sold and not yet sent.
 *
 * Allowed to go negative, and deliberately shown that way. Two tills offline
 * can each sell the last carton and both are telling the truth; a shop reading
 * "-1 in stock" knows something happened that needs a recount, where a figure
 * floored at zero says nothing at all.
 */
export function onHand(
  catalogStock: number,
  deltas: Map<string, number>,
  productId: string,
  variantId?: string | null,
): number {
  return catalogStock + (deltas.get(stockKey(productId, variantId)) ?? 0);
}

/**
 * Apply the deltas across a list of catalog rows in one pass.
 *
 * The list form exists because a POS grid renders hundreds of tiles at once,
 * and reading the queue once for all of them rather than once per tile is the
 * difference between a scroll that is smooth and one that is not.
 */
export async function withLocalStock<T extends { id: string; stock: number }>(
  items: T[],
): Promise<T[]> {
  const deltas = await unsyncedDeltas();
  if (deltas.size === 0) return items;

  return items.map((item) => ({ ...item, stock: onHand(item.stock, deltas, item.id) }));
}
