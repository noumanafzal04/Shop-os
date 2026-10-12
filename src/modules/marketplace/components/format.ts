import { currencyOf, formatIn } from "../../../common/format/currency";

/**
 * Money, written the way a price tag is — in the money of the shop whose tag
 * it is.
 *
 * One function because every marketplace surface shows a price and three of
 * them had their own copy of `Rs ${n}` — which is fine until one of them
 * starts rounding and the card and the cart disagree about what a thing costs.
 *
 * It said "Rs" for every shop. A price belongs to a shop, and a shop trades in
 * its own currency: the caller hands over that shop's (`shop.currency`, as
 * the server sends it), and a price with no shop behind it is written in the
 * product's default.
 */
export const money = (n: string | number | null | undefined, currency?: unknown): string =>
  formatIn(currencyOf(currency), n);

/**
 * How much has come off, as a whole percent.
 *
 * Rounded DOWN, so a badge never promises more than the arithmetic gives: 19.7%
 * shown as "20% off" is a claim the receipt will not back up.
 */
export const discountPercent = (price: number, was: number | null | undefined): number | null => {
  if (was === null || was === undefined) return null;
  const original = Number(was);
  if (!Number.isFinite(original) || original <= 0 || price >= original) return null;

  return Math.floor(((original - price) / original) * 100) || null;
};

/** A shop's trade, spelled for a customer rather than for the database. */
export const tradeLabel = (type: string | null | undefined): string =>
  ({
    food: "Restaurant",
    mart: "Grocery",
    pharmacy: "Pharmacy",
    retail: "Retail",
    wholesale: "Wholesale",
    services: "Services",
    automotive: "Auto",
    petroleum: "Fuel",
    finance: "Services",
  })[type ?? ""] ?? (type ? type[0].toUpperCase() + type.slice(1) : "Shop");
