import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { count, putMany, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import { MAX_VARIANCES, readVariances, runShadowCheck, type ShadowLine } from "./runShadowCheck";
import type { CatalogItem } from "../sync/catalogService";
import { readTally } from "./shadowTally";

/**
 * The shadow check as it will actually run, against the till's own catalog.
 *
 * Two properties decide whether the two weeks of data it produces are worth
 * anything at all:
 *
 *  1. **Skipping is not agreeing.** A till that has not finished its first pull
 *     cannot price anything. Reporting that as a disagreement would fill the
 *     report with the till's own youth; counting it as a match would be the
 *     more flattering lie. It says "skipped", and why.
 *  2. **It never interrupts a counter.** It runs after the customer has paid.
 *     Anything that throws inside it is caught and reported as a skip — a
 *     shadow check that broke a till would be the worst possible trade for
 *     information nobody asked for.
 */

const item = (over: Partial<CatalogItem> & { id: string }): CatalogItem =>
  ({
    name: "Milkpak 1L",
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
    tax_rate: 0,
    tax_group_id: null,
    track_inventory: true,
    stock: 10,
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
    ...over,
  }) as CatalogItem;

const line = (over: Partial<ShadowLine> = {}): ShadowLine => ({
  product_id: "p1",
  quantity: 1,
  ...over,
});

async function seed(items: CatalogItem[], settings: Record<string, unknown> = {}): Promise<void> {
  await putMany(STORE.CATALOG, items);
  await putSingleton(STORE.SETTINGS, { default_tax_rate: 0, tax_inclusive: false, ...settings });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("agreement", () => {
  it("matches a plain sale and records nothing", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    const outcome = await runShadowCheck("s1", [line({ quantity: 2 })], {
      subtotal: 200,
      discount: 0,
      tax: 0,
      total: 200,
    }, 0);

    expect(outcome.status).toBe("matched");
    expect(await count(STORE.PRICING_VARIANCES)).toBe(0);
  });

  it("prices a variant at ITS price, not the product's", async () => {
    // The server's rule, mirrored: a variant carries its own price, and a
    // product-level sale price does not apply to it.
    await seed([
      item({
        id: "p1",
        price: 100,
        discount_price: 80,
        variants: [{ id: "v1", name: "Large", sku: null, price: 250, stock: 3, is_active: true }],
      }),
    ]);

    const outcome = await runShadowCheck("s1", [line({ variant_id: "v1", quantity: 2 })], {
      subtotal: 500,
      discount: 0,
      tax: 0,
      total: 500,
    }, 0);

    expect(outcome.status).toBe("matched");
  });

  it("reads a tax group's rate from the till's own copy", async () => {
    await putMany(STORE.TAX_CONFIG, [{ id: "t1", name: "Standard", rate: 17 }]);
    await seed([item({ id: "p1", price: 100, tax_rate: 5, tax_group_id: "t1" })]);

    // 17 from the group, not 5 from the item.
    const outcome = await runShadowCheck("s1", [line()], {
      subtotal: 100,
      discount: 0,
      tax: 17,
      total: 117,
    }, 0);

    expect(outcome.status).toBe("matched");
  });
});

describe("disagreement", () => {
  it("records it, with the sale it came from", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    const outcome = await runShadowCheck("sale-7", [line()], {
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 105,
    }, 0);

    expect(outcome.status).toBe("differed");
    const kept = await readVariances();
    expect(kept).toHaveLength(1);
    expect(kept[0].saleId).toBe("sale-7");
    expect(kept[0].differences[0].field).toBe("total");
  });

  it("keeps a bounded window, dropping the oldest", async () => {
    // Diagnostics, not accounting. An unbounded log on a till whose engine is
    // systematically wrong would fill the device that is supposed to be
    // holding unsent sales.
    await seed([item({ id: "p1", price: 100 })]);

    for (let i = 0; i < MAX_VARIANCES + 5; i += 1) {
      await runShadowCheck(`sale-${String(i).padStart(4, "0")}`, [line()], {
        subtotal: 100,
        discount: 0,
        tax: 0,
        total: 999,
      }, 0);
    }

    const kept = await readVariances();
    expect(kept).toHaveLength(MAX_VARIANCES);
    // Newest first, and the earliest ones are gone.
    expect(kept[0].saleId).toBe(`sale-${String(MAX_VARIANCES + 4).padStart(4, "0")}`);
    expect(kept.some((v) => v.saleId === "sale-0000")).toBe(false);
  });
});

