/** Reports built out of the SHELVES — they need the stock module. */
export const STOCK_TABS = ["valuation", "dead-stock", "purchases"];

/** Reports built out of SALES — margins, who sold it, the tax on it, receipts. */
export const SALES_TABS = ["margins", "staff", "tax", "receipts"];

/**
 * Which report tabs this shop can actually fill.
 *
 * Pulled out of the page so it can be tested directly: a books-only tenant
 * (Finance Manager) was offered seven tabs of which five could never contain
 * a row — Margins, Staff, Tax and Receipts all need sales it does not make,
 * Purchases needs a stock module it does not have. Five empty tables, every
 * month, on the headline screen of the one module it bought.
 *
 * Same rule as the sidebar and the dashboard: do not offer what the business
 * can never fill.
 */
export function reportTabs(
  features: Record<string, boolean> | undefined,
): Array<[string, string]> {
  const tracksStock = !!features?.inventory;
  // Anything that takes money for goods or labour, at a counter, a table or
  // online. A shop with none of these has no sales for a report to read.
  const sells = !!(features?.pos || features?.marketplace || features?.dine_in);

  return [
    ["overview", "Overview"],
    // What actually pays, as opposed to what merely sells.
    ...(sells ? ([["margins", "Margins"]] as Array<[string, string]>) : []),
    ...(tracksStock
      ? ([
          ["valuation", "Stock value"],
          ["dead-stock", "Dead stock"],
          // A purchase order rides the stock module — a shop with no shelves
          // raises none.
          ["purchases", "Purchases"],
        ] as Array<[string, string]>)
      : []),
    ...(sells
      ? ([
          ["staff", "Staff"],
          ["tax", "Tax"],
          ["receipts", "Receipts"],
        ] as Array<[string, string]>)
      : []),
  ];
}

/** Does this shop take money for anything? Drives the Overview's own shape. */
export function shopSells(features: Record<string, boolean> | undefined): boolean {
  return !!(features?.pos || features?.marketplace || features?.dine_in);
}
