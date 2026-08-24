import { describe, expect, it } from "vitest";

import { catalogSizeStock, catalogStock, sizesOf, whyNotSellable } from "./availability";
import type { Product, ProductVariant } from "../catalog/types";

/**
 * The one rule six doors ask.
 *
 * A tile, a row, a size chip, a quick key, the barcode scanner and the dine-in
 * tab all decide whether a line may be rung, and this is the function all six
 * call. It is tested on its own rather than through a screen because a screen
 * test proves one door works, and the failures this codebase keeps having are
 * about the door nobody wrote a test for.
 */

const size = (over: Partial<ProductVariant> & { name: string }): ProductVariant => ({
  id: `v-${over.name}`,
  sku: null,
  price: 100,
  cost: null,
  stock_quantity: 0,
  low_stock_threshold: null,
  is_active: true,
  ...over,
});

const dish = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "T-shirt",
    type: "product",
    track_inventory: true,
    sold_out: false,
    stock_quantity: 0,
    variants: [],
    ...over,
  }) as Product;

describe("which sizes a shop may sell", () => {
  it("hides a size that has been switched off", () => {
    const p = dish({ variants: [size({ name: "S" }), size({ name: "Retired", is_active: false })] });

    expect(sizesOf(p).map((v) => v.name)).toEqual(["S"]);
  });

  it("treats a missing flag as live, not as retired", () => {
    // A till that synced before the offline projection carried `is_active`
    // would otherwise show a product with NO sizes, which reads as a broken
    // catalogue rather than a stale device. The server refuses a retired size
    // anyway, so the worst case is a refusal somebody can see.
    const p = dish({ variants: [{ ...size({ name: "M" }), is_active: undefined as unknown as boolean }] });

    expect(sizesOf(p)).toHaveLength(1);
  });
});

describe("how much of a size is on the shelf", () => {
  it("prefers this branch's figure over the shop-wide rollup", () => {
    // The rollup is every branch added together. A till standing in one of them
    // that reads it offers stock it cannot reach.
    const v = { ...size({ name: "L", stock_quantity: 900 }), branch_stock: 6 } as ProductVariant;

    expect(catalogSizeStock(v)).toBe(6);
  });

  it("falls back to the rollup only when no branch figure was stamped", () => {
    expect(catalogSizeStock(size({ name: "L", stock_quantity: 4 }))).toBe(4);
  });

  it("counts a branch figure of zero as zero, not as missing", () => {
    // `?? ` and not `||`: a size genuinely sold out at this branch reads 0, and
    // treating that as "no figure" would fall through to the rollup and offer
    // another branch's rail.
    const v = { ...size({ name: "L", stock_quantity: 50 }), branch_stock: 0 } as ProductVariant;

    expect(catalogSizeStock(v)).toBe(0);
  });
});

describe("a varianted product holds no stock of its own", () => {
  it("sums its sizes instead of reading the orphaned parent row", () => {
    // THE bug this file was written for. The product form seeds the parent at
    // zero and puts the quantities on the variants, so a full rail read 0 — and
    // the till greys a tile out on that number, so the item could not be sold
    // at all. The server says the same thing in Product::effectiveStock().
    const p = dish({
      stock_quantity: 0,
      variants: [
        size({ name: "S", stock_quantity: 4 }),
        size({ name: "M", stock_quantity: 6 }),
        size({ name: "L", stock_quantity: 5 }),
      ],
    });

    expect(catalogStock(p)).toBe(15);
  });

  it("still reads its own figure when it has no sizes", () => {
    expect(catalogStock(dish({ stock_quantity: 9 }))).toBe(9);
  });

  it("does not count a retired size towards the total", () => {
    const p = dish({
      variants: [size({ name: "S", stock_quantity: 4 }), size({ name: "X", stock_quantity: 100, is_active: false })],
    });

    expect(catalogStock(p)).toBe(4);
  });
});

