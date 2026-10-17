import { describe, expect, it } from "vitest";

import { planRingAgain, slipBill } from "./ringAgain";
import type { Product } from "../catalog/types";

/**
 * B49: a refused slip goes back on the bill line by line, matched to the shop's
 * catalogue as it is NOW and through the till's own fence — and whatever cannot
 * go back is named, because it is usually why the sale was refused.
 */
const item = (over: Partial<Product> = {}): Product =>
  ({ id: "milk", name: "Milkpak 1L", type: "product", is_active: true, variants: [], units: [], modifier_groups: [], ...over }) as Product;

const shop = new Map<string, Product>([
  ["milk", item()],
  ["kurta", item({ id: "kurta", name: "Lawn Kurta", variants: [{ id: "m", name: "M", price: 2000 } as never] })],
  ["eggs", item({ id: "eggs", name: "Eggs", units: [{ id: "tray", name: "Tray of 30", factor: 30 } as never] })],
  ["tea", item({ id: "tea", name: "Doodh Patti", modifier_groups: [{ id: "g", name: "Sugar", options: [{ id: "less", name: "Less sugar", price_delta: 0 }, { id: "big", name: "Large cup", price_delta: 40 }] } as never] })],
  ["mango", item({ id: "mango", name: "Seasonal Mango", is_active: false })],
  ["rice", item({ id: "rice", name: "Basmati" })],
]);
const find = (id: string) => shop.get(id);
const fence = (p: Product) => (p.id === "rice" ? "Basmati is out of stock" : null);

describe("ringing a refused slip again", () => {
  it("puts back each line as it was rung — size, pack, options, discount, level", () => {
    const plan = planRingAgain(
      {
        items: [
          { product_id: "milk", quantity: 3, line_discount: 20, price_level: "wholesale" },
          { product_id: "kurta", variant_id: "m", quantity: 1, line_discount_pct: 10 },
          { product_id: "eggs", quantity: 2, product_unit_id: "tray" },
          { product_id: "tea", quantity: 1, modifier_option_ids: ["less", "big"] },
        ],
      },
      find,
      fence,
    );

    expect(plan.left).toEqual([]);
    expect(plan.lines.map((l) => [l.product.id, l.size?.id ?? null, l.quantity, l.unitId])).toEqual([
      ["milk", null, 3, null],
      ["kurta", "m", 1, null],
      ["eggs", null, 2, "tray"],
      ["tea", null, 1, null],
    ]);
    expect(plan.lines[0].discount).toEqual({ value: 20, mode: "amt" });
    expect(plan.lines[0].priceLevel).toBe("wholesale");
    expect(plan.lines[1].discount).toEqual({ value: 10, mode: "pct" });
    expect(plan.lines[3].options).toEqual({ ids: ["less", "big"], label: "Less sugar, Large cup", delta: 40 });
  });

  it("names what cannot go back — gone, switched off, out of stock, a size or pack or option no longer offered", () => {
    const plan = planRingAgain(
      {
        items: [
          { product_id: "shampoo", quantity: 1 },
          { product_id: "mango", quantity: 2 },
          { product_id: "rice", quantity: 1 },
          { product_id: "kurta", variant_id: "xl", quantity: 1 },
          { product_id: "eggs", quantity: 1, product_unit_id: "crate" },
          { product_id: "tea", quantity: 1, modifier_option_ids: ["honey"] },
          { product_id: "milk", amount: 500 },
          { product_id: "milk", quantity: 1 },
        ],
      },
      find,
      fence,
    );

    expect(plan.lines.map((l) => l.product.id)).toEqual(["milk"]);
    expect(plan.left).toEqual([
      "One item the shop no longer has — deleted since it was rung.",
      "Seasonal Mango: switched off since it was rung.",
      "Basmati is out of stock",
      "Lawn Kurta: that size is no longer sold.",
      "Eggs: that pack is no longer sold.",
      "Doodh Patti: one of its options is no longer offered.",
      "Milkpak 1L: rung as an amount of money — ring it by hand.",
    ]);
  });

  it("reads a slip from an older build without throwing", () => {
    expect(planRingAgain({}, find, fence)).toEqual({ lines: [], left: [] });
    expect(planRingAgain({ items: [null, { product_id: 7 }] }, find, fence).left).toEqual([
      "2 items the shop no longer has — deleted since they were rung.",
    ]);
  });
});

describe("the bill around the lines", () => {
  it("keeps the customer, the bill discount and a simple tender; a split or khata is chosen again", () => {
    expect(slipBill({ customer_name: "Ayesha", customer_phone: "03001234567", discount: "50", payment_method: "card" })).toEqual({
      customerName: "Ayesha", customerPhone: "03001234567", discount: 50, method: "card",
    });
    expect(slipBill({ payment_method: "credit" }).method).toBeNull();
    expect(slipBill({ payments: [{ method: "cash", amount: 100 }] }).method).toBeNull();
  });
});
