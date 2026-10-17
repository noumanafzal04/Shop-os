import type { CatalogItem } from "../sync/catalogService";
import type { CartLine } from "./priceCart";

/**
 * THE PACK A LINE IS SOLD IN — a strip, a box, a carton — as this till holds it.
 *
 * L20 (2026-10-17): the till's own engine read no pack at all, so a carton of
 * twelve rung with the line down was priced, printed and totalled as ONE
 * single, while the server charged the carton when the sale arrived. The
 * same blindness made the shadow check report every carton sold ONLINE as a
 * price the till disagreed with.
 *
 *   null        one of the item — no pack named, or a size, which the server
 *               never sells in a pack (`CreateSaleAction`)
 *   undefined   a pack this till has not been told about: not priceable here
 */
export function packOf(
  item: CatalogItem,
  variantId: string | null | undefined,
  unitId: string | null | undefined,
): CartLine["pack"] | undefined {
  if (!unitId || variantId) return null;

  const unit = (item.units ?? []).find((u) => u.id === unitId);

  return unit === undefined ? undefined : { price: unit.price === null ? null : Number(unit.price), factor: Number(unit.factor) };
}
