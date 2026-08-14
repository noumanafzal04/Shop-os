import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { putMany, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogItem } from "../sync/catalogService";
import type { OfflineCart } from "./canSellOffline";
import { completeOffline, linesFromCatalog, OfflineRefused, priceLocally } from "./offlineCheckout";
import { allRows, OUTBOX_STATUS } from "./outbox";

/**
 * Completing a sale with no server.
 *
 * The cashier presses Complete, the drawer opens, the slip prints, the customer
 * leaves. Nothing about that may wait for a network — so the only thing this
 * has to be right about is that the sale is SAFELY WRITTEN before the cashier
 * is told it worked. A crash the other way round leaves the shop holding a sale
 * the cashier believes failed, and they ring it again.
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
    offline_ok: true,
    variants: [],
    units: [],
    barcodes: [],
    modifierGroups: [],
    image: null,
    updated_at: "2026-08-16T00:00:00.000Z",
    ...over,
  }) as unknown as CatalogItem;

/** The shop signed in for every test here. */
const SHOP = "shop-a";

const guard = (over: Partial<OfflineCart> = {}): OfflineCart => ({
  lines: [{ name: "Milkpak 1L", offline_ok: true }],
  paymentMethod: "cash",
  ...over,
});

async function seed(items: CatalogItem[] = [item({ id: "p1" })]): Promise<void> {
  await putMany(STORE.CATALOG, items);
  await putSingleton(STORE.SETTINGS, {
    default_tax_rate: 0,
    tax_inclusive: false,
    // The shop has been granted offline selling. Every test below is about
    // what happens AFTER that grant; the grant itself has its own section.
    offline_selling: true,
  });
}

const input = (over: Record<string, unknown> = {}) => ({
  sale: { channel: "pos", payment_method: "cash", amount_paid: 200 },
  lines: [],
  cartDiscount: 0,
  guard: guard(),
  registerName: "Lane 1",
  offlineSince: null,
  training: false,
  tenantId: SHOP,
  ...over,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("ringing it", () => {
  it("queues the sale and hands back something that can be printed", async () => {
    await seed();
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 2 }]);

    const sale = await completeOffline(input({ lines }));

    expect(sale.offline).toBe(true);
    expect(sale.invoice_number).toMatch(/^OFF-LANE1-/);
    expect(sale.total).toBe(200);

    const queued = await allRows();
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe(OUTBOX_STATUS.PENDING);
  });

  it("queues the payload the ONLINE path would have sent", async () => {
    // Not a reduced version of it. The server re-prices from this, so anything
    // dropped here is dropped from the books — a tip, a prescription, an
    // odometer reading — with nothing failing to say so.
    await seed();
    const sale = { channel: "pos", payment_method: "cash", amount_paid: 200, tip_amount: 50 };

    await completeOffline(input({ sale, lines: (await linesFromCatalog([{ product_id: "p1", quantity: 2 }])).lines }));

    expect((await allRows())[0].sale).toEqual(sale);
  });

  it("gives each sale its own operation id and its own number", async () => {
    await seed();
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 1 }]);

    const first = await completeOffline(input({ lines }));
    const second = await completeOffline(input({ lines }));

    expect(first.id).not.toBe(second.id);
    expect(first.invoice_number).not.toBe(second.invoice_number);
    expect(await allRows()).toHaveLength(2);
  });

  it("records whether the drawer it was rung on was a practice one", async () => {
    // The server will not take a shift id's word for this on its own: a shift
    // named by a client, hours later, would otherwise be enough to make a real
    // sale take no stock and earn no revenue. Both have to say so, and this is
    // the till's half.
    await seed();
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 1 }]);

    await completeOffline(input({ lines, training: true }));
    await completeOffline(input({ lines }));

    const rows = await allRows();
    expect(rows.map((r) => r.training).sort()).toEqual([false, true]);
  });
});

