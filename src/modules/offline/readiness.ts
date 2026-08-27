import { count } from "./db/repo";
import { STORE } from "./db/schema";
import { readMeta } from "./sync/applyPull";

/**
 * WHAT THIS DEVICE IS HOLDING, and whether it can trade without a line.
 *
 * ── Why a shop needs to be told this at all ─────────────────────────────
 *
 * The catalog syncs on its own — on boot, on reconnect, every fifteen minutes.
 * That is the right behaviour and it is also completely invisible, so the only
 * way a shopkeeper could find out whether their till was ready for an outage
 * was to have one. A shop that pulled the plug to test it and saw an empty
 * screen learnt the wrong lesson about the whole feature.
 *
 * "Save everything on this device" is not a new mechanism. It is the sync that
 * already runs, given a button, a count and an answer — so the readiness of a
 * till is something a person can check on Friday rather than discover on
 * Saturday.
 *
 * ── Why the counts come from the database and not from a flag ───────────
 *
 * A boolean saying "synced" is a claim; 1,284 products is the thing itself.
 * The one number that matters most is the CODES: a till with a full catalog
 * and an empty barcode index can be searched by hand and cannot be scanned,
 * and those are very different shops.
 */
export interface OfflineReadiness {
  products: number;
  customers: number;
  /** Barcodes, SKUs and PLU codes — everything a scanner can hit. */
  codes: number;
  /** When the last successful pull finished. Null = this till has never synced. */
  lastPullAt: string | null;
  /** Enough on board to sell from. */
  ready: boolean;
}

export async function readOfflineReadiness(): Promise<OfflineReadiness> {
  const [products, customers, codes, meta] = await Promise.all([
    count(STORE.CATALOG),
    count(STORE.CUSTOMERS),
    count(STORE.BARCODE_INDEX),
    readMeta(),
  ]);

  return {
    products,
    customers,
    codes,
    lastPullAt: meta.lastPullAt,
    // A catalog is the whole requirement. Customers are a convenience — a
    // walk-in sale needs none — and codes only decide whether a scanner works,
    // which is why a shop with neither is still told it can sell.
    ready: products > 0,
  };
}

/**
 * The sentence a shopkeeper reads, in their terms rather than the schema's.
 *
 * Kept beside the reader for the reason the offline pill had to learn twice:
 * wording that lives in a component grows a second copy in the next component
 * that needs it, and the two drift.
 */
export function readinessLabel(r: OfflineReadiness): string {
  if (r.products === 0) {
    return "Nothing saved yet — this device cannot sell without a connection.";
  }

  const codes =
    r.codes === 0
      ? " No barcodes saved, so scanning will not work offline — search by name instead."
      : "";

  return `${r.products.toLocaleString()} products and ${r.customers.toLocaleString()} customers are saved on this device.${codes}`;
}