describe("whether a line may be rung", () => {
  it("refuses a sold-out product whatever its stock says", () => {
    // 86 beats everything. A dish that tracks no stock can never be "out" by
    // quantity, so this flag is the only thing between a finished fish and a
    // table that has just ordered it.
    const p = dish({ sold_out: true, track_inventory: false, name: "Fish" });

    expect(whyNotSellable(p, null)).toBe("Fish is sold out.");
  });

  it("names the SIZE that ran out, not the product", () => {
    // A rail with twelve Smalls and no Larges is not "out of stock" — it is out
    // of Larges, and a cashier told the wrong one of those goes to the wrong
    // screen to fix it.
    const small = size({ name: "S", stock_quantity: 12 });
    const large = size({ name: "L", stock_quantity: 0 });
    const p = dish({ variants: [small, large] });

    expect(whyNotSellable(p, large)).toBe("T-shirt — L is out of stock");
    expect(whyNotSellable(p, small)).toBeNull();
  });

  it("lets the product through while any size remains", () => {
    const p = dish({ variants: [size({ name: "S", stock_quantity: 0 }), size({ name: "M", stock_quantity: 2 })] });

    expect(whyNotSellable(p, null)).toBeNull();
  });

  it("refuses the product once every size has gone", () => {
    const p = dish({ variants: [size({ name: "S", stock_quantity: 0 }), size({ name: "M", stock_quantity: 0 })] });

    expect(whyNotSellable(p, null)).toBe("T-shirt is out of stock");
  });

  it("never refuses something that does not count its stock", () => {
    // A cooked dish, a haircut, a diagnostic hour: quantity is not a thing they
    // have, and refusing on it would close the kitchen.
    const p = dish({ track_inventory: false, stock_quantity: 0 });

    expect(whyNotSellable(p, null)).toBeNull();
  });

  it("never refuses a service on stock", () => {
    const p = dish({ type: "service", stock_quantity: 0, track_inventory: true } as Partial<Product>);

    expect(whyNotSellable(p, null)).toBeNull();
  });

  it("uses the caller's stock reader, which is how the till subtracts its queue", () => {
    // The till has sold three Larges it has not sent yet. The catalogue still
    // says six; the shelf holds three. Two tills offline can each sell the last
    // one and both are telling the truth, which is why this is the caller's
    // arithmetic and not this file's.
    const large = size({ name: "L", stock_quantity: 3 });
    const p = dish({ variants: [large] });

    expect(whyNotSellable(p, large, () => 0)).toBe("T-shirt — L is out of stock");
    expect(whyNotSellable(p, large, () => 3)).toBeNull();
  });
});


describe("one size can be off while the others sell", () => {
  /**
   * A pizzeria runs out of large bases, not of pizza. Before this the only move
   * was to take the whole item off, so Small and Medium went with it — all
   * evening, on the busiest thing on the menu.
   */
  const pizza = {
    id: "p1", name: "Pizza", type: "product" as const,
    sold_out: false, track_inventory: false,
  };
  const size = (name: string, off: string | null) => ({
    id: name, name, sku: null, price: 100, cost: null,
    stock_quantity: 10, low_stock_threshold: null, is_active: true,
    sold_out_at: off,
  });

  it("refuses the size that ran out", () => {
    expect(whyNotSellable(pizza, size("Large", "2026-08-24T18:00:00Z")))
      .toBe("Pizza — Large is sold out.");
  });

  it("and keeps selling the ones that did not", () => {
    // The whole point. This is the sale the product-level flag used to cost.
    expect(whyNotSellable(pizza, size("Small", null))).toBeNull();
  });

  it("says the size, not the product, when both are off", () => {
    // The more specific answer is the one a customer hears: "no large, but we
    // have medium" is a sale.
    expect(whyNotSellable({ ...pizza, sold_out: true }, size("Large", "2026-08-24T18:00:00Z")))
      .toBe("Pizza — Large is sold out.");
  });

  it("still takes everything off when the PRODUCT is off", () => {
    // "No pizza tonight" is a real sentence and not the same one.
    expect(whyNotSellable({ ...pizza, sold_out: true }, size("Small", null)))
      .toBe("Pizza is sold out.");
  });

  it("treats a missing flag as on, never as off", () => {
    // A device that has not synced since this shipped carries rows without the
    // field. Reading absence as "sold out" would silently empty a menu.
    const noField = { ...size("Small", null) } as Record<string, unknown>;
    delete noField.sold_out_at;

    expect(whyNotSellable(pizza, noField as never)).toBeNull();
  });
});
