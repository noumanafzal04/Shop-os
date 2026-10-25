import type { ProductUnit } from "../catalog/types";
import type { Replacement } from "../sales/replacements";
import type { DocumentLineInput } from "./services/documentService";

/**
 * A line on a new quotation, advance or installment sheet: what was picked,
 * how many, and in which pack.
 *
 * The sheet offered only − 1 +, so a distributor quoting fifteen cartons of
 * twenty-four tapped 359 times, and the pack the purchase-order form already
 * offers was never asked (wholesale #W4). The document's lines have always
 * carried a pack; the form now offers it.
 */
export interface SheetLine extends Replacement {
  /** The product's packs. Empty for an item sold only loose, or a size. */
  units: ProductUnit[];
  /** The pack this line is counted in, or null for single pieces. */
  unitId: string | null;
}

function packOf(line: SheetLine): ProductUnit | null {
  return line.unitId === null ? null : (line.units.find((u) => u.id === line.unitId) ?? null);
}

/** The price of one of what this line counts — a piece, or a pack. */
export function unitPriceOf(line: SheetLine): number {
  const pack = packOf(line);
  if (pack === null) return line.price;
  const own = pack.price === null || pack.price === undefined || pack.price === "" ? null : Number(pack.price);
  return own ?? line.price * Number(pack.factor);
}

/**
 * The quantity as typed. A box being cleared to type a new figure holds
 * nought for a moment; the line stays, and the sheet will not go on until
 * every line has a quantity.
 */
export function typedQuantity(rows: SheetLine[], key: string, typed: string): SheetLine[] {
  const n = Number(typed);
  const quantity = typed.trim() === "" || !Number.isFinite(n) || n < 0 ? 0 : n;

  return rows.map((r) => (r.key === key ? { ...r, quantity } : r));
}

export function inPack(rows: SheetLine[], key: string, unitId: string | null): SheetLine[] {
  return rows.map((r) => (r.key === key ? { ...r, unitId } : r));
}

export function allCounted(rows: SheetLine[]): boolean {
  return rows.length > 0 && rows.every((r) => r.quantity > 0);
}

/** What the document is asked for — the pack named, the server prices it. */
export function documentLines(rows: SheetLine[]): DocumentLineInput[] {
  return rows.map((r) => ({
    product_id: r.product_id,
    variant_id: r.variant_id,
    quantity: r.quantity,
    ...(r.unitId !== null ? { product_unit_id: r.unitId } : {}),
  }));
}
