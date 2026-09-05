/**
 * A shared link names a shop and an item in the same breath, and nothing ties
 * them together:
 *
 *     cartze.shop/shop/burger-hut/product/<a kebab shop's kebab>
 *
 * Both halves are typed by whoever holds the link. The shop page opens on the
 * slug, the item is fetched by its id, and unless someone checks, the kebab
 * lands in the burger shop's basket — priced by the burger shop, drawn from the
 * burger shop's shelf, and refused at checkout with a message about a product
 * the customer picked from a page that offered it.
 *
 * The server refuses the resulting order; that is not the same as never
 * offering it. This is the app's half of the same fence.
 *
 * Kept as a plain function, deliberately: it is the only consequential decision
 * on that screen, and a decision worth making is worth being able to test
 * without mounting a renderer around it.
 */
export interface LinkedProduct {
  shop?: { slug?: string | null } | null;
}

export function productBelongsToShop(
  product: LinkedProduct | undefined | null,
  slug: string | undefined | null,
): boolean {
  // Both sides must be present before they can be compared. This line is the
  // one doing the work: without it, a screen with no slug yet and a payload
  // with no shop compare `undefined === undefined` and the fence waves through
  // exactly the half-loaded state it exists to catch.
  //
  // A `typeof owner === "string"` guard stood here as well and was removed: a
  // mutation that deleted it changed no test, because this early return has
  // already ruled out every case it claimed to cover. A second check that
  // cannot fail reads as two protections and is one.
  if (!product || !slug) return false;

  return product.shop?.slug === slug;
}
