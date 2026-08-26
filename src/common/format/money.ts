/**
 * An amount of money, written the way a shopkeeper writes it.
 *
 * `Number(n).toLocaleString()` — what every money figure in the product used to
 * go through — keeps up to THREE decimal places and drops trailing zeroes, so a
 * cashbook printed "Rs 2,350,196.5" beside "Rs 4,000" beside "Rs 187,374.5".
 * Half a rupee written as one digit does not read as money at all; it reads as
 * a rounding error somebody forgot to clean up.
 *
 * The rule here is the one a receipt uses: a whole amount has no decimal point,
 * and anything else has exactly two. "Rs 4,000" and "Rs 2,350,196.50", never
 * "Rs 4,000.00" — PKR is counted in whole rupees day to day, and a column of
 * `.00` is noise on every line to make one line in fifty line up.
 */
export function formatMoney(symbol: string, value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${symbol} 0`;

  // Rounded first: 0.005 is two decimal places' worth of money, and asking
  // whether the RAW value has a fraction would put ".00" on 4000.0000001.
  const rounded = Math.round(n * 100) / 100;
  const places = Number.isInteger(rounded) ? 0 : 2;

  return `${symbol} ${rounded.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}
