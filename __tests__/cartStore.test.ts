import { cartCountOf, cartKeyOf, useCartStore } from "../src/stores/cartStore";

const cart = () => useCartStore.getState();
const burger = { product_id: "p1", variant_id: null, name: "Burger", unit_price: 450 };
const mangoes = {
  product_id: "p2",
  variant_id: null,
  name: "Mangoes",
  unit_price: 400,
  sold_by: "weight" as const,
};

beforeEach(() => useCartStore.getState().clear());

describe("how full the basket is", () => {
  // The bug this replaced: the tab-bar badge summed quantities and the shop
  // page's cart bar counted lines, so the same basket read 3 in one place and
  // 2 in the other — a thumb-width apart, on one screen.
  it("counts each unit item, not each line", () => {
    cart().add("burger-hut", burger, 2);
    cart().add("burger-hut", { ...burger, product_id: "p9", name: "Chips" }, 1);

    expect(cart().count()).toBe(3);
  });

  it("counts a weight line as one thing", () => {
    cart().add("mart", mangoes, 0.5);

    // Half a kilo of mangoes is one thing you are buying. "0.5" in a badge is
    // not a number anyone can act on.
    expect(cart().count()).toBe(1);
  });

  it("is the same rule wherever it is asked", () => {
    cart().add("burger-hut", burger, 2);

    // The badge calls the exported helper; the cart bar calls the store. They
    // must not be able to disagree again.
    expect(cartCountOf(cart().lines)).toBe(cart().count());
  });
});

describe("one shop at a time", () => {
  it("warns before a different shop would empty the basket", () => {
    cart().add("burger-hut", burger, 1);

    expect(cart().wouldReplace("kebab-corner")).toBe(true);
    expect(cart().wouldReplace("burger-hut")).toBe(false);
  });

  it("does not warn when there is nothing to lose", () => {
    // An empty basket has no contents to discard, so a prompt would be a
    // question about nothing — and people learn to dismiss those unread.
    expect(cart().wouldReplace("kebab-corner")).toBe(false);
  });

  it("replaces the basket when the shop changes", () => {
    cart().add("burger-hut", burger, 2);
    cart().add("kebab-corner", { ...burger, product_id: "k1", name: "Seekh" }, 1);

    expect(cart().shopSlug).toBe("kebab-corner");
    expect(cart().lines.map((l) => l.name)).toEqual(["Seekh"]);
  });
});

describe("adding the same thing twice", () => {
  it("adds to the line instead of making a second one", () => {
    cart().add("burger-hut", burger, 1);
    cart().add("burger-hut", burger, 2);

    expect(cart().lines).toHaveLength(1);
    expect(cart().lines[0].quantity).toBe(3);
  });

  it("keeps different choices on different lines", () => {
    cart().add("burger-hut", { ...burger, modifier_option_ids: ["cheese"] }, 1);
    cart().add("burger-hut", { ...burger, modifier_option_ids: ["bacon"] }, 1);

    expect(cart().lines).toHaveLength(2);
  });

  it("treats the same choices in a different order as the same line", () => {
    cart().add("burger-hut", { ...burger, modifier_option_ids: ["cheese", "bacon"] }, 1);
    cart().add("burger-hut", { ...burger, modifier_option_ids: ["bacon", "cheese"] }, 1);

    expect(cart().lines).toHaveLength(1);
    expect(cart().lines[0].quantity).toBe(2);
  });

  it("never edits a line object React has already rendered", () => {
    cart().add("burger-hut", burger, 1);
    const before = cart().lines[0];

    cart().add("burger-hut", burger, 1);

    // The previous version copied the ARRAY and mutated the object inside it.
    // A shallow copy shares its objects, so the rendered snapshot changed
    // underneath React — invisible until something holds on to a line.
    expect(before.quantity).toBe(1);
    expect(cart().lines[0].quantity).toBe(2);
    expect(cart().lines[0]).not.toBe(before);
  });
});

describe("quantities", () => {
  it("drops a line taken to zero", () => {
    cart().add("burger-hut", burger, 1);
    cart().setQty(cartKeyOf(cart().lines[0]), 0);

    expect(cart().lines).toHaveLength(0);
  });

  it("refuses to go negative", () => {
    cart().add("burger-hut", burger, 1);
    cart().setQty(cartKeyOf(cart().lines[0]), -5);

    expect(cart().lines).toHaveLength(0);
  });

  it("keeps a weight to three places", () => {
    cart().add("mart", mangoes, 0.1);
    cart().add("mart", mangoes, 0.2);

    // 0.1 + 0.2 is 0.30000000000000004, and that reaches the server as a
    // weight and the customer as a price.
    expect(cart().lines[0].quantity).toBe(0.3);
  });

  it("totals what the shop will charge", () => {
    cart().add("burger-hut", burger, 2);
    cart().add("mart", mangoes, 0.5); // replaces — different shop

    expect(cart().subtotal()).toBe(200);
  });
});
