import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { count } from "../db/repo";
import { STORE } from "../db/schema";
import { readMeta } from "./applyPull";
import { catalogService, type CatalogItem, type CatalogPull, type Page, type Tombstone } from "./catalogService";
import { isPulling, pullNow } from "./pullNow";
import { deviceService } from "../device/deviceService";
import { resetTouchClock } from "../device/touch";
import * as variances from "../pricing/varianceService";

/**
 * Fetching everything the server has, and stopping.
 *
 * Three behaviours carry it. A till with no cursors takes the FIRST LOAD, which
 * is also the recovery path for a device whose database was cleared — there is
 * deliberately no separate one. The loop follows `has_more` until the server
 * says stop. And it is capped, because that loop is driven by a value the
 * server supplies, and a server bug that always said "more" would spin a till
 * forever on a metered connection, silently.
 */

const item = (id: string): CatalogItem =>
  ({
    id,
    name: `Item ${id}`,
    sku: null,
    barcode: null,
    plu_code: null,
    category_id: null,
    item_type: "physical_product",
    unit: null,
    sold_by: "unit",
    price: 100,
    discount_price: null,
    wholesale_price: null,
    price_tiers: null,
    min_order_qty: null,
    tax_rate: null,
    tax_group_id: null,
    track_inventory: true,
    stock: 1,
    low_stock_threshold: null,
    available_from: null,
    available_until: null,
    requires_prescription: false,
    drug_schedule: null,
    tracks_serial: false,
    kitchen_station: null,
    offline_ok: true,
    variants: [],
    units: [],
    barcodes: [],
    modifier_groups: [],
  }) as CatalogItem;

const page = <T,>(items: Array<T | Tombstone>, cursor: string, hasMore = false): Page<T> => ({
  items,
  cursor,
  has_more: hasMore,
});

const pull = (items: CatalogItem[], cursor: string, hasMore = false): CatalogPull => ({
  products: page(items, cursor, hasMore),
  categories: page([], "cat"),
  promotions: page([], "promo"),
  tax_groups: page([], "tax"),
  customer_groups: page([], "grp"),
  customers: page([], "cust"),
  settings: {},
  offline_days: 3,
  offline_selling: true,
  timezone: "Asia/Karachi",
  server_time: new Date().toISOString(),
});

const envelope = <T,>(data: T) => ({ success: true, message: "", data, errors: {}, meta: {} });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
  vi.restoreAllMocks();
});

describe("which call it makes", () => {
  it("takes the first load when it has no cursors", async () => {
    const bootstrap = vi
      .spyOn(catalogService, "bootstrap")
      .mockResolvedValue(envelope(pull([item("p1")], "c1")));
    const delta = vi.spyOn(catalogService, "delta");

    await pullNow();

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(delta).not.toHaveBeenCalled();
  });

  it("takes the delta once it knows where it is", async () => {
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));
    await pullNow();

    const delta = vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([], "c1")));

    await pullNow();

    expect(delta).toHaveBeenCalledWith(expect.objectContaining({ products: "c1" }));
  });

  it("falls back to the first load when the database was cleared", async () => {
    // A device whose storage was evicted has rows but no cursors — or neither.
    // The first load IS the recovery path; there is no separate one to forget
    // to call.
    const bootstrap = vi
      .spyOn(catalogService, "bootstrap")
      .mockResolvedValue(envelope(pull([item("p1")], "c1")));

    await pullNow();
    globalThis.indexedDB = new IDBFactory();
    resetDbCache();
    await pullNow();

    expect(bootstrap).toHaveBeenCalledTimes(2);
  });
});

describe("paging", () => {
  it("keeps going while the server says there is more", async () => {
    let round = 0;
    vi.spyOn(catalogService, "bootstrap").mockImplementation(async () =>
      envelope(pull([item("p1")], "c1", true)),
    );
    vi.spyOn(catalogService, "delta").mockImplementation(async () => {
      round += 1;

      return envelope(pull([item(`p${round + 1}`)], `c${round + 1}`, round < 2));
    });

    const result = await pullNow();

    expect(result.rounds).toBe(3);
    expect(result.applied.products).toBe(3);
    expect(await count(STORE.CATALOG)).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("stops immediately when the first page is the last", async () => {
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));
    const delta = vi.spyOn(catalogService, "delta");

    const result = await pullNow();

    expect(result.rounds).toBe(1);
    expect(delta).not.toHaveBeenCalled();
  });

  it("refuses to loop forever when the server always says there is more", async () => {
    // The loop is driven by a value the SERVER supplies. Without a cap, one bad
    // deploy spins every till in every shop on a metered connection, silently
    // and until the battery dies.
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1", true)));
    vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([item("p2")], "c2", true)));

    const result = await pullNow();

    expect(result.truncated).toBe(true);
    expect(result.rounds).toBe(200);
  }, 30_000);

  it("advances the cursor as it goes, so an interrupted first load resumes", async () => {
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "page-1", true)));
    vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([item("p2")], "page-2")));

    await pullNow();

    expect((await readMeta()).cursors.products).toBe("page-2");
  });
});

