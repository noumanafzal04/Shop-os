/**
 * WHAT ENTER MEANS IN THE TILL'S SEARCH BOX.
 *
 * It meant "add the highlighted tile" — whatever tile that was. And the tiles
 * on screen are the answer to the LAST search the server finished, not to
 * what is in the box: the list is asked on every keystroke and answers a
 * moment later.
 *
 * A scanner does not wait a moment. It types `QA-OIL-5L` and Enter in a tenth
 * of a second, the list was still showing the whole shelf, and the till rang
 * the FIRST ITEM ON THE SHELF — a phone case, for a bottle of oil. Silently:
 * the cashier scanned one thing and a different thing was on the bill. Only a
 * code of five or more DIGITS was treated as a code; every shop that prints
 * its own labels, every Code-128 barcode with a letter in it, and every
 * serial number went down the other path.
 *
 * So Enter is answered from two things and never from a guess:
 *
 *   the tiles that are the answer to THIS term (the caller waits for them),
 *   and the term itself.
 *
 * A term that is exactly an item's code is that item. A term the list has
 * nothing for is looked up as a code — a pack's barcode, one size's code, a
 * unit's own serial are all things the list does not search. A term that
 * LOOKS like a code is looked up as one first, and only if nothing carries it
 * is it what the cashier meant by the highlighted match.
 */

export interface Tile {
  sku?: string | null;
  barcode?: string | null;
}

export type EnterMeans =
  | { do: "nothing" }
  /** Look the term up as an exact code. */
  | { do: "scan" }
  /** Add this tile. */
  | { do: "tile"; index: number }
  /** Look it up as a code; if nothing carries that code, add this tile. */
  | { do: "code-then-tile"; index: number };

/** `b` is never empty here: an empty term is answered before any code is compared. */
const same = (a: string | null | undefined, b: string): boolean =>
  typeof a === "string" && a.trim().toLowerCase() === b.toLowerCase();

/** No spaces and at least one digit: `QA-OIL-5L`, `5CG1234XYZ`, `a15`. Not `tea`, not `galaxy a15`. */
export const looksLikeACode = (term: string): boolean => !/\s/.test(term) && /\d/.test(term);

/**
 * @param term    what is in the box
 * @param tiles   the list's answer TO THAT TERM — never an older one
 * @param active  the highlighted tile
 */
export function enterMeans(term: string, tiles: Tile[], active: number): EnterMeans {
  const t = term.trim();
  const highlighted = Math.max(0, Math.min(active, tiles.length - 1));

  // Nothing typed: the cashier is walking the shelf with the arrow keys.
  if (t === "") return tiles.length > 0 ? { do: "tile", index: highlighted } : { do: "nothing" };

  // A long run of digits is a barcode, whatever the list says.
  if (/^\d{5,}$/.test(t)) return { do: "scan" };

  const exact = tiles.findIndex((p) => same(p.sku, t) || same(p.barcode, t));
  if (exact >= 0) return { do: "tile", index: exact };

  if (tiles.length === 0) return { do: "scan" };

  return looksLikeACode(t) ? { do: "code-then-tile", index: highlighted } : { do: "tile", index: highlighted };
}