describe("the shop's own switch", () => {
  // Off until an admin turns it on, because a shop earns offline selling by
  // running shadow mode over ITS OWN carts — not somebody else's. Checked
  // before the cart's contents: answering "your cart contains a medicine" to a
  // shop that was never granted this would send a cashier removing items to
  // fix something no cart can fix.

  const withSwitch = async (offline_selling: unknown): Promise<void> => {
    await putMany(STORE.CATALOG, [item({ id: "p1" })]);
    await putSingleton(STORE.SETTINGS, { default_tax_rate: 0, tax_inclusive: false, offline_selling });
  };

  it("refuses when the shop has not been granted offline selling", async () => {
    await withSwitch(false);

    await expect(completeOffline(input())).rejects.toThrow(/aren't set up to sell without a connection/);
  });

  it("queues nothing when it refuses", async () => {
    await withSwitch(false);

    await expect(completeOffline(input())).rejects.toThrow();
    expect(await allRows()).toEqual([]);
  });

  it("refuses when the till has never been told either way", async () => {
    // A server too old to send the flag, or a response that lost it. A till
    // that cannot read its own settings has no business deciding it may trade
    // blind, and a shop must never get this by accident.
    await withSwitch(undefined);

    await expect(completeOffline(input())).rejects.toThrow(/aren't set up/);
  });

  it("says what to do instead, not just no", async () => {
    // "Not allowed" sends someone hunting for a setting the shop cannot see.
    await withSwitch(false);

    await expect(completeOffline(input())).rejects.toThrow(/Take cash at the counter/);
  });

  it("is asked BEFORE the cart is inspected", async () => {
    // Otherwise a shop with no grant and a medicine in the basket is told to
    // remove the medicine, and doing so changes nothing.
    await withSwitch(false);

    await expect(
      completeOffline(input({ guard: guard({ lines: [{ name: "Panadol", offline_ok: false }] }) })),
    ).rejects.toThrow(/aren't set up/);
  });
});

describe("an offer the till cannot work out", () => {
  // The safety net behind the promotion mirror, and it matters more than the
  // mirror does. A promotion the engine does not understand is not a smaller
  // discount — it is a receipt WRONG on every cart it touches, found by a
  // customer days later with no way to check.

  const withPromotion = async (over: Record<string, unknown>): Promise<void> => {
    await seed();
    await putMany(STORE.PROMOTIONS, [
      {
        id: "promo-1",
        name: "Something new",
        is_active: true,
        type: "percent",
        value: 10,
        scope: "order",
        category_id: null,
        product_ids: null,
        min_spend: null,
        min_qty: null,
        max_discount: null,
        starts_on: null,
        ends_on: null,
        days_of_week: null,
        start_time: null,
        end_time: null,
        priority: 0,
        buy_qty: null,
        get_qty: null,
        get_discount_pct: null,
        ...over,
      },
    ]);
  };

  it("refuses the SHOP, not the cart, when a live offer is unknown", async () => {
    // No cart can be rearranged to fix this, so telling a cashier to remove
    // an item would send them doing something that changes nothing.
    await withPromotion({ type: "tiered-mystery" });

    await expect(completeOffline(input())).rejects.toThrow(/doesn't know how to work out/);
  });

  it("queues nothing when it refuses", async () => {
    await withPromotion({ type: "tiered-mystery" });

    await expect(completeOffline(input())).rejects.toThrow();
    expect(await allRows()).toEqual([]);
  });

  it("sells normally when every live offer is one it CAN do", async () => {
    // The dangerous version of this net is one that refuses everything.
    await withPromotion({ type: "percent" });
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 2 }]);

    await expect(completeOffline(input({ lines }))).resolves.toBeTruthy();
  });

  it("ignores an unknown offer that is switched OFF", async () => {
    // Refusing a shop over a promotion nobody has turned on is a refusal with
    // no risk behind it, and a gate that cries wolf gets switched off.
    await withPromotion({ type: "tiered-mystery", is_active: false });
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 2 }]);

    await expect(completeOffline(input({ lines }))).resolves.toBeTruthy();
  });

  it("applies a promotion it DOES understand to the price", async () => {
    // The whole point of the exercise: the shadow run found nine carts where
    // the server took 10% off and the till took nothing.
    await withPromotion({ type: "percent", value: 10 });
    const { lines } = await linesFromCatalog([{ product_id: "p1", quantity: 2 }]);

    const sale = await completeOffline(input({ lines }));

    expect(sale.subtotal).toBe(200);
    expect(sale.discount).toBe(20);
    expect(sale.total).toBe(180);
  });
});