describe("only one at a time", () => {
  it("shares one in-flight pull between concurrent callers", async () => {
    // Two overlapping pulls are not dangerous — every write is an upsert — but
    // on a shop connection they are two catalogs downloaded instead of one, and
    // the second finishes holding older cursors than the first.
    const bootstrap = vi
      .spyOn(catalogService, "bootstrap")
      .mockImplementation(
        async () =>
          new Promise((resolve) => setTimeout(() => resolve(envelope(pull([item("p1")], "c1"))), 20)),
      );

    const [a, b, c] = await Promise.all([pullNow(), pullNow(), pullNow()]);

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("lets a later pull run once the first has finished", async () => {
    const bootstrap = vi
      .spyOn(catalogService, "bootstrap")
      .mockResolvedValue(envelope(pull([item("p1")], "c1")));

    await pullNow();
    vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([], "c1")));
    await pullNow();

    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight slot even when the pull fails", async () => {
    // Otherwise one network blip wedges the till: every later pull would hand
    // back the same rejected promise and it would never try again.
    vi.spyOn(catalogService, "bootstrap").mockRejectedValue(new Error("Network Error"));

    await expect(pullNow()).rejects.toThrow();
    expect(isPulling()).toBe(false);

    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));

    await expect(pullNow()).resolves.toMatchObject({ rounds: 1 });
  });

  it("reports whether one is running", async () => {
    vi.spyOn(catalogService, "bootstrap").mockImplementation(
      async () =>
        new Promise((resolve) => setTimeout(() => resolve(envelope(pull([], "c1"))), 20)),
    );

    expect(isPulling()).toBe(false);
    const running = pullNow();
    expect(isPulling()).toBe(true);

    await running;
    expect(isPulling()).toBe(false);
  });
});

describe("failure", () => {
  it("leaves the cursors alone when the request fails", async () => {
    vi.spyOn(catalogService, "bootstrap").mockRejectedValue(new Error("Network Error"));

    await expect(pullNow()).rejects.toThrow();

    expect((await readMeta()).cursors.products).toBeUndefined();
  });

  it("keeps what an earlier round already wrote when a later round fails", async () => {
    // Rows already committed stay committed; only the unfinished part is
    // re-fetched. Throwing away a page that landed would make every flaky
    // connection restart a 20,000-item catalog.
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1", true)));
    vi.spyOn(catalogService, "delta").mockRejectedValue(new Error("dropped"));

    await expect(pullNow()).rejects.toThrow();

    expect(await count(STORE.CATALOG)).toBe(1);
    expect((await readMeta()).cursors.products).toBe("c1");
  });
});

describe("saying the till is still here", () => {
  // Registration runs once, on the way in. A counter tablet left open all week
  // would otherwise sit on the owner's roster reading "last reached us 7 days
  // ago" while it synced every quarter of an hour — and `last_seen_at` is the
  // clock the whole offline policy is built on.

  it("touches the device once the catalog is in", async () => {
    resetTouchClock();
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));

    await pullNow();

    expect(touch).toHaveBeenCalled();
  });

  it("sends the tally IMMEDIATELY when findings just went up", async () => {
    // The two travel by different roads — a variance goes on this pull, the
    // count of checks rides the device touch — so without forcing it, a shop
    // reads "9 carts priced differently" above "Carts checked: 2". A screen
    // that contradicts itself at the moment somebody reads it is worse than a
    // screen that is late.
    resetTouchClock();
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));
    vi.spyOn(variances, "flushVariances").mockResolvedValue({ sent: 3 });

    // The first pull spends the five-minute allowance.
    await pullNow();
    expect(touch).toHaveBeenCalledTimes(1);

    // The second is well inside it, and goes anyway because findings moved.
    vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([], "c2")));
    await pullNow();

    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("still holds the clock back when nothing was found", async () => {
    // Forcing on every pull would undo the rate limit the touch exists behind.
    resetTouchClock();
    const touch = vi.spyOn(deviceService, "touch").mockResolvedValue(envelope({}) as never);
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));
    vi.spyOn(variances, "flushVariances").mockResolvedValue({ sent: 0 });

    await pullNow();
    vi.spyOn(catalogService, "delta").mockResolvedValue(envelope(pull([], "c2")));
    await pullNow();

    expect(touch).toHaveBeenCalledTimes(1);
  });

  it("does not let a failed touch fail the pull", async () => {
    // The catalog is what the till sells from; a heartbeat is not.
    resetTouchClock();
    vi.spyOn(deviceService, "touch").mockRejectedValue(new Error("offline"));
    vi.spyOn(catalogService, "bootstrap").mockResolvedValue(envelope(pull([item("p1")], "c1")));

    await expect(pullNow()).resolves.toBeTruthy();

    expect(await count(STORE.CATALOG)).toBe(1);
  });
});
