/**
 * THE ITEM FORM'S TABS — which there are, and which one a field is on.
 *
 * ── Which there are ─────────────────────────────────────────────────────
 *
 * A tab is offered when the shop has something to put on it:
 *
 *   Details          always — what it is, its photo, its price, its stock
 *   Online           the shop sells online: whether this item does, the
 *                    collections it sits in, the least a customer may order
 *   Sizes & options  the item type comes in sizes, or takes add-ons
 *   Codes & packs    anything but a service: codes, units, packs, bulk prices
 *
 * The second tab was "Media & online" in every shop that kept photos, online
 * or not — a tyre shop with no online store was shown a tab promising one, with
 * a single picture on it. The picture is on Details now, beside the name, and
 * the tab that is left is about the online shop and nothing else.
 *
 * ── Which one a field is on ─────────────────────────────────────────────
 *
 * The server answers a refused save field by field, and the form draws each
 * message beside its field. A field on a tab nobody is looking at was therefore
 * refused in silence: a barcode another item already has, typed on Codes &
 * packs, left somebody on Details pressing a Create button that did nothing.
 * `refusalsOutOfSight` is what the form shows at the top instead.
 */
export type FormTab = "details" | "online" | "options" | "advanced";

export const TAB_LABEL: Record<FormTab, string> = {
  details: "Details",
  online: "Online",
  options: "Sizes & options",
  advanced: "Codes & packs",
};

export interface FormShape {
  /** The shop has the online store. */
  online: boolean;
  /** This item type comes in sizes or colours. */
  sizes: boolean;
  /** This item type takes choices and add-ons (a dish). */
  addOns: boolean;
  service: boolean;
}

export function tabsFor(shape: FormShape): FormTab[] {
  return [
    "details",
    ...(shape.online ? (["online"] as const) : []),
    ...(shape.sizes || shape.addOns ? (["options"] as const) : []),
    ...(shape.service ? [] : (["advanced"] as const)),
  ];
}

const HOME: Record<string, FormTab> = {
  visible_in_marketplace: "online",
  collection_ids: "online",
  min_order_qty: "online",
  variants: "options",
  variant_axes: "options",
  sku: "advanced",
  barcode: "advanced",
  barcodes: "advanced",
  plu_code: "advanced",
  units: "advanced",
  unit: "advanced",
  brand: "advanced",
  sold_by: "advanced",
  wholesale_price: "advanced",
  price_tiers: "advanced",
};

/** `units.0.factor` is on the tab `units` is on; anything unlisted is on Details. */
export function tabOfField(field: string): FormTab {
  return HOME[field.split(".")[0]] ?? "details";
}

/** The fields that draw their own message beside themselves. */
const SAYS_IT_ITSELF = /^(name|price|description|combo_items|recipe_items|sku|barcode|plu_code|units|variants\.\d+\.(name|sku|barcode|price))$/;

export interface Refusal {
  /** The tab to go to — absent when it is this one, or one this form does not have. */
  on?: FormTab;
  message: string;
}

/**
 * What stopped the save and is not in front of the person.
 *
 * Left out: a field on the tab being looked at that already carries its own
 * message — saying it twice puts two copies of one sentence on a screen.
 * Everything else is listed: a field on another tab (with the tab named), and a
 * field that has nowhere to say it at all.
 */
export function refusalsOutOfSight(
  errors: Record<string, string[] | undefined>,
  looking: FormTab,
  tabs: FormTab[],
): Refusal[] {
  const out: Refusal[] = [];
  const seen = new Set<string>();

  for (const [field, messages] of Object.entries(errors)) {
    const message = messages?.[0];
    if (!message) continue;

    const home = tabOfField(field);
    const reachable = tabs.includes(home);
    if (reachable && home === looking && SAYS_IT_ITSELF.test(field)) continue;

    const on = reachable && home !== looking ? home : undefined;
    const key = `${on ?? ""}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ on, message });
  }

  return out;
}
