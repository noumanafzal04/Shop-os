import { apiGet } from "../../../common/api/client";
import { deviceId } from "../device/deviceId";

/**
 * The wire shape of what the server sends a till.
 *
 * Kept beside the applier rather than in a shared types file because these
 * types ARE the contract with `PosCatalogController`, and a contract is easier
 * to keep honest when it sits next to the only code that reads it.
 */

/** A row the till may no longer use — deleted on the server, or switched off. */
export interface Tombstone {
  id: string;
  deleted: true;
}

export function isTombstone(row: unknown): row is Tombstone {
  return typeof row === "object" && row !== null && (row as Tombstone).deleted === true;
}

/** One projection's page: its rows, where to resume, and whether more waits. */
export interface Page<T> {
  items: Array<T | Tombstone>;
  cursor: string | null;
  has_more: boolean;
}

export interface CatalogItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  plu_code: string | null;
  category_id: string | null;
  item_type: string;
  unit: string | null;
  sold_by: "unit" | "weight";
  price: number;
  discount_price: number | null;
  wholesale_price: number | null;
  price_tiers: Array<{ min_qty: number; price: number }> | null;
  min_order_qty: number | null;
  tax_rate: number | null;
  tax_group_id: string | null;
  track_inventory: boolean;
  stock: number;
  low_stock_threshold: number | null;
  available_from: string | null;
  available_until: string | null;
  requires_prescription: boolean;
  drug_schedule: string | null;
  tracks_serial: boolean;
  kitchen_station: string | null;
  /** May a single till decide this sale alone? Read in Phase 3. */
  offline_ok: boolean;
  /**
   * Eighty-sixed — the kitchen has run out for now.
   *
   * Sent rather than filtered out, so a till holding yesterday's copy of the
   * menu learns the dish is off instead of going on selling it. The server
   * refuses the line regardless; this is so the screen says so first.
   */
  sold_out?: boolean;
  /**
   * The device's own variant shape, and NOT the catalog's `ProductVariant`.
   *
   * `stock` here, `stock_quantity` there; no `cost` here, because the projection
   * deliberately withholds it. `browse.ts` translates between the two — it used
   * to pass this array straight through behind an `as unknown as` cast, so the
   * till read `v.stock_quantity` off an object that has `stock` and got
   * undefined, and read `v.is_active` off an object that had never carried it.
   */
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    price: number;
    stock: number;
    is_active: boolean;
  }>;
  units: Array<{ id: string; name: string; factor: number; price: number | null; barcode: string | null }>;
  barcodes: string[];
  modifier_groups: Array<{
    id: string;
    name: string;
    type: string;
    min_select: number;
    max_select: number;
    options: Array<{ id: string; name: string; price_delta: number }>;
  }>;
}

export interface CatalogCategory {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

export interface CatalogPromotion {
  id: string;
  name: string;
  /**
   * Switched off promotions are SENT, not filtered out.
   *
   * The catalog is a delta: absence means "unchanged", and a tombstone means
   * "deleted". Dropping a deactivated promotion from the results would leave
   * the till holding yesterday's copy and still applying it.
   */
  is_active: boolean;
  type: string;
  value: number;
  scope: string;
  category_id: string | null;
  product_ids: string[] | null;
  min_spend: number | null;
  min_qty: number | null;
  max_discount: number | null;
  starts_on: string | null;
  ends_on: string | null;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  priority: number;
  /** Buy-X-get-Y only. Null on every other type. */
  buy_qty: number | null;
  get_qty: number | null;
  /** Null means the free units are free; 50 means half off. */
  get_discount_pct: number | null;
}

export interface CatalogTaxGroup {
  id: string;
  name: string;
  rate: number;
}

export interface CatalogCustomerGroup {
  id: string;
  name: string;
  price_level: string;
  discount_percent: number | null;
}

/** Name, phone and group. Never a balance, a ledger or a history. */
export interface CatalogCustomer {
  id: string;
  name: string;
  phone: string | null;
  customer_group_id: string | null;
}

/**
 * The six projections, by the name they are both requested and returned under.
 *
 * One list, so a projection cannot be pulled but never stored, or stored but
 * never asked for — which is precisely how a category rename would arrive
 * everywhere except the one place that reads it.
 */
export const PROJECTIONS = [
  "products",
  "categories",
  "promotions",
  "tax_groups",
  "customer_groups",
  "customers",
] as const;

export type Projection = (typeof PROJECTIONS)[number];

export interface CatalogPull {
  products: Page<CatalogItem>;
  categories: Page<CatalogCategory>;
  promotions: Page<CatalogPromotion>;
  tax_groups: Page<CatalogTaxGroup>;
  customer_groups: Page<CatalogCustomerGroup>;
  customers: Page<CatalogCustomer>;
  settings: Record<string, unknown>;
  offline_days: number | null;
  /**
   * The SHOP's calendar — not the server's and not the tablet's.
   *
   * A promotion that runs on Fridays, or between 6pm and 9pm, is a statement
   * about local time. Evaluated in UTC it would open a Karachi shop's evening
   * sale five hours early and close it five hours early too.
   */
  timezone: string;
  /** May these tills sell with no server at all? Off unless the shop was granted it. */
  offline_selling: boolean;
  /**
   * The depth at which this shop stops trading blind altogether.
   *
   * `offline_days` marks a sale as beyond the window; this refuses to start a
   * new one. Null for almost everybody — a ceiling is opt-in, because for most
   * shops a fourth day without internet is not worse than a closed counter.
   */
  offline_hard_stop_days: number | null;
  /**
   * How far this device's own offline slip counter had got, as the server
   * knows it. Null for a device that has never sold offline.
   *
   * The counter lives in IndexedDB and the device id it is paired with lives
   * in localStorage, so a browser can evict one and keep the other — the till
   * then restarts at one and mints slip numbers the shop already has. This is
   * the answer that lets it start above the mess instead.
   */
  // Optional on purpose: a server too old to send it must leave the till's
  // own counter exactly as it is, not reset it to null.
  offline_sequence?: number | null;
  server_time: string;
  /** Only on a first load. */
  branch_id?: string | null;
}

export const catalogService = {
  /**
   * A first load — every projection from the beginning.
   *
   * Also the recovery path: pulling with no cursors rebuilds a device whose
   * local database was cleared, evicted or corrupted.
   */
  bootstrap: () =>
    apiGet<CatalogPull>("/pos/bootstrap", { params: { device_id: deviceId() } }),

  /**
   * Everything changed since these cursors.
   *
   * A projection with no cursor is read from the beginning, which is what makes
   * a partially-built device repair itself rather than stay half empty.
   */
  delta: (cursors: Partial<Record<Projection, string | null>>) =>
    apiGet<CatalogPull>("/pos/catalog", {
      params: {
        ...Object.fromEntries(
          PROJECTIONS.filter((p) => cursors[p]).map((p) => [p, cursors[p]]),
        ),
        // Named so the server can answer where THIS till's slip counter had
        // got to. See `offline_sequence`.
        device_id: deviceId(),
      },
    }),
};
