/**
 * The module map each trade STARTS with — one copy, read by every guard.
 *
 * Mirrors `BusinessTypes::defaultFeatures` on the server, including
 * `TOOL_DEFAULTS`: the optional tools a trade is given on day one, as against
 * the ones it can switch on later.
 *
 * It lived in two test files and had to be edited in both, which is the shape
 * of every guard-drift bug in this repo — two lists of one rule. A fixture is
 * not production code, so it lives here beside `routes.ts` rather than in
 * `src/layout`, where a module exported only for its own test would be an
 * unreachable export.
 */
export const TRADE_FEATURES: Record<string, Record<string, boolean>> = {
  food: {
    expenses: true, images: true, pos: true, products: true, marketplace: true,
    delivery: true, dine_in: true,
    customers: true, purchasing: true, kitchen: true,
  },
  mart: {
    expenses: true, images: true, pos: true, products: true, inventory: true,
    marketplace: true, delivery: true,
    customers: true, purchasing: true, stocktake: true, disposals: true,
    labels: true, promotions: true,
  },
  pharmacy: {
    expenses: true, pos: true, products: true, inventory: true, delivery: true,
    customers: true, purchasing: true, stocktake: true, disposals: true,
  },
  retail: {
    expenses: true, images: true, pos: true, products: true, inventory: true,
    marketplace: true, reservations: true, delivery: true,
    customers: true, purchasing: true, stocktake: true, disposals: true,
    labels: true, promotions: true, documents: true,
  },
  services: {
    expenses: true, pos: true, services: true,
    customers: true, documents: true,
  },
  automotive: {
    expenses: true, pos: true, products: true, services: true, inventory: true,
    customers: true, purchasing: true, stocktake: true, documents: true,
  },
  finance: { expenses: true },
  petroleum: {
    expenses: true, pos: true, products: true, services: true, inventory: true,
    fuel: true,
    customers: true, purchasing: true, stocktake: true,
  },
};

/**
 * A shop whose admin has switched everything on.
 *
 * A real shape, and the one reachability has to be measured against: a screen
 * whose module is off in every trade's STARTING set is not orphaned — it is
 * optional, and one press away. Measuring reach against the defaults alone
 * would report `Bank offers` as unreachable the moment it stopped being forced
 * on every shop that owns a till, which is the whole point of the change.
 */
export const EVERY_MODULE: Record<string, boolean> = Object.fromEntries(
  [
    "products", "services", "pos", "documents",
    "inventory", "purchasing", "stocktake", "disposals", "labels",
    "customers", "promotions", "bank_offers", "reservations",
    "expenses", "images", "marketplace", "delivery", "kitchen", "dine_in", "fuel",
  ].map((key) => [key, true]),
);