describe("skipping is not agreeing", () => {
  it("skips when an item is not in the local catalog yet", async () => {
    // A till on its first morning has pulled nothing. Reporting that as a
    // pricing disagreement would bury the real ones.
    await seed([]);

    const outcome = await runShadowCheck("s1", [line()], {
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100,
    }, 0);

    expect(outcome.status).toBe("skipped");
    expect(outcome).toMatchObject({ reason: expect.stringContaining("local catalog") });
    expect(await count(STORE.PRICING_VARIANCES)).toBe(0);
  });

  it("skips when a variant is not known locally", async () => {
    await seed([item({ id: "p1", variants: [] })]);

    const outcome = await runShadowCheck("s1", [line({ variant_id: "v-unknown" })], {
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100,
    }, 0);

    expect(outcome.status).toBe("skipped");
  });

  it("skips before the till has its settings, rather than guessing at the tax", async () => {
    // Guessing "no tax" would report a disagreement on every taxed sale.
    await putMany(STORE.CATALOG, [item({ id: "p1" })]);

    const outcome = await runShadowCheck("s1", [line()], {
      subtotal: 100,
      discount: 0,
      tax: 17,
      total: 117,
    }, 0);

    expect(outcome.status).toBe("skipped");
    expect(await count(STORE.PRICING_VARIANCES)).toBe(0);
  });

  it("skips an empty sale rather than comparing nothing", async () => {
    await seed([]);

    expect((await runShadowCheck("s1", [], { subtotal: 0, discount: 0, tax: 0, total: 0 }, 0)).status)
      .toBe("skipped");
  });
});

describe("it never interrupts a counter", () => {
  it("skips rather than throwing when the database is gone", async () => {
    // The customer has already paid and the receipt is on screen.
    const real = globalThis.indexedDB;
    // @ts-expect-error removing it on purpose
    delete globalThis.indexedDB;
    resetDbCache();

    const outcome = await runShadowCheck("s1", [line()], {
      subtotal: 100,
      discount: 0,
      tax: 0,
      total: 100,
    }, 0);

    expect(outcome.status).toBe("skipped");

    globalThis.indexedDB = real;
    resetDbCache();
  });
});

describe("what it feeds the engine", () => {
  it("passes a per-line percentage discount through as a percentage", async () => {
    await seed([item({ id: "p1", price: 200 })]);

    const outcome = await runShadowCheck(
      "s1",
      [line({ quantity: 2, discountMode: "pct", discountValue: 10 })],
      { subtotal: 360, discount: 0, tax: 0, total: 360 },
      0,
    );

    expect(outcome.status).toBe("matched");
  });

  it("passes a per-line amount discount through as an amount", async () => {
    await seed([item({ id: "p1", price: 200 })]);

    const outcome = await runShadowCheck(
      "s1",
      [line({ quantity: 2, discountMode: "amt", discountValue: 55 })],
      { subtotal: 345, discount: 0, tax: 0, total: 345 },
      0,
    );

    expect(outcome.status).toBe("matched");
  });

  it("passes the whole-cart discount through", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    const outcome = await runShadowCheck(
      "s1",
      [line({ quantity: 5 })],
      { subtotal: 500, discount: 100, tax: 0, total: 400 },
      100,
    );

    expect(outcome.status).toBe("matched");
  });
});

describe("counting what it did", () => {
  // Zero findings is the answer we want and also the answer a shop gets when
  // no check ever ran. The tally is bumped inside runShadowCheck rather than by
  // its caller precisely so no caller can drop the denominator.

  it("counts a match", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    await runShadowCheck("s1", [line({})], { subtotal: 100, discount: 0, tax: 0, total: 100 }, 0);

    expect(await readTally()).toMatchObject({ checked: 1, matched: 1 });
  });

  it("counts a disagreement", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    await runShadowCheck("s1", [line({})], { subtotal: 999, discount: 0, tax: 0, total: 999 }, 0);

    expect(await readTally()).toMatchObject({ checked: 1, differed: 1 });
  });

  it("counts a SKIP, and keeps why", async () => {
    // The load-bearing one. A till that never pulled its catalog skips every
    // cart, and a fortnight of that must not read as a fortnight of agreement.
    await runShadowCheck("s1", [line({})], { subtotal: 100, discount: 0, tax: 0, total: 100 }, 0);

    const tally = await readTally();
    expect(tally).toMatchObject({ checked: 1, skipped: 1, matched: 0 });
    expect(Object.keys(tally?.skips ?? {})).toHaveLength(1);
  });

  it("counts an empty cart as a check that was skipped, not as nothing", async () => {
    await runShadowCheck("s1", [], { subtotal: 0, discount: 0, tax: 0, total: 0 }, 0);

    expect(await readTally()).toMatchObject({ checked: 1, skipped: 1 });
  });
});
