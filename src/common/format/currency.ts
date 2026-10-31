/**
 * THE MONEY A SHOP TRADES IN — written the way that money is written.
 *
 * A shop could not choose its currency, and the panel wrote every figure as
 * "Rs" followed by whatever the browser's own language made of the number: a
 * comma every three digits in one browser, a full stop in another, and never
 * the lakhs a shop in India reads.
 *
 * The server holds the list (`App\Support\Currencies`) and sends a shop its
 * currency's FORMAT — the mark, where the commas go, whether a whole amount is
 * written with ".00", whether the mark stands apart from the number. This
 * file writes an amount from that, and from nothing else: not from the
 * browser's locale, and not from a list of its own.
 *
 * `fixtures/currency-format.json` is made by the server
 * (`CurrencyFormatFixturesTest`), and `currency.test.ts` holds this file to
 * every string in it — so a screen cannot say ₹1,234,567 beside a receipt
 * that says ₹12,34,567.
 */

export interface CurrencyFormat {
  /** ISO code: "PKR", "INR", "USD". */
  code: string;
  name: string;
  /** "Rs", "₹", "$". */
  symbol: string;
  /** `western` 1,234,567 · `indian` 12,34,567 (lakh and crore). */
  grouping: "western" | "indian";
  /** `when_needed`: a whole amount has no decimal point. `always`: two, every time. */
  decimals: "when_needed" | "always";
  /** A mark of letters stands apart ("Rs 500"); a sign is written against the number ("$500.00"). */
  space: boolean;
  /** What a drawer in this currency is counted in — notes, then coins, largest first. */
  cash: number[];
}

/**
 * The product's default — what a shop trades in until it says otherwise, and
 * what this file writes before a shop's settings have loaded.
 *
 * It is also the PLATFORM's money: what a plan costs and what an add-on is
 * charged at are the platform's figures, in the platform's currency, whatever
 * the shop that pays them trades in. See `platformMoney`.
 */
export const PKR: CurrencyFormat = {
  code: "PKR",
  name: "Pakistani Rupee",
  symbol: "Rs",
  grouping: "western",
  decimals: "when_needed",
  space: true,
  cash: [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1],
};

/** A shop's format as the server sent it — or the default, when it has not arrived or is not one. */
export function currencyOf(sent: unknown): CurrencyFormat {
  const c = sent as Partial<CurrencyFormat> | null | undefined;

  return c && typeof c.symbol === "string" && typeof c.code === "string"
    ? {
        code: c.code,
        name: typeof c.name === "string" ? c.name : c.code,
        symbol: c.symbol,
        grouping: c.grouping === "indian" ? "indian" : "western",
        decimals: c.decimals === "always" ? "always" : "when_needed",
        space: c.space !== false,
        // A format with no notes of its own counts nothing — never somebody else's.
        cash: Array.isArray(c.cash) ? c.cash.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [],
      }
    : PKR;
}

/** 1234567 → "1,234,567", or "12,34,567": the last three, then twos. */
function grouped(digits: string, grouping: CurrencyFormat["grouping"]): string {
  if (grouping === "indian") {
    if (digits.length <= 3) return digits;

    return `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
  }

  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The digits of an amount, grouped for this currency. `places` left out
 * follows the currency: no decimal point on a whole amount where that is how
 * it is written, two otherwise.
 */
export function numberIn(currency: CurrencyFormat, value: string | number | null | undefined, places?: number): string {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;

  // Rounded FIRST, and half AWAY from nothing as the server rounds: 0.005 is
  // two decimal places' worth of money, and asking whether the raw value has
  // a fraction would put ".00" on 4000.0000001.
  const rounded = (Math.sign(amount) * Math.round(Math.abs(amount) * 100)) / 100;
  const digits = places ?? (currency.decimals === "always" || !Number.isInteger(rounded) ? 2 : 0);

  const fixed = Math.abs(rounded).toFixed(digits);
  const [whole, fraction] = fixed.split(".");
  const sign = rounded < 0 && Number(fixed) > 0 ? "-" : "";

  return `${sign}${grouped(whole, currency.grouping)}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/**
 * An amount as a person reads it: "Rs 4,000", "Rs 2,350,196.50",
 * "₹12,34,567", "$4,000.00".
 */
export function formatIn(currency: CurrencyFormat | null | undefined, value: string | number | null | undefined, places?: number): string {
  const c = currency ?? PKR;
  const number = numberIn(c, value, places);

  // A mark of letters stands apart and the sign stays on the number
  // ("Rs -500"); a sign is written against it, minus first ("-$5.00").
  if (c.space) return `${c.symbol} ${number}`;

  return number.startsWith("-") ? `-${c.symbol}${number.slice(1)}` : `${c.symbol}${number}`;
}

/** An amount on PAPER — always to the paisa. */
export const paperIn = (currency: CurrencyFormat | null | undefined, value: string | number | null | undefined): string =>
  formatIn(currency, value, 2);

/**
 * What the PLATFORM charges: a plan, an add-on, a commission invoice.
 *
 * Not the shop's money. A shop that trades in dollars is still billed by the
 * platform in the platform's currency, and the screens that show those
 * figures say so by using this and not the shop's formatter.
 */
export const platformMoney = (value: string | number | null | undefined, places?: number): string =>
  formatIn(PKR, value, places);

/**
 * Said beside a platform figure on a shop that trades in something else (#AZ9):
 * null where the two are the same money, so a rupee shop is told nothing new.
 */
export function platformBilledIn(shop: Pick<CurrencyFormat, "code">): string | null {
  return shop.code === PKR.code ? null : `Billed in ${PKR.name} (${PKR.code}) — the platform's money, not your shop's.`;
}
