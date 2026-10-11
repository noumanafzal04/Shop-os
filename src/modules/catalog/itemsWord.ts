/**
 * WHAT THIS BUSINESS CALLS THE THINGS IT SELLS.
 *
 * The menu said "Catalog" and the screen behind it said "Products & Services"
 * to a grocer who has never sold a service and a salon that has never sold a
 * product. Nobody running a shop looks for a catalog — they look for their
 * products — so the word is taken from what the business was actually given,
 * and the menu and the screen both ask here so they cannot disagree.
 */
type Features = Record<string, boolean> | null | undefined;

export function itemsWord(features: Features): "Products" | "Services" | "Products & services" {
  const products = !!features?.products;
  const services = !!features?.services;

  if (products && services) return "Products & services";

  return services ? "Services" : "Products";
}

/** The list itself, as a row inside its own group: "All products". */
export function allItemsWord(features: Features): string {
  const word = itemsWord(features);

  return word === "Products & services" ? "All items" : `All ${word.toLowerCase()}`;
}
