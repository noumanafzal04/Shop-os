/**
 * Which Settings tabs a shop is offered.
 *
 * Pulled out of the page so it can be tested directly, and so the tab ORDER and
 * the module each tab needs live in exactly one place. The page keeps only the
 * icons.
 *
 * This gating used to be missing entirely: `SETTINGS_TABS` went straight to
 * `FilterTabs` with nothing filtering it, so a Finance Manager tenant — no till,
 * no catalog, no stock, sold the expense book and nothing else — was offered
 * Point of Sale, Loyalty, Receipt and Barcodes. Four tabs of switches that saved
 * without complaint and changed nothing, on the first screen a new shop opens.
 * Only the POS *sub*-tabs filtered, which is why Kitchen correctly hid itself
 * without dine-in and everything above it did not.
 *
 * Same rule as the sidebar, the dashboard and the reports screen: do not offer
 * what the business can never use.
 */

/**
 * Anything that takes money for goods or labour — at a counter, at a table, or
 * online. A shop with none of these has no checkout, so it has nothing to tax,
 * no receipt to print and no sale to award points on.
 *
 * Deliberately the same test `reportTabs` uses: two screens must not disagree
 * about whether this shop sells anything.
 */
export const SELLS = ["pos", "marketplace", "dine_in"] as const;

/**
 * Every tab, in the order they appear. `needs` lists the modules that make one
 * worth showing — ANY one is enough. A tab without `needs` is universal.
 */
export const SETTINGS_TABS = [
  // Name, contact and the map pin. Every shop has these, including the
  // books-only one — it still puts its name on what it sends out.
  { key: "business", label: "Business" },
  // WHAT THIS SHOP HAS. Read-only on purpose: modules are the admin's decision
  // (a shop that could switch its own POS off would be a support call), but
  // "why can I not see Purchases" is a question the shop asks and had nowhere
  // to look. Universal — every business has an answer to it.
  { key: "modules", label: "Your modules" },
  { key: "tax", label: "Tax & Delivery", needs: SELLS },
  { key: "pos", label: "Point of Sale", needs: ["pos"] },
  // Points are awarded to a CUSTOMER, so the customer book is what makes this
  // worth showing — a shop that keeps none has nobody to award them to.
  { key: "loyalty", label: "Loyalty", needs: ["customers"] },
  { key: "receipt", label: "Receipt", needs: SELLS },
  // The counter's own kit — printer, scanner, cash drawer. No till, no counter.
  { key: "hardware", label: "Hardware", needs: ["pos"] },
  // A label is printed from a catalog record rather than off a shelf. It
  // follows the LABELS module, matching the route gate on the Labels screen
  // itself — it used to say `products`, which was true until printing labels
  // became a module a shop can decline, and would have left a settings tab for
  // a screen the shop can no longer open.
  { key: "barcode", label: "Barcodes", needs: ["labels"] },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

/** Does this shop have any of the modules a tab asks for? No ask = always. */
export function tabIsAvailable(
  features: Record<string, boolean> | undefined,
  needs?: readonly string[],
): boolean {
  return !needs || needs.some((f) => !!features?.[f]);
}

/** The tabs this shop should see, in order. Never empty — Business is universal. */
export function settingsTabsFor(features: Record<string, boolean> | undefined) {
  return SETTINGS_TABS.filter((t) => tabIsAvailable(features, "needs" in t ? t.needs : undefined));
}

/**
 * The till carries more settings than the rest of the shop put together, so it
 * gets a second row of its own. Lanes and PINs share one: on a counter with
 * more than one person behind it, they are what you actually came here to set
 * up, and they were previously eight cards down a single scroll.
 */
export const POS_SUBTABS = [
  { key: "till", label: "Counter" },
  { key: "registers", label: "Lanes & PINs" },
  { key: "selling", label: "Quotes & advances" },
  // THE KITCHEN, NOT THE FLOOR. This asked for `dine_in` until the pass became
  // a module of its own — which is the whole point of the split: a takeaway
  // café has a kitchen and no tables. Gated on the floor, such a shop was given
  // the pass, told to work from it, and could not name a single station or
  // decide whether tickets print. Its own module is the gate.
  { key: "kitchen", label: "Kitchen", needs: "kitchen" },
] as const;

/** The till's own second row, filtered the same way the top row is. */
export function posSubTabsFor(features: Record<string, boolean> | undefined) {
  return POS_SUBTABS.filter((t) => tabIsAvailable(features, "needs" in t ? [t.needs] : undefined));
}
