import { count } from "./db/repo";
import { STORE } from "./db/schema";
import { readMeta } from "./sync/applyPull";
import type { ServerTotals } from "./sync/catalogService";

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
  /**
   * What the server had at that pull — the "of 50,000". Null before the first
   * pull, or from a server too old to say.
   */
  onServer: ServerTotals | null;
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
    onServer: meta.serverTotals ?? null,
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
  // "48,000 of 50,000" while some are not here yet; "all 50,000" once they are.
  const said = (held: number, of: number | undefined, noun: string): string =>
    of === undefined
      ? `${held.toLocaleString()} ${noun}`
      : held >= of
        ? `all ${held.toLocaleString()} ${noun}`
        : `${held.toLocaleString()} of ${of.toLocaleString()} ${noun}`;
  const missing = r.onServer === null ? 0 : notSavedYet(r);
  const rest = missing > 0 ? " The rest are not saved yet — press Save everything on this device." : "";
  const sentence = `${said(r.products, r.onServer?.products, "products")} and ${said(r.customers, r.onServer?.customers, "customers")} are saved on this device.`;

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${rest}${codes}`;
}

/** Rows the server has that this device does not — never below nothing. */
export function notSavedYet(r: Pick<OfflineReadiness, "products" | "customers" | "onServer">): number {
  if (r.onServer === null) return 0;

  return Math.max(0, r.onServer.products - r.products) + Math.max(0, r.onServer.customers - r.customers);
}
