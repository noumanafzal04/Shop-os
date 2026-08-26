/**
 * Money, written the way a price tag is.
 *
 * One function because every marketplace surface shows a price and three of
 * them had their own copy of `Rs ${n}` — which is fine until one of them
 * starts rounding and the card and the cart disagree about what a thing costs.
 */
export const money = (n: string | number | null | undefined): string => {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "Rs 0";

  // Whole rupees on a tag; paisa only when there actually are any, because
  // "Rs 1,200.00" everywhere is noise a shopper reads past.
  return `Rs ${value.toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })}`;
};

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
    services: "Services",
    automotive: "Auto",
    petroleum: "Fuel",
    finance: "Services",
  })[type ?? ""] ?? (type ? type[0].toUpperCase() + type.slice(1) : "Shop");
