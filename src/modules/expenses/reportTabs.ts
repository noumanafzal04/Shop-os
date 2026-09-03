import { SELLS } from "../shop/settingsTabs";

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
 *
 * ── ONE TABLE, NOT TWO LISTS ─────────────────────────────────────────────
 *
 * This file used to hold the rule twice: `reportTabs()` decided which tabs to
 * DRAW, and two flat arrays — STOCK_TABS and SALES_TABS — decided which tab a
 * shop may still be SITTING on. Two copies of one rule drift, and both were
 * wrong the same way when Purchasing and Bank offers became modules of their
 * own: the Purchases tab was still offered for having `inventory`, and Bank
 * claims to anyone who sells at all. Both lead to screens whose own route is
 * gated on the module, so the tab was a door that bounced.
 *
 * Now there is one table with a `needs` column — the shape `settingsTabs`
 * already uses — and both questions are answered from it.
 */

/**
 * Every report tab, in the order they appear. `needs` lists the modules that
 * make one worth showing — ANY one is enough. No `needs` = universal.
 */
export const REPORT_TABS = [
  { key: "overview", label: "Overview" },
  // What actually pays, as opposed to what merely sells.
  { key: "margins", label: "Margins", needs: SELLS },
  { key: "valuation", label: "Stock value", needs: ["inventory"] },
  { key: "dead-stock", label: "Dead stock", needs: ["inventory"] },
  // A purchase order rides the PURCHASING module, not the shelves. A shop that
  // counts its stock but buys from the wholesale market keeps every stock
  // figure and raises no order — and /tenant/purchases would refuse it.
  { key: "purchases", label: "Purchases", needs: ["purchasing"] },
  { key: "staff", label: "Staff", needs: SELLS },
  { key: "tax", label: "Tax", needs: SELLS },
  { key: "receipts", label: "Receipts", needs: SELLS },
  // Offered to every shop that sells, and NOT gated on having been offline.
  // Load-shedding is universal here; the day a shop needs this is the day it
  // has never looked for it, and a tab that appeared only once there was bad
  // news would be a tab nobody knew existed. On a good day it says the tills
  // were in touch all along, which is worth reading too.
  { key: "offline", label: "Offline", needs: SELLS },
  // What the banks owe. This one IS gated, unlike Offline above: a bank-funded
  // discount is a module a shop is given, the screen that manages the deals
  // (/tenant/bank-offers) is gated on it, and a shop that was never given it
  // cannot have a claim to read. Offering the report anyway put a permanently
  // empty table beside nine live ones.
  { key: "bank-claims", label: "Bank claims", needs: ["bank_offers"] },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["key"];

/** Does this shop have any of the modules a tab asks for? No ask = always. */
export function reportTabAvailable(
  features: Record<string, boolean> | undefined,
  key: string,
): boolean {
  const tab = REPORT_TABS.find((t) => t.key === key);

  // A key this table has never heard of is not a tab this page can draw, and
  // saying "available" would render nothing while hiding the fallback.
  if (!tab) return false;

  const needs = "needs" in tab ? (tab.needs as readonly string[]) : undefined;

  return !needs || needs.some((f) => !!features?.[f]);
}

/** The tabs this shop should see, in order. Never empty — Overview is universal. */
export function reportTabs(
  features: Record<string, boolean> | undefined,
): Array<[string, string]> {
  return REPORT_TABS.filter((t) => reportTabAvailable(features, t.key)).map(
    (t) => [t.key, t.label] as [string, string],
  );
}

/** Does this shop take money for anything? Drives the Overview's own shape. */
export function shopSells(features: Record<string, boolean> | undefined): boolean {
  return SELLS.some((f) => !!features?.[f]);
}
