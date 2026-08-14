import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { onHand, stockKey, unsyncedDeltas, withLocalStock } from "./localStock";
import { enqueue, newRow, OUTBOX_STATUS, type OutboxRow } from "./outbox";

/**
 * What is actually left on the shelf while sales are still queued.
 *
 * The shop this exists for: the power goes, the internet goes with it, and the
 * counter keeps trading. Over two hours the same items sell again and again —
 * a mart shifts forty cartons of milk in one load-shedding evening. Without
 * this the till still reads "forty in stock" on the fortieth sale, and the
 * cashier finds out when a customer asks for one more.
 */

const sale = (op: string, items: unknown[], status: OutboxRow["status"] = OUTBOX_STATUS.PENDING): OutboxRow => ({
  ...newRow(op, "2026-08-16T10:00:00.000Z", `OFF-L1-AB-${op}`, { items }, null),
  status,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("what the queue is holding off the shelf", () => {
  it("counts nothing when nothing is queued", async () => {
    expect((await unsyncedDeltas()).size).toBe(0);
  });

  it("takes a sold item off", async () => {
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2 }]));

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });

  it("adds up the same item across several sales", async () => {
    // The load-shedding evening: the same carton, over and over.
    for (let i = 0; i < 40; i += 1) {
      await enqueue(sale(String(i), [{ product_id: "milk", quantity: 1 }]));
    }

    expect((await unsyncedDeltas()).get("milk")).toBe(-40);
  });

  it("keeps a variant apart from its product", async () => {
    await enqueue(sale("1", [{ product_id: "p1", quantity: 3 }]));
    await enqueue(sale("2", [{ product_id: "p1", variant_id: "v1", quantity: 1 }]));

    const deltas = await unsyncedDeltas();
    expect(deltas.get("p1")).toBe(-3);
    expect(deltas.get("p1:v1")).toBe(-1);
  });

  it("draws a PACK in base units", async () => {
    // A carton of twelve takes twelve off the shelf, not one — the same
    // arithmetic the server does when the sale finally lands.
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2, unit_factor: 12 }]));

    expect((await unsyncedDeltas()).get("p1")).toBe(-24);
  });

  it("counts a weight line to its decimals", async () => {
    await enqueue(sale("1", [{ product_id: "rice", quantity: 1.25 }]));

    expect((await unsyncedDeltas()).get("rice")).toBe(-1.25);
  });
});

describe("what STOPS being held", () => {
  it("releases a sale the server has taken", async () => {
    // The moment it is acked its stock is inside the server's own figure, and
    // holding it here as well would count it twice.
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2 }], OUTBOX_STATUS.ACKED));

    expect((await unsyncedDeltas()).size).toBe(0);
  });

  it("releases one the shop refused", async () => {
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2 }], OUTBOX_STATUS.FAILED));

    expect((await unsyncedDeltas()).size).toBe(0);
  });

  it("KEEPS holding one that is in flight", async () => {
    // Nobody knows yet whether it landed. Releasing it early would put stock
    // back on a shelf it is not on.
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2 }], OUTBOX_STATUS.SENDING));

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });

  it("keeps holding one whose status this build does not recognise", async () => {
    await enqueue(sale("1", [{ product_id: "p1", quantity: 2 }], "queued" as OutboxRow["status"]));

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });
});

describe("the figure the cashier reads", () => {
  it("is the catalog's, less what is queued", async () => {
    const deltas = new Map([["p1", -37]]);

    expect(onHand(40, deltas, "p1")).toBe(3);
  });

  it("is the catalog's untouched when nothing is queued", () => {
    expect(onHand(40, new Map(), "p1")).toBe(40);
  });

  it("is ALLOWED to go negative, and shown that way", () => {
    // Two tills offline can each sell the last carton and both are telling the
    // truth. "-1" tells a shop to recount; a figure floored at zero says
    // nothing at all.
    expect(onHand(1, new Map([["p1", -3]]), "p1")).toBe(-2);
  });

  it("reads a variant's own figure", () => {
    const deltas = new Map([["p1:v1", -2]]);

    expect(onHand(10, deltas, "p1", "v1")).toBe(8);
    expect(onHand(10, deltas, "p1")).toBe(10);
  });
});

describe("a whole grid at once", () => {
  it("reads the queue once for every tile, not once per tile", async () => {
    await enqueue(sale("1", [{ product_id: "p1", quantity: 5 }]));

    const shown = await withLocalStock([
      { id: "p1", stock: 40 },
      { id: "p2", stock: 7 },
    ]);

    expect(shown).toEqual([
      { id: "p1", stock: 35 },
      { id: "p2", stock: 7 },
    ]);
  });

  it("hands the list straight back when nothing is queued", async () => {
    const items = [{ id: "p1", stock: 40 }];

    expect(await withLocalStock(items)).toBe(items);
  });
});

describe("rows this build cannot read", () => {
  it("skips a sale with no items rather than throwing", async () => {
    // The outbox is append-only and read by newer app versions. A row it
    // cannot interpret must cost that row's accuracy, never the whole figure.
    await enqueue(sale("1", []));
    await enqueue({ ...sale("2", []), sale: {} });
    await enqueue(sale("3", [{ product_id: "p1", quantity: 2 }]));

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });

  it("skips a line with no product or a nonsense quantity", async () => {
    await enqueue(sale("1", [{ quantity: 2 }, { product_id: "p1", quantity: "many" }]));

    expect((await unsyncedDeltas()).size).toBe(0);
  });
});

describe("practice takes nothing off the shelf", () => {
  const practice = (op: string, items: unknown[]): OutboxRow => ({
    ...sale(op, items),
    training: true,
  });

  it("ignores a sale rung on a practice drawer", async () => {
    // A trainee's afternoon must not walk the till's stock figure down
    // through goods that never moved. The cashier working the next lane
    // would read three cartons where there are forty, and stop selling.
    await enqueue(practice("1", [{ product_id: "p1", quantity: 10 }]));

    expect((await unsyncedDeltas()).size).toBe(0);
  });

  it("still counts the real sales queued beside it", async () => {
    // The dangerous version of this fix is one that throws the baby out:
    // practice and real trading share a till, and only one of them moves
    // stock.
    await enqueue(practice("1", [{ product_id: "p1", quantity: 10 }]));
    await enqueue(sale("2", [{ product_id: "p1", quantity: 2 }]));

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });

  it("treats a row written before this field existed as real", async () => {
    // The outbox is append-only and read by newer builds than wrote it.
    // "We don't know" has to mean "real": a practice sale counted as real
    // reads one carton low, and a real sale counted as practice reads one
    // carton high — and only the second sells stock the shop does not have.
    const older = sale("1", [{ product_id: "p1", quantity: 2 }]) as Partial<OutboxRow>;
    delete older.training;
    await enqueue(older as OutboxRow);

    expect((await unsyncedDeltas()).get("p1")).toBe(-2);
  });
});

describe("the key", () => {
  it("matches the shape the catalog stock uses", () => {
    expect(stockKey("p1")).toBe("p1");
    expect(stockKey("p1", "v1")).toBe("p1:v1");
    expect(stockKey("p1", null)).toBe("p1");
  });
});
