/**
 * A QUANTITY, WITHOUT THE TRAILING ZEROES THE DATABASE STORES.
 *
 * Quantities arrive as decimals because a shop can sell 2.5 kg of rice, so
 * "one tin of ghee" comes back as `"1.000"`. Printed raw, an order card reads
 * `1.000× Ghee`, which looks like a bug on a screen where every other number is
 * money.
 *
 * ── Why this is one function ───────────────────────────────────────────
 *
 * It was three, spelled differently, in four files:
 *
 *   `String(parseFloat(String(Number(n).toFixed(3))))`   (inventory)
 *   `String(Number(n))`                                  (quotes & advances)
 *   …and the order card printed the raw string.
 *
 * The first two disagree on a case that turns up as soon as arithmetic is
 * involved: `String(Number(0.1 + 0.2))` is `"0.30000000000000004"`, and only
 * the rounding version survives it. A shop reading a picking list should not
 * be able to tell which screen it was printed from.
 */

/** Three decimals is what the columns hold; nothing sells to the microgram. */
const PLACES = 3;

export function formatQuantity(value: number | string): string {
  // `Number("")` is 0, not NaN — so an ABSENT quantity coerces to a confident
  // zero, which is the worst answer available: a blank cell gets checked, a
  // "0" on a picking list sends somebody away with nothing and no reason to
  // ask. Caught by the test rather than by reading it.
  if (typeof value === "string" && value.trim() === "") return "—";

  const n = Number(value);

  if (!Number.isFinite(n)) return "—";

  // Round FIRST, then drop the trailing zeroes — parseFloat alone would carry
  // float noise straight onto the screen.
  return String(parseFloat(n.toFixed(PLACES)));
}

/** "2.5 kg" / "3" — the unit only when the shop sells that item by weight. */
export function formatQuantityWithUnit(
  value: number | string,
  soldBy?: string | null,
  unit?: string | null,
): string {
  const quantity = formatQuantity(value);

  return soldBy === "weight" && unit ? `${quantity} ${unit}` : quantity;
}
