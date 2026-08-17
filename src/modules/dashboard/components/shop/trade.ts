/**
 * What the dashboard's sixth tile should be, and what this trade calls things.
 *
 * `Capabilities.businessType` has been computed and typed since the dashboard
 * shipped, and read by nothing: every panel was gated on MODULES alone. Modules
 * answer "does this shop have stock?" — they cannot answer "of the four stock
 * figures, which one does THIS shopkeeper open the app to check?"
 *
 * That distinction is the whole point on the three trades that pay the bills. A
 * medical store and a grocery both have the inventory module, both carry batches
 * with dates, and both get the same tile today: Low Stock. But a grocer reorders
 * when a shelf runs low, while a pharmacist's job is the strip of medicine that
 * goes out of date on the shelf — stock they already own, already paid for, and
 * are about to have to destroy. Same module, opposite question.
 *
 * Only the differences that are real live here. Where a trade genuinely asks the
 * same question as everyone else it takes the default, because inventing a
 * distinct vocabulary per trade is how a product ends up with eight words for
 * "sale" and no two screens agreeing.
 */

/** The extra figure a trade leads with, once the daily money is on screen. */
export type FocusKey = "expiring" | "lowStock" | "pipeline" | "catalog";

export interface TradeProfile {
  /** What one completed transaction is called. */
  orders: string;
  /** What the people on the other side of the counter are called. */
  customers: string;
  /**
   * The sixth tile, best first. The first entry whose data this shop actually
   * carries wins — a preference, not a promise, so a pharmacy with no inventory
   * module still gets a sensible tile instead of a blank.
   */
  focus: FocusKey[];
}

const DEFAULT: TradeProfile = {
  orders: "Orders Today",
  customers: "Customers Today",
  focus: ["pipeline", "lowStock", "catalog"],
};

const PROFILES: Record<string, Partial<TradeProfile>> = {
  /**
   * A kitchen sells the same dish all day; what changes is how many tickets are
   * waiting. Stock matters weekly, the pass matters now.
   */
  food: {
    orders: "Orders Today",
    customers: "Guests Today",
    focus: ["pipeline", "lowStock", "catalog"],
  },

  /**
   * Expiry before shortage. A grocer's short shelf is a lost sale; a
   * pharmacist's dated strip is stock they have already paid for and will have
   * to destroy, and the window to move it closes on a date nobody is watching.
   */
  pharmacy: {
    focus: ["expiring", "lowStock", "pipeline", "catalog"],
  },

  /**
   * Shortage before everything. A mart lives on shelf availability — the
   * customer who cannot find sugar buys their whole basket somewhere else.
   */
  mart: {
    customers: "Shoppers Today",
    focus: ["lowStock", "expiring", "pipeline", "catalog"],
  },

  retail: {
    focus: ["lowStock", "pipeline", "catalog"],
  },

  /**
   * Work booked in, not baskets rung up.
   *
   * The bay panel above the tiles is what a workshop actually opens the app
   * for; parts stock is the sixth tile because it is the next thing a job card
   * runs out of.
   */
  automotive: {
    orders: "Jobs Today",
    focus: ["lowStock", "pipeline", "catalog"],
  },

  /** No shelf to run down — the catalog IS the offer. */
  services: {
    orders: "Jobs Today",
    customers: "Clients Today",
    focus: ["catalog", "pipeline"],
  },

  petroleum: {
    focus: ["lowStock", "pipeline", "catalog"],
  },
};

/** The profile for a resolved business type. Unknown or null takes the default. */
export function tradeProfile(businessType: string | null | undefined): TradeProfile {
  return { ...DEFAULT, ...(PROFILES[businessType ?? ""] ?? {}) };
}
