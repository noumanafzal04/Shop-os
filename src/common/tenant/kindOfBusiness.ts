import { SELLS } from "../../modules/shop/settingsTabs";
import { useAuthStore } from "../../stores/authStore";

/**
 * WHAT KIND OF BUSINESS IS READING THIS SCREEN.
 *
 * Almost every sentence in this product was written for a shop: something
 * with a shelf, a counter and a drawer. One kind of customer has none of the
 * three. A Finance Manager — an office, an agency, a school keeping only its
 * books here — was sold the Expense & Income module and nothing else, and the
 * screens it bought went on talking to it about its sales, its till, its
 * shift and its shop:
 *
 *   Cashbook   two columns (Sales, Refunds) that can never hold a figure, and
 *              "for physical cash at the counter, use the POS shift close"
 *   Income     "money in that isn't a sale" — to a business ALL of whose
 *              money in is typed on that screen
 *   Expenses   "Cash (from till)", "comes out of your open drawer"
 *
 * Each of those is a question the screen should have asked and did not, so
 * the questions live here, once, and are asked of the MODULES — never of the
 * trade's name. A Finance Manager who is later given the till has a drawer
 * from that moment, and a shop whose till was withdrawn has none.
 */
export interface KindOfBusiness {
  /** Takes money for something — over a counter, at a table or online. Sales are DERIVED for it. */
  sells: boolean;
  /** Has the till, and so a drawer, shifts and a day to close. */
  hasTill: boolean;
  /** Keeps a supplier book — orders goods and owes for them. */
  buysFromSuppliers: boolean;
  /** Has a storefront customers can order from. */
  sellsOnline: boolean;
  /**
   * What to call it. Everything with something to sell or a catalogue to fill
   * is a shop; a business with neither is not, and calling an accountant's
   * office "your shop" on every page is how a product says it was not made
   * for them.
   */
  noun: "shop" | "business";
}

export function kindOfBusiness(features: Record<string, boolean> | null | undefined): KindOfBusiness {
  const has = (key: string) => !!features?.[key];
  const sells = SELLS.some(has);

  return {
    sells,
    hasTill: has("pos"),
    buysFromSuppliers: has("purchasing"),
    sellsOnline: has("marketplace"),
    noun: sells || has("products") || has("services") ? "shop" : "business",
  };
}

/** The signed-in person's business. */
export function useKindOfBusiness(): KindOfBusiness {
  const features = useAuthStore(
    (s) => (s.user?.tenant as { features?: Record<string, boolean> } | null | undefined)?.features,
  );

  return kindOfBusiness(features);
}

/** "shop" → "Shop": for the start of a sentence or a heading. */
export function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
