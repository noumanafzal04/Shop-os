/**
 * How money and quantities are written, in one place.
 *
 * There were EIGHT copies of `money` and three of `fmtQty`, and they had
 * already drifted: half took `string | number` and half took `number`, so the
 * same total came back as "Rs 4,828" on one screen and "Rs NaN" on another the
 * moment the server sent a decimal string.
 *
 * The order tracking screen had neither, and rendered a quantity straight from
 * the API — "2.00×", wrapped onto two lines inside a 30px column, which is what
 * a raw database decimal looks like in a design.
 */

/**
 * A price, in rupees.
 *
 * Accepts what the API actually sends: Laravel serialises `decimal` columns as
 * STRINGS, so a formatter typed `(n: number)` is wrong about its own input on
 * every screen that reads a total straight off the wire.
 */
export function money(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `Rs ${(Number.isFinite(n) ? n : 0).toLocaleString()}`;
}

/**
 * A quantity, without the database's trailing zeros.
 *
 * `2.000` is how a decimal column stores "two". Nobody writes it that way, and
 * printed beside a `×` it also costs the width that made it wrap.
 *
 * Three decimals because weight lines really are fractional — 0.25 kg is a
 * quantity somebody chose.
 */
// Named `qtyText`, not `qty`: a screen that shows a quantity almost always
// holds one too, and `qty(qty)` is the shadowed call that made this rename
// necessary — it type-checked as calling a number.
export function qtyText(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return String(parseFloat(n.toFixed(3)));
}
