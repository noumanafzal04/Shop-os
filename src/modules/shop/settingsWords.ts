import type { KindOfBusiness } from "../../common/tenant/kindOfBusiness";

/**
 * What the Business tab of Settings says, by who is reading it.
 *
 * A books-only business has two Settings tabs, and this is the one with
 * anything in it. It described the name as "shown on invoices and your
 * storefront", the logo as printing "under Invoice / receipt" — a tab this
 * business does not have — the pin as powering "delivery + shops near me",
 * and offered an Online shop card whose only content was a sentence saying it
 * could not have one.
 *
 * And that sentence was wrong for everybody else it was shown to. "Your plan
 * is Expense Manager only" was printed for ANY shop without online selling —
 * a mart with a till and no storefront read that its plan was a product it
 * had never heard of.
 */
export function settingsWords(kind: Pick<KindOfBusiness, "noun" | "sells">) {
  const shop = kind.noun === "shop";

  return {
    lede: `Manage your ${kind.noun} profile, location and how the app works for you.`,
    profile: shop
      ? "Your shop's name and contact — shown on invoices and your storefront."
      : "Your business's name and contact.",
    logoTitle: shop ? "Shop logo" : "Logo",
    logoWhere: shop
      ? "The small square beside your name — in the app, in search, and on your invoices."
      : "The small square beside your name in the app.",
    logoPrints: shop
      ? "Square works best. PNG, JPG or WebP. It prints at the top of your invoices only while “Show logo” is on, under Invoice / receipt."
      : "Square works best. PNG, JPG or WebP.",
    location: shop
      ? "Search or drop a pin — sets your city and powers delivery + “shops near me”."
      : "Search or drop a pin — sets your city and where your business is.",
    /**
     * The currency and the date format sit on this tab too — moved here from
     * Tax, with wording written for a shop: "prices, receipts", "receipts,
     * invoices". An office that only keeps books has none of those, and was
     * told about all of them the day the cards arrived.
     */
    currency: shop
      ? "The money your prices, receipts and reports are written in."
      : "The money your books and reports are written in.",
    dates: shop
      ? "How a date is written on every screen, and on receipts, invoices and reports."
      : "How a date is written on every screen and in every report.",
    /**
     * A storefront needs something to sell on it. Offered to every shop — on
     * or off — and not at all to a business with no catalogue to list.
     */
    offersOnlineShop: shop,
    onlineOff: "Online selling is not switched on for your shop. Contact support to add it.",
  };
}
