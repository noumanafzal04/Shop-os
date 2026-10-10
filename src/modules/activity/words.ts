/**
 * WHAT THE AUDIT TRAIL'S OWN WORDS ARE CALLED ON A SCREEN.
 *
 * The trail records model names and verbs — `Tenant`, `updated`. The Activity
 * page had a table turning those into what a shopkeeper calls them, and the
 * dashboard's "Recent activity" card did not use it: it lower-cased the model
 * name and printed "QA owner updated a tenant" and "Super Admin created a
 * user" on the front page. A tenant is what WE call a customer's business.
 * Nobody running one has ever been one.
 *
 * So the table lives here and both screens read it.
 */
export const EVENT_WORD = {
  created: "added",
  updated: "changed",
  deleted: "removed",
  imported: "imported",
  cleared: "cleared",
  reopened: "opened again",
} as const;

/** Model name → what a shopkeeper calls it. Anything unlisted keeps its own name. */
const THING: Record<string, string> = {
  KitchenTicket: "Kitchen board",
  RestaurantTicket: "Dine-in tabs",
  User: "Staff member",
  Customer: "Customer credit limit",
  CustomerGroup: "Customer group",
  TaxGroup: "Tax rate",
  Coupon: "Coupon",
  Sale: "Sale",
  SaleDocument: "Quotation / layaway",
  StockDisposal: "Stock written off",
  StockCount: "Stocktake",
  BusinessDay: "Trading day",
  BankDeposit: "Banking",
  RecurringExpense: "Recurring expense",
  RecurringIncome: "Recurring income",
  ExpenseBudget: "Budget",
  FuelTank: "Fuel tank",
  FuelPump: "Fuel pump",
  FuelNozzle: "Nozzle",
  FuelDelivery: "Fuel delivery",
  ForecourtShift: "Forecourt shift",
  Product: "Item price",
};

/**
 * What a recorded thing is called.
 *
 * The business's own record is its settings — a shop's, or a business's for
 * one that is not a shop. A model nobody has named yet is spaced out rather
 * than printed as code: "ProductBatch" reads as "Product batch".
 */
export function thingCalled(model: string | null | undefined, noun: "shop" | "business" = "shop"): string {
  if (!model) return "Record";
  if (model === "Tenant") return noun === "shop" ? "Shop settings" : "Business settings";

  const named = THING[model];
  if (named) return named;

  const spaced = model.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What happened to it, as a person says it — "added", not "created". */
export function eventWord(event: string | null | undefined): string {
  return (EVENT_WORD as Record<string, string>)[event ?? ""] ?? event ?? "changed";
}
