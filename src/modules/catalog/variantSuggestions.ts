/**
 * One-tap values for the sizes editor, by what the axis is called.
 *
 * The axis NAMES already exist per trade — `BusinessTypes::VARIANT_ATTRIBUTES`
 * gives a diner "Size · Flavor", a chemist "Strength · Pack Size", a tyre shop
 * "Size · Brand · Load Rating". These are the values that go with them, so a
 * shop taps rather than types.
 *
 * Colour and Flavor are deliberately absent: a shop's colours are its own and a
 * guessed list would be wrong in a way that looks authoritative.
 */
const SUGGESTED: Record<string, string[]> = {
  size: ["S", "M", "L", "XL", "XXL"],
  volume: ["250ml", "500ml", "1L", "1.5L", "2.25L"],
  weight: ["250g", "500g", "1kg", "5kg"],
  strength: ["250mg", "500mg", "650mg"],
  "pack size": ["Single", "Pack of 6", "Pack of 12", "Carton"],
  duration: ["30 min", "45 min", "1 hour"],
  // A phone or a laptop shop's versions.
  storage: ["64GB", "128GB", "256GB", "512GB"],
  grade: ["Petrol", "Hi-Octane", "Diesel"],
};

/**
 * "Size" means a different thing in each trade, and the shirt's S/M/L/XL was
 * offered to every one of them — a tyre shop typing "Size" was handed clothing
 * chips. A trade whose sizes are not a garment's says its own here.
 */
const SIZES_BY_TRADE: Record<string, string[]> = {
  automotive: ["155/80 R12", "165/65 R13", "175/70 R13", "185/65 R15", "195/65 R15"],
};

/** A dish's "Size" means something different from a shirt's. */
const FOOD_SIZES = ["Small", "Medium", "Large"];

/** The values to offer under an axis this item's shop named. [] when there is no good guess. */
export function valueSuggestions(
  axisName: string,
  { isFood = false, trade = null }: { isFood?: boolean; trade?: string | null } = {},
): string[] {
  const key = axisName.trim().toLowerCase();
  if (key === "size" && isFood) return FOOD_SIZES;
  if (key === "size" && trade && SIZES_BY_TRADE[trade]) return SIZES_BY_TRADE[trade];

  return SUGGESTED[key] ?? [];
}
