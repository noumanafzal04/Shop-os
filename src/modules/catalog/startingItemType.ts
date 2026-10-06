import type { ItemTypeCode } from "./types";

/**
 * WHAT "ADD ITEM" OPENS AS.
 *
 * ── What it opened as ────────────────────────────────────────────────
 *
 * A physical product, in every shop. The form began on `physical_product`
 * and only moved off it when the shop was not ALLOWED physical products at
 * all. A restaurant is — it may sell a bottle off the chiller — so a
 * restaurant's "Add item" opened on Physical product, with stock tracking on
 * and an opening stock of nought.
 *
 * Someone adding a dish who did not notice the row of type buttons above the
 * name got a "dish" that:
 *
 *   could not be sold — tracked at zero, the till refuses it as out of stock;
 *   had no "Made at", so it could not be given a kitchen station;
 *   had no recipe, and none of a dish's sizes and extras.
 *
 * A chemist's opened the same way: a medicine added as a physical product has
 * no batch and no expiry, which is the entire reason a chemist has a system.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * The shop's own trade comes FIRST in the list the server sends
 * (`BusinessTypes::itemTypesFor`: a restaurant's dishes, a chemist's
 * medicines, then whatever else its modules allow). So the form opens on the
 * first — the thing this shop mostly adds — and the other kinds are one press
 * away, as they always were.
 */
export function startingItemType(offered: readonly string[] | null | undefined): ItemTypeCode {
  return (offered?.[0] as ItemTypeCode | undefined) ?? "physical_product";
}
