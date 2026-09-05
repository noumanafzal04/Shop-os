import type { PublicShop } from "./services/marketplaceService";
import { money } from "../../common/format";

/**
 * The line under a shop's name: what it costs, how long it takes, how far.
 *
 * ── Why this is one function and not two card layouts ──────────────────
 *
 * The same shop appears as a card on the home row and as a row in the shops
 * list, and both have to say the same thing about it. Written twice, they drift
 * on the first edge case — one shows "Free delivery" where the other shows
 * "Rs 0" — and a customer who compares the two screens stops believing either.
 *
 * Every fact is omitted rather than guessed. A shop that has set no prep time
 * says nothing about time; it does not say "0 min", which reads as a promise
 * the shop never made.
 */

export interface ShopFact {
  key: string;
  text: string;
  /** Worth colouring — a free-delivery offer earns the warm accent. */
  tone?: "offer";
}


/**
 * How far, at a precision anyone can use.
 *
 * The server sends two decimals, and five different places printed them raw:
 * "945.81 km". Nobody has ever needed a shop's distance to ten metres, and at
 * that length the digits are just noise pushing the fee off the edge of a card.
 *
 * Exported because those five places are a deal card, a search result, a shop
 * header and two lists — and a distance that reads differently on two screens
 * for the same shop is a distance nobody trusts on either.
 */
export const formatDistance = (km: number): string =>
  km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;

export function shopFacts(shop: PublicShop): ShopFact[] {
  const facts: ShopFact[] = [];

  if (shop.rating !== null && shop.rating !== undefined) {
    facts.push({ key: "rating", text: `${shop.rating}` });
  }

  if (shop.prep_time_minutes) {
    facts.push({ key: "prep", text: `${shop.prep_time_minutes} min` });
  }

  // Delivery, priced. `delivery_fee` is 0 for a shop that delivers free AND for
  // one that only does pickup, so the fee alone cannot tell them apart.
  //
  // `delivers` is what separates them and it now rides on the LIST payload.
  // `fulfillment` is the same fact from the detail payload, kept as a fallback
  // so a shop page loaded before this shipped still reads correctly.
  const fee = shop.delivery_fee;
  const delivers = shop.delivers ?? shop.fulfillment?.delivery ?? shop.features?.delivery;

  if (fee !== undefined && fee !== null) {
    if (fee > 0) {
      facts.push({ key: "fee", text: `${money(fee)} delivery` });
    } else if (delivers) {
      facts.push({ key: "fee", text: "Free delivery", tone: "offer" });
    }
  }

  // A threshold only means something to somebody who has not reached it, and
  // the card does not know the basket — so it is stated as the offer it is.
  if (shop.free_delivery_threshold) {
    facts.push({
      key: "threshold",
      text: `Free over ${money(shop.free_delivery_threshold)}`,
      tone: "offer",
    });
  }

  if (shop.distance_km !== null && shop.distance_km !== undefined) {
    facts.push({ key: "distance", text: formatDistance(shop.distance_km) });
  }

  return facts;
}

/**
 * The same facts, trimmed to what a narrow card can hold without wrapping.
 *
 * A card that wraps to three lines pushes the next one off the screen, and the
 * row stops being scannable — which is the only thing a row of cards is for.
 */
export function shopFactsShort(shop: PublicShop, limit = 3): ShopFact[] {
  return shopFacts(shop).slice(0, limit);
}