describe("what it refuses, before the drawer opens", () => {
  it("refuses a cart a single till cannot decide, and says why", async () => {
    await seed();

    await expect(completeOffline(input({ guard: guard({ paymentMethod: "credit" }) })))
      .rejects.toThrow(OfflineRefused);
  });

  it("carries every reason, not just the first", async () => {
    await seed();

    try {
      await completeOffline(
        input({
          guard: guard({ paymentMethod: "credit", lines: [{ name: "Panadol", offline_ok: false }] }),
        }),
      );
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as OfflineRefused).reasons).toHaveLength(2);
    }
  });

  it("QUEUES NOTHING when it refuses", async () => {
    // A refused sale that still queued would be a sale the cashier was told
    // failed, landing in the books days later.
    await seed();

    await expect(
      completeOffline(input({ guard: guard({ paymentMethod: "credit" }) })),
    ).rejects.toThrow();

    expect(await allRows()).toEqual([]);
  });

  it("refuses rather than guessing when an item is not on this till", async () => {
    // A cart priced from a gap is a wrong receipt, and a wrong receipt offline
    // is found by a customer days later with no way to check.
    await seed();

    await expect(linesFromCatalog([{ product_id: "unknown", quantity: 1 }]))
      .rejects.toThrow(OfflineRefused);
  });

  it("refuses when the till has never pulled the shop's settings", async () => {
    await putMany(STORE.CATALOG, [item({ id: "p1" })]);

    await expect(priceLocally([], 0)).rejects.toThrow(/settings/);
  });
});

describe("the figures", () => {
  it("prices from the till's own catalog", async () => {
    await seed([item({ id: "p1", price: 250 })]);

    const sale = await completeOffline(
      input({ lines: (await linesFromCatalog([{ product_id: "p1", quantity: 3 }])).lines }),
    );

    expect(sale.subtotal).toBe(750);
    expect(sale.total).toBe(750);
  });

  it("applies tax the way the server does", async () => {
    await seed([item({ id: "p1", price: 100, tax_rate: 17 })]);

    const sale = await completeOffline(
      input({ lines: (await linesFromCatalog([{ product_id: "p1", quantity: 1 }])).lines }),
    );

    expect(sale.tax).toBe(17);
    expect(sale.total).toBe(117);
  });

  it("takes a whole-bill discount off", async () => {
    await seed([item({ id: "p1", price: 100 })]);

    const sale = await completeOffline(
      input({ lines: (await linesFromCatalog([{ product_id: "p1", quantity: 5 }])).lines, cartDiscount: 100 }),
    );

    expect(sale.discount).toBe(100);
    expect(sale.total).toBe(400);
  });

  it("prices a variant at the variant's own price", async () => {
    await seed([
      item({
        id: "p1",
        price: 100,
        variants: [{ id: "v1", name: "Large", sku: null, price: 400, stock: 3 }],
      } as Partial<CatalogItem> & { id: string }),
    ]);

    const sale = await completeOffline(
      input({ lines: (await linesFromCatalog([{ product_id: "p1", variant_id: "v1", quantity: 1 }])).lines }),
    );

    expect(sale.total).toBe(400);
  });
});

describe("the allow-list's view of the cart", () => {
  it("marks a blocked item so the sale is refused before the drawer opens", async () => {
    await seed([item({ id: "p1", name: "Augmentin 625", offline_ok: false })]);

    const { guardLines } = await linesFromCatalog([{ product_id: "p1", quantity: 1 }]);

    expect(guardLines).toEqual([{ name: "Augmentin 625", offline_ok: false }]);
  });

  it("refuses that cart even when the POS believed it was fine", async () => {
    await seed([item({ id: "p1", name: "Augmentin 625", offline_ok: false })]);
    const { lines, guardLines } = await linesFromCatalog([{ product_id: "p1", quantity: 1 }]);

    await expect(
      completeOffline(input({ lines, guard: guard({ lines: guardLines }) })),
    ).rejects.toThrow(OfflineRefused);
  });
});
