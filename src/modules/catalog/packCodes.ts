import type { ProductUnit } from "./types";

/**
 * A PACK ON THE ITEM FORM — which one it is, and every code printed on it.
 *
 * Two things the form did not carry, and what each cost:
 *
 *   `id`     A pack row went to the server as a name and a size, so the server
 *            could only replace the list — and every save of the item gave its
 *            packs new ids. A till holding the old one was refused its sale.
 *
 *   `codes`  A pack had room for ONE barcode. The second code on a carton had
 *            one other place to go — the item's "additional barcodes", each of
 *            which means a single piece — so scanning it rang one biscuit at a
 *            biscuit's price, for a carton.
 */
export interface PackRow {
  /** The pack this row IS, when it is one the item already has. */
  id?: string;
  name: string;
  factor: string;
  price: string;
  barcode: string;
  /**
   * Every OTHER code on the pack.
   *
   * `undefined` is not "none" — it is "this form was never told". A row built
   * from an answer that did not include the codes must not send an empty list
   * back, because to the server an empty list means take them all off.
   */
  codes?: string[];
}

/** What the server is sent for a pack. */
export interface PackPayload {
  id?: string;
  name: string;
  factor: number;
  price: number | null;
  barcode: string | null;
  barcodes?: string[];
}

type PackFromServer = ProductUnit & { codes?: Array<{ barcode: string }> | null };

/** The form's rows for an item's packs. */
export function packRowsFrom(units: readonly PackFromServer[] | null | undefined): PackRow[] {
  return (units ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    factor: String(u.factor),
    price: u.price != null ? String(u.price) : "",
    barcode: u.barcode ?? "",
    // Present in the answer (even empty) = known. Absent = not told.
    codes: Array.isArray(u.codes) ? u.codes.map((c) => c.barcode) : undefined,
  }));
}

/** A row nobody has filled in yet — its codes are known: there are none. */
export const blankPack = (): PackRow => ({ name: "", factor: "", price: "", barcode: "", codes: [] });

/**
 * What to send. A pack with no name or no size is not a pack yet and is left
 * out, as it always was.
 */
export function packPayload(rows: readonly PackRow[]): PackPayload[] {
  return rows
    .filter((u) => u.name.trim() !== "" && Number(u.factor) > 0)
    .map((u) => {
      const barcode = u.barcode.trim() || null;

      return {
        ...(u.id ? { id: u.id } : {}),
        name: u.name.trim(),
        factor: Number(u.factor),
        price: u.price ? Number(u.price) : null,
        barcode,
        // Only when the form knows them. Tidied here as the server would:
        // no blanks, no repeats, and not the pack's own first code again.
        ...(u.codes !== undefined
          ? { barcodes: [...new Set(u.codes.map((c) => c.trim()).filter((c) => c !== "" && c !== barcode))] }
          : {}),
      };
    });
}

/**
 * The item's OWN other codes — the ones that mean a single piece.
 *
 * A code that belongs to one size, or to one pack, is on the same list and is
 * not one of these. Leaving a pack's code in would show it under "additional
 * barcodes" and send it back as a piece's: the server refuses that (it is on
 * a pack), and the item could no longer be saved at all.
 */
export function pieceCodes(
  barcodes: ReadonlyArray<{ barcode: string; variant_id?: string | null; product_unit_id?: string | null }> | null | undefined,
): string[] {
  return (barcodes ?? []).filter((b) => !b.variant_id && !b.product_unit_id).map((b) => b.barcode);
}
