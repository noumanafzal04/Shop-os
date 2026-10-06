import { useAuthStore } from "../../../stores/authStore";
import { getAll } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogPromotion } from "../sync/catalogService";

/**
 * Does this shop have the module?
 *
 * The same answer the till's own screen gives (`has()` in PosPage): what the
 * signed-in shop's module map says, and OFF when the map does not say. Read
 * from the saved session, so it is there with the line down.
 */
export function shopHas(module: string): boolean {
  const features = (
    useAuthStore.getState().user?.tenant as { features?: Record<string, boolean> } | null | undefined
  )?.features;

  return features?.[module] ?? false;
}

/**
 * The promotions this till may apply — none, for a shop without the module.
 *
 * ── Why the cache is not simply read ─────────────────────────────────
 *
 * An admin switched Coupons & Promotions off for a shop with a live promotion
 * in it. The promotion is still a row on the server and still in this till's
 * copy: nothing deleted it, and nothing should — it comes back with the
 * module. But the till no longer shows offers, and the server no longer
 * applies one, so a copy that went on applying it would price the cart
 * differently from both: Rs 504 on a slip for a sale the server rings at 630.
 *
 * ONE reader for the three places that used to open the store themselves —
 * the offline sale, its "can this till price that offer" check, and the
 * shadow check that compares this engine with the server on every sale. Three
 * readers would have been three chances to forget.
 */
export async function heldPromotions(): Promise<CatalogPromotion[]> {
  return shopHas("promotions") ? getAll<CatalogPromotion>(STORE.PROMOTIONS) : [];
}
