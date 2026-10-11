import type { StockPlace, StockRow } from "./services/stockByPlaceService";

/**
 * READING A ROW OF THE STOCK-BY-PLACE TABLE.
 *
 * Two small questions the screen asks of every row, kept here so they are
 * rules with tests and not expressions repeated in three cells.
 */

/** Is this place at or below the product's reorder level. A product with no level set is never "low". */
export function isLowAt(row: Pick<StockRow, "places" | "low_stock_threshold">, placeId: string | null): boolean {
  if (placeId === null || row.low_stock_threshold === null) return false;

  return Number(row.places[placeId] ?? 0) <= row.low_stock_threshold;
}

/**
 * Where to bring it from: the OTHER place holding the most of it — a
 * warehouse before a shop when they hold the same, because emptying another
 * branch's shelf to fill this one is rarely what anybody means.
 */
export function fullestOther(
  row: Pick<StockRow, "places">,
  places: readonly StockPlace[],
  notAt: string | null,
): StockPlace | null {
  const holding = places
    .filter((p) => p.id !== notAt && Number(row.places[p.id] ?? 0) > 0)
    .sort((a, b) => {
      const more = Number(row.places[b.id] ?? 0) - Number(row.places[a.id] ?? 0);
      if (more !== 0) return more;

      return (a.kind === "warehouse" ? 0 : 1) - (b.kind === "warehouse" ? 0 : 1);
    });

  return holding[0] ?? null;
}

/**
 * The link that opens a transfer already filled in.
 *
 * `to` is left out when the screen does not know which place is asking — the
 * form opens with the sender chosen and the destination still to pick, which
 * is better than guessing one.
 */
export function refillLink(from: string, to: string | null, productName: string): string {
  const q = new URLSearchParams({ from, ...(to ? { to } : {}), product: productName });

  return `/tenant/transfers?${q.toString()}`;
}
