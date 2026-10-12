import { describe, expect, it } from "vitest";

import type { Product } from "../catalog/types";
import { asksFirst, choiceIsComplete, groupIsAnswered, itemsOf, lineAnswers, lineKey, lineName, lineOf, toggled, unitPriceOf, whatIsMissing } from "./takeOrder";

const SPICE = { id: "g-spice", name: "Spice", type: "modifier" as const, min_select: 1, max_select: 1, options: [{ id: "o-mild", name: "Mild", price_delta: 0 }, { id: "o-hot", name: "Hot", price_delta: 0 }] };
const EXTRAS = { id: "g-extras", name: "Extras", type: "addon" as const, min_select: 0, max_select: 2, options: [{ id: "o-naan", name: "Extra naan", price_delta: 60 }, { id: "o-raita", name: "Raita", price_delta: "80.00" }, { id: "o-salad", name: "Salad", price_delta: 40 }] };

const dish = (over: Record<string, unknown> = {}) =>
  ({ id: "p-biryani", name: "Chicken Biryani", type: "product", price: "450.00", discount_price: null, variants: [], modifier_groups: [], ...over }) as unknown as Product;
const karahi = dish({
  id: "p-karahi", name: "Chicken Karahi", price: "900.00",
  variants: [{ id: "v-half", name: "Half", price: "900.00", is_active: true }, { id: "v-full", name: "Full", price: 1600, is_active: true }, { id: "v-old", name: "Family", price: 3000, is_active: false }],
  modifier_groups: [SPICE, EXTRAS],
});

describe("a line of an order being taken", () => {
  it("a plain dish goes straight on; one with sizes or a question is asked about first", () => {
    expect(asksFirst(dish())).toBe(false);
    expect(asksFirst(karahi)).toBe(true);
    expect(asksFirst(dish({ modifier_groups: [SPICE] }))).toBe(true);
    // A group nobody has put an option in asks nothing.
    expect(asksFirst(dish({ modifier_groups: [{ ...SPICE, options: [] }] }))).toBe(false);
    // …and a size that has been retired is not a size.
    expect(asksFirst(dish({ variants: [{ id: "v", name: "Old", price: 1, is_active: false }] }))).toBe(false);
  });

  it("cannot go on the order without a size, or with its question unanswered — and says which", () => {
    expect(choiceIsComplete(karahi, { variantId: null, byGroup: {} })).toBe(false);
    expect(whatIsMissing(karahi, { variantId: null, byGroup: {} })).toBe("Choose a size.");

    expect(choiceIsComplete(karahi, { variantId: "v-full", byGroup: {} })).toBe(false);
    expect(whatIsMissing(karahi, { variantId: "v-full", byGroup: {} })).toBe("Choose one for Spice.");

    const answered = { variantId: "v-full", byGroup: { "g-spice": ["o-hot"] } };
    expect(choiceIsComplete(karahi, answered)).toBe(true);
    expect(whatIsMissing(karahi, answered)).toBeNull();
  });

  it("one answer replaces another; extras stop at their limit; nought means as many as you like", () => {
    expect(toggled(SPICE, ["o-mild"], "o-hot")).toEqual(["o-hot"]);
    expect(toggled(SPICE, ["o-hot"], "o-hot")).toEqual([]);

    expect(toggled(EXTRAS, ["o-naan"], "o-raita")).toEqual(["o-naan", "o-raita"]);
    expect(toggled(EXTRAS, ["o-naan", "o-raita"], "o-salad"), "a third extra went in past the two allowed").toEqual(["o-naan", "o-raita"]);

    const anyNumber = { ...EXTRAS, max_select: 0 };
    expect(toggled(anyNumber, ["o-naan", "o-raita"], "o-salad")).toEqual(["o-naan", "o-raita", "o-salad"]);
    expect(groupIsAnswered(anyNumber, ["o-naan", "o-raita", "o-salad"])).toBe(true);
    expect(groupIsAnswered(EXTRAS, ["o-naan", "o-raita", "o-salad"])).toBe(false);
  });

  it("is charged at its size's own price, and each extra at what it adds", () => {
    const full = karahi.variants![1];

    expect(unitPriceOf(karahi, full, [])).toBe(1600);
    expect(unitPriceOf(karahi, full, [EXTRAS.options[0], EXTRAS.options[1]])).toBe(1740);
    expect(unitPriceOf(karahi, karahi.variants![0], [])).toBe(900);
    // No size to choose: the dish's own price — its sale price, when it has one.
    expect(unitPriceOf(dish({ price: "450.00", discount_price: "400.00" }), null, [])).toBe(400);
  });

  it("is written the way a waiter writes it", () => {
    const line = lineOf(karahi, { variantId: "v-full", byGroup: { "g-spice": ["o-hot"], "g-extras": ["o-naan"] } });

    expect(lineName(line)).toBe("Chicken Karahi (Full)");
    expect(lineAnswers(line)).toBe("Hot · Extra naan");
    expect(lineName(lineOf(dish(), { variantId: null, byGroup: {} }))).toBe("Chicken Biryani");
    expect(lineAnswers(lineOf(dish(), { variantId: null, byGroup: {} }))).toBe("");
  });

  it("the same dish, size and answers is one line; a different size or answer is another", () => {
    const hot = lineOf(karahi, { variantId: "v-full", byGroup: { "g-spice": ["o-hot"], "g-extras": ["o-naan", "o-raita"] } });
    const sameOtherOrder = lineOf(karahi, { variantId: "v-full", byGroup: { "g-extras": ["o-raita", "o-naan"], "g-spice": ["o-hot"] } });
    const mild = lineOf(karahi, { variantId: "v-full", byGroup: { "g-spice": ["o-mild"], "g-extras": ["o-naan", "o-raita"] } });
    const half = lineOf(karahi, { variantId: "v-half", byGroup: { "g-spice": ["o-hot"], "g-extras": ["o-naan", "o-raita"] } });

    expect(sameOtherOrder.key).toBe(hot.key);
    expect(mild.key).not.toBe(hot.key);
    expect(half.key).not.toBe(hot.key);
    expect(lineKey("p", null, [])).not.toBe(lineKey("p", "v", []));
  });

  it("says to the server which size and which answers — the words the order itself uses", () => {
    const lines = [
      lineOf(karahi, { variantId: "v-full", byGroup: { "g-spice": ["o-hot"], "g-extras": ["o-naan"] } }, 2),
      lineOf(dish(), { variantId: null, byGroup: {} }, 3),
    ];

    expect(itemsOf(lines)).toEqual([
      { product_id: "p-karahi", variant_id: "v-full", quantity: 2, modifier_option_ids: ["o-hot", "o-naan"] },
      { product_id: "p-biryani", variant_id: null, quantity: 3, modifier_option_ids: [] },
    ]);
  });
});
