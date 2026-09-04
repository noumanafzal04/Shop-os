/**
 * WHAT TO CALL THE THING YOU ARE ADDING.
 *
 * The name field said "e.g. T-Shirt / Haircut" to everybody: to a chemist
 * adding a cough syrup, to a petrol pump adding diesel, to a tyre shop adding
 * a 185/65 R15. A placeholder is the cheapest teaching a form does — it is
 * read before the label and it settles the shape of the answer ("do they want
 * the size in here? the strength?") — and a placeholder about somebody else's
 * trade teaches the wrong shape or, worse, reads as software that was not
 * built for this shop.
 *
 * Two questions decide it, in this order:
 *
 *   1. WHAT KIND OF ITEM is being added. A service is a service whether the
 *      shop is a salon or a workshop, and a medicine is a medicine. This is
 *      the stronger signal because the cashier has already chosen it on the
 *      same form.
 *   2. WHAT TRADE the shop is. Only asked for an ordinary product, where the
 *      item type says nothing a grocery and a tyre shop do not share.
 *
 * Deliberately NOT brands. "Panadol" and "Sufi" are somebody's trademark and
 * would also read as an endorsement inside a product the shop pays for; the
 * examples below are the sort of thing, described the way a shopkeeper would
 * say it out loud.
 */

/** Keyed by `item_type` — beats the trade, because the shop already said so. */
const BY_ITEM_TYPE: Record<string, string> = {
  service: "Haircut",
  medicine: "Cough syrup 120ml",
  food_item: "Chicken biryani",
  deal: "Family deal — 2 pizzas + 1.5L",
};

/**
 * Keyed by the PRIMARY trade (BusinessTypes::primary), so a shop still carrying
 * an older code — `clinic`, `workshop`, `grocery` — gets its modern trade's
 * example rather than the generic one. See common/tenant/businessType.
 */
const BY_TRADE: Record<string, string> = {
  food: "Chicken biryani",
  mart: "Cooking oil 5 litre",
  pharmacy: "Cough syrup 120ml",
  retail: "Cotton shirt",
  services: "Haircut",
  automotive: "Tyre 185/65 R15",
  petroleum: "Engine oil 4 litre",
  // The books-only tenant has no catalog at all, so this is only ever reached
  // by a shop that switched products on afterwards.
  finance: "Consultancy fee",
};

/** What every form said before this file, and what an unknown trade still gets. */
export const GENERIC_PRODUCT_EXAMPLE = "T-Shirt / Haircut";

/**
 * The example to show in the product name field.
 *
 * Returns the text WITHOUT "e.g." so a caller can place it in a sentence; the
 * form adds the prefix.
 */
export function productExampleFor(
  businessType: string | null | undefined,
  itemType?: string | null,
): string {
  if (itemType && BY_ITEM_TYPE[itemType]) return BY_ITEM_TYPE[itemType];

  return BY_TRADE[businessType ?? ""] ?? GENERIC_PRODUCT_EXAMPLE;
}
