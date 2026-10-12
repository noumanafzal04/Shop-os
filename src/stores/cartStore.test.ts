import { beforeEach, describe, expect, it } from "vitest";

import { PKR, type CurrencyFormat } from "../common/format/currency";
import { basketCurrency, useCartStore, type CartLine } from "./cartStore";

/**
 * A BASKET ACROSS SHOPS IS IN EACH SHOP'S OWN MONEY.
 *
 * A customer fills one basket from several shops, and every figure on it was
 * written in rupees. A shop trades in its own currency now, so a slice of the
 * basket is in ITS money — and where two shops trade in different money there
 * is no single figure that adds them up, and the screen must not print one.
 */

const USD: CurrencyFormat = { code: "USD", name: "US Dollar", symbol: "$", grouping: "western", decimals: "always", space: false, cash: [] };

const line = (shop: string, price: number, currency?: CurrencyFormat): Omit<CartLine, "quantity"> => ({
  shop_slug: shop, shop_name: shop, currency, product_id: `p-${shop}-${price}`, variant_id: null,
  name: "Thing", unit_price: price, in_stock: true,
});

describe("a basket in more than one shop's money", () => {
  beforeEach(() => useCartStore.getState().clear());

  it("each shop's slice is in that shop's currency", () => {
    useCartStore.getState().add(line("lahore-mart", 500, PKR), 2);
    useCartStore.getState().add(line("dallas-deli", 12.5, USD), 2);

    const groups = useCartStore.getState().groups();

    expect(groups.map((g) => [g.shop_slug, g.currency.code, g.subtotal])).toEqual([
      ["lahore-mart", "PKR", 1000],
      ["dallas-deli", "USD", 25],
    ]);
  });

  it("a line from before shops had currencies is in the default", () => {
    useCartStore.getState().add(line("old-shop", 300));

    expect(useCartStore.getState().groups()[0].currency).toEqual(PKR);
  });

  it("has ONE currency when every shop shares it — and none when they do not", () => {
    useCartStore.getState().add(line("lahore-mart", 500, PKR));
    useCartStore.getState().add(line("karachi-bakery", 200, PKR));
    expect(basketCurrency(useCartStore.getState().groups())?.code).toBe("PKR");

    useCartStore.getState().add(line("dallas-deli", 12.5, USD));
    // 500 + 200 + 12.5 is not 712.50 of anything.
    expect(basketCurrency(useCartStore.getState().groups())).toBeNull();
  });

  it("an empty basket is in the default, not in nothing", () => {
    expect(basketCurrency([])).toEqual(PKR);
  });
});
