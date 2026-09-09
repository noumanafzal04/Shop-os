import { useLocationStore } from "../../stores/locationStore";

/**
 * WHERE THE SHOPPER IS, IN THE THREE FIELDS EVERY MARKETPLACE READ NEEDS.
 *
 * ── Why this is a hook and not three lines per screen ────────────────
 *
 * The server decides what a shopper may see from a city AND a pin
 * (`Tenant::scopeServesPin`): same city, and within each shop's own
 * `delivery_radius_km`. Both halves have to arrive, on every list, or the
 * answer is wrong in a way nothing on screen admits:
 *
 *   - no `city_id` → the shopper is shown other cities' shops (what happened;
 *     the app sent the pin and never the city);
 *   - no pin → nothing is fenced by the shop's radius, so a shop 30 km away
 *     that delivers 5 is listed and refuses at checkout.
 *
 * Four hooks need it — home, the shop list, the aisle, universal search — and
 * three of them are called from more than one screen. That is seven places to
 * forget one field. This is the one place.
 *
 * ── It is also the cache key ─────────────────────────────────────────
 *
 * Every query key spreads these params, so the city is part of the key. Left
 * out, react-query would serve Karachi's answer to somebody who has just
 * moved their pin to Lahore — the same list, from cache, with no request and
 * nothing to explain it.
 */
export interface ServingPin {
  lat?: number;
  lng?: number;
  city_id?: string;
}

export function useServingPin(): ServingPin {
  const lat = useLocationStore((s) => s.lat);
  const lng = useLocationStore((s) => s.lng);
  const city = useLocationStore((s) => s.city);

  /**
   * `undefined`, never `null`. These go straight into a query string builder
   * that drops `undefined` and would send `city_id=null` as the four letters.
   *
   * Selected field by field rather than as one object: zustand compares the
   * result by identity, so `(s) => ({ lat, lng })` returns a new object every
   * render and re-renders every list on every store touch.
   */
  return {
    lat: lat ?? undefined,
    lng: lng ?? undefined,
    city_id: city?.id ?? undefined,
  };
}
