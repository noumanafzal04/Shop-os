import { describe, expect, it } from "vitest";
import { ApiError } from "../../common/types/api";
import { effectiveTaxRate, priceCart, taxOnLines } from "../offline/pricing/priceCart";
import { asProduct } from "../offline/lookup/browse";
import type { CatalogItem } from "../offline/sync/catalogService";
import { taxFieldsOf } from "./taxFields";
import { billKey, serverDueFrom } from "./tenderRecovery";

/**
 * THE FIGURE A CASHIER READS IS THE FIGURE THE SERVER CHARGES.
 *
 * ── The report ───────────────────────────────────────────────────────
 *
 *     Amount due   Rs 12,610
 *     Sale failed  Amount paid (12,610.00) is less than the total (14,023.94).
 *
 * And, with it: *"u did not properly test pos screen in detailed."* Correct.
 *
 * ── What was actually untested ───────────────────────────────────────
 *
 * The pricing engine in `offline/pricing` is held to the server by golden
 * fixtures rung through the real endpoint. It handles a tax group. It was
 * green the whole time.
 *
 * It was also not what the counter screen used. `PosPage` had its own copy
 * of the arithmetic inline — two steps for the tax rate where the server
 * takes three — and the tested engine ran beside it as a SHADOW. So every
 * guarantee here was a guarantee about code the cashier's number did not
 * come from.
 *
 * The fix is one implementation. These cases are what hold it to one: the
 * rule itself, every door a product reaches the cart by, and the page's own
 * source — which is read as text, because rendering a till (a shift, a
 * catalog, an outbox, a scanner) to ask what arithmetic it uses costs more
 * than it proves.
 */

const TILL_BILL = Object.values(
  import.meta.glob("./tillBill.ts", { query: "?raw", import: "default", eager: true }),
)[0] as string;

const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

/** Source with the prose removed, so a rule cannot be satisfied — or broken —
 *  by the comment that explains it. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the rate a line is taxed at", () => {
  it("is the group's when there is one — the step the screen never took", () => {
    // The exact row that produced the report: no rate of its own, a group at
    // 18%, a shop default of zero. The screen said 0. The server said 18.
    expect(effectiveTaxRate({ tax_rate: null, tax_group_rate: 18 }, 0)).toBe(18);
  });

  it("lets the group beat the product's own rate", () => {
    expect(effectiveTaxRate({ tax_rate: 5, tax_group_rate: 18 }, 0)).toBe(18);
  });

  it("falls to the product's own rate, then to the shop's", () => {
    expect(effectiveTaxRate({ tax_rate: 5, tax_group_rate: null }, 13)).toBe(5);
    expect(effectiveTaxRate({ tax_rate: null, tax_group_rate: null }, 13)).toBe(13);
  });

  it("reads a ZERO group rate as a rate, not as an absence", () => {
    // Exempt is a decision somebody made. `||` instead of a null check here
    // would turn an exempt group into the shop default and start charging
    // tax on flour.
    expect(effectiveTaxRate({ tax_rate: 17, tax_group_rate: 0 }, 17)).toBe(0);
    expect(effectiveTaxRate({ tax_rate: 0, tax_group_rate: null }, 17)).toBe(0);
  });

  it("reads a MISSING field as no opinion — a ticket parked before the field existed", () => {
    expect(effectiveTaxRate({}, 13)).toBe(13);
    expect(effectiveTaxRate({ tax_rate: 5 }, 13)).toBe(5);
  });
});

describe("the reported cart", () => {
  /**
   * Two groups and a shop default of zero — the shape of the tenant the
   * report came from ("Standard 18%", "Reduced 10%").
   */
  const lines = [
    { price: 4200, tax_rate: null, tax_group_rate: 18 },
    { price: 6310, tax_rate: null, tax_group_rate: 10 },
    { price: 2100, tax_rate: null, tax_group_rate: null },
  ];
  const subtotal = 12610;

  it("is short by exactly the group tax when the group is ignored", () => {
    // What the screen computed: every line at the shop default.
    const ignoring = taxOnLines(
      lines.map((l) => ({ line_total: l.price, tax_rate: effectiveTaxRate({ tax_rate: l.tax_rate }, 0) })),
      subtotal, subtotal, false,
    );
    expect(ignoring).toBe(0);
    expect(subtotal + ignoring).toBe(12610);
  });

  it("matches the engine — and so the server — when it is not", () => {
    const tax = taxOnLines(
      lines.map((l) => ({ line_total: l.price, tax_rate: effectiveTaxRate(l, 0) })),
      subtotal, subtotal, false,
    );
    expect(tax).toBe(1387); // 756 + 631 + 0

    // The same cart through the engine the golden fixtures hold to the
    // server. Not a second derivation of the expected number: the claim is
    // that the SCREEN'S path and the ENGINE'S path are one path.
    const engine = priceCart(
      lines.map((l) => ({
        item: { price: l.price, discount_price: null, wholesale_price: null, price_tiers: null, tax_rate: l.tax_rate, tax_group_rate: l.tax_group_rate },
        quantity: 1,
      })),
      { default_tax_rate: 0, tax_inclusive: false },
    );
    expect(engine.tax).toBe(tax);
    expect(engine.total).toBe(subtotal + tax);
  });

  it("extracts rather than adds when prices already include the tax", () => {
    const tax = taxOnLines([{ line_total: 118, tax_rate: 18 }], 118, 118, true);
    expect(tax).toBe(18);
  });

  it("spreads a cart discount across the lines before taxing them", () => {
    // Rs 100 off a Rs 1,000 cart at 18%: tax is on 900, not on 1,000.
    expect(taxOnLines([{ line_total: 1000, tax_rate: 18 }], 1000, 900, false)).toBe(162);
  });

  it("rounds at every addition, the way the server does", () => {
    /**
     * Three lines of 33.33 at 17%. Each is 5.6661 of tax.
     *
     *   rounded per line   5.67 + 5.67 + 5.67 = 17.01   (the server)
     *   rounded at the end 16.9983 -> 17.00             (the old screen)
     *
     * One paisa. A card tender has no change to absorb one paisa, so the
     * sale is refused — the same failure as the tax group, a hundredth the
     * size and far harder to see.
     */
    const three = [1, 2, 3].map(() => ({ line_total: 33.33, tax_rate: 17 }));
    expect(taxOnLines(three, 99.99, 99.99, false)).toBe(17.01);
  });
});

describe("every door a product reaches the cart by carries both tax fields", () => {
  it("reads them off a product, coercing a decimal column's strings", () => {
    expect(taxFieldsOf({ tax_rate: "5.00", tax_group_rate: "18.00" })).toEqual({ tax_rate: 5, tax_group_rate: 18 });
  });

  it("answers null — never zero — for what is not there", () => {
    // The substitute door used to pass `{ id, name, price }` and nothing
    // else. That must read as "no opinion", not as exempt.
    expect(taxFieldsOf({ id: "x", name: "y", price: 10 })).toEqual({ tax_rate: null, tax_group_rate: null });
    expect(taxFieldsOf({ tax_rate: null, tax_group_rate: "" })).toEqual({ tax_rate: null, tax_group_rate: null });
    expect(taxFieldsOf({ tax_rate: "abc" })).toEqual({ tax_rate: null, tax_group_rate: null });
  });

  it("keeps an explicit zero, which is a rate", () => {
    expect(taxFieldsOf({ tax_rate: 0, tax_group_rate: "0.00" })).toEqual({ tax_rate: 0, tax_group_rate: 0 });
  });

  it("is spread at EVERY place the page builds a cart line", () => {
    /**
     * Three literals create a line: the grid/scanner, the size-and-modifier
     * sheet, and a parked ticket being resumed. Before this, one of the
     * three copied a tax rate by hand and the modifier sheet copied none —
     * so every configured dish in a restaurant was taxed at the shop default.
     *
     * Counted, so a fourth door added later has to say what it does.
     */
    const creations = code.match(/key: `c\$\{\+\+ck\}`/g) ?? [];
    expect(creations).toHaveLength(3);

    // Two take the fields from a product; the third restores a stored line.
    expect(code.match(/\.\.\.taxFieldsOf\(/g) ?? []).toHaveLength(2);
    expect(code).toMatch(/tax_group_rate: \(l as Partial<CartLine>\)\.tax_group_rate \?\? null/);
  });

  it("adds a substitute as the product that was fetched, not three of its fields", () => {
    expect(code).toMatch(/addLine\(full \?\? \{ id: alt\.id, name: alt\.name, price: alt\.price \}\)/);
  });
});

describe("the page has ONE copy of the tax rule, and it is not its own", () => {
  it("takes the whole bill from the one implementation, which takes its tax from the engine", () => {
    // The page gathers; `tillBill` adds up. The tax inside it is the pricing
    // engine's, so the counter and the offline engine share ONE tax rule.
    expect(code).toMatch(/const bill = useMemo\(\(\) => tillBill\(\{/);
    expect(code).toMatch(/const taxAmount = bill\.tax;/);
    expect(TILL_BILL).toMatch(/import \{ effectiveTaxRate, taxOnLines \} from "\.\.\/offline\/pricing\/priceCart"/);
    expect(TILL_BILL).toMatch(/const tax = taxOnLines\(/);
  });

  it("has no inline fallback from a line's rate to the shop default", () => {
    /**
     * The two-step rule, in the two spellings it had. Either one back in
     * this file is the bug back in this file: it is the expression that had
     * never heard of a tax group.
     */
    expect(code).not.toMatch(/l\.tax_rate == null \? taxRate : l\.tax_rate/);
    expect(code).not.toMatch(/l\.tax_rate \?\? taxRate/);
  });

  it("does not sum the tax raw and round once", () => {
    // The other drift: `Math.round(cart.reduce(...) * 100) / 100` over the
    // tax. The engine rounds at every addition because the server does.
    expect(code).not.toMatch(/const taxAmount = subtotal > 0\s*\?\s*Math\.round\(cart\.reduce/);
  });

  it("shows each line's tax at the same rate the total used", () => {
    // Two call sites: the total, and the per-line figure in the cart table.
    // A line drawn at one rate under a total computed at another is a
    // receipt that does not add up in front of the customer.
    expect(code).toMatch(/effectiveTaxRate\(l, taxRate\)/);
    expect(code).toMatch(/defaultTaxRate: taxRate,/);
    expect(TILL_BILL).toMatch(/effectiveTaxRate\(l, input\.defaultTaxRate\)/);
  });
});

describe("the promotion on the screen is of the cart being rung", () => {
  it("tells the preview what each line comes to", () => {
    // Without it the server previews shelf price × quantity — a different
    // cart whenever a break, a trade price or a line discount applies.
    expect(code).toMatch(/line_total: lineNet\(l\)/);
    expect(code).toMatch(/\.preview\(billLines\.map/);
  });

  it("asks the till's own engine when there is nobody to ask", () => {
    const effect = code.slice(code.indexOf(".preview(billLines.map"), code.indexOf("const clearSale"));
    expect(effect).toMatch(/\.catch\(async \(\) => \{/);
    expect(effect).toMatch(/promotionLocally\(lines,/);
  });
});

describe("an offline till learns the group's rate too", () => {
  const item = (over: Partial<CatalogItem>): CatalogItem =>
    ({
      id: "p1", name: "Item", sku: null, barcode: null, plu_code: null, category_id: null,
      item_type: "physical_product", unit: null, sold_by: "unit", price: 100, discount_price: null,
      wholesale_price: null, price_tiers: null, min_order_qty: null, tax_rate: null, tax_group_id: null,
      track_inventory: true, stock: 5, low_stock_threshold: null, available_from: null,
      available_until: null, requires_prescription: false, drug_schedule: null, tracks_serial: false,
      kitchen_station: null, variants: [], units: [], modifier_groups: [],
      ...over,
    }) as unknown as CatalogItem;

  it("translates the group id the device holds into the rate it charges", () => {
    /**
     * Offline this is worse than a refusal at the counter. The checkout
     * priced the sale correctly; the SCREEN did not, so the cashier took the
     * smaller figure and queued a sale the server would refuse hours later,
     * with the customer long gone.
     */
    const rates = new Map([["g18", 18]]);
    const p = asProduct(item({ tax_group_id: "g18" }), rates);

    expect(taxFieldsOf(p)).toEqual({ tax_rate: null, tax_group_rate: 18 });
  });

  it("says null for a group that is not on the device, rather than guessing", () => {
    expect(taxFieldsOf(asProduct(item({ tax_group_id: "gone" }), new Map()))).toEqual({
      tax_rate: null, tax_group_rate: null,
    });
  });

  it("passes the rates on both doors that put an offline row in a cart", () => {
    // The scanner, and the shelf. `rows.map(asProduct)` would hand the INDEX
    // in as the rates and compile only by accident of typing.
    expect(code).toMatch(/asProduct\(hit\.item, offlineShelf\.data\?\.taxRates \?\? \(await loadTaxRates\(\)\)\)/);
  });
});

describe("a short tender is a question the till can answer", () => {
  const refusal = (meta: Record<string, unknown>, code = "PAYMENT_INSUFFICIENT") =>
    new ApiError("Amount paid (12,610.00) is less than the total (14,023.94).", 422, code, {}, meta);

  it("reads the figure the server will accept", () => {
    expect(serverDueFrom(refusal({ payable: 14023.94 }))).toBe(14023.94);
    // A decimal column arrives as a string on some endpoints.
    expect(serverDueFrom(refusal({ payable: "14023.94" }))).toBe(14023.94);
  });

  it("reads `payable`, never `amount_due` — they differ by the goods and the bank", () => {
    /**
     * A trade-in: the bill is 10,000 and the battery on the counter settles
     * 3,000. `amount_due` is 10,000 — true, and not what the customer is
     * asked for. A till that showed it would charge for the battery twice.
     */
    expect(serverDueFrom(refusal({ amount_due: 10000, payable: 7000, trade_in: 3000 }))).toBe(7000);
    // An old server that says only `amount_due` gets no correction, rather
    // than a wrong one: the cashier sees the server's sentence instead.
    expect(serverDueFrom(refusal({ amount_due: 10000 }))).toBeNull();
  });

  it("answers the refusals that are about the figure, both ways", () => {
    // Too high, on a card — the member's discount the till never knew.
    expect(serverDueFrom(refusal({ payable: 9000 }, "CHANGE_WITHOUT_CASH"))).toBe(9000);
    // Either way, when the till said what it showed.
    expect(serverDueFrom(refusal({ payable: 9000 }, "BILL_MISMATCH"))).toBe(9000);
  });

  it("does NOT parse the sentence", () => {
    // The number is right there in the message, formatted. Reading it out of
    // prose is one thousands separator away from charging Rs 14.
    expect(serverDueFrom(refusal({}))).toBeNull();
  });

  it("stays out of every refusal that is not about the amount", () => {
    expect(serverDueFrom(refusal({ payable: 500 }, "OUT_OF_STOCK"))).toBeNull();
    expect(serverDueFrom(new Error("network"))).toBeNull();
    expect(serverDueFrom(null)).toBeNull();
  });

  it("takes a bill of nothing, and refuses a figure that is not a bill", () => {
    // A group that takes the whole bill is a real sale of Rs 0.
    expect(serverDueFrom(refusal({ payable: 0 }, "BILL_MISMATCH"))).toBe(0);
    expect(serverDueFrom(refusal({ payable: -5 }))).toBeNull();
    expect(serverDueFrom(refusal({ payable: "soon" }))).toBeNull();
  });

  it("tells the server what the cashier was shown, online only", () => {
    expect(code).toMatch(/salesService\.create\(\{ \.\.\.payload, expected_payable: payable \}\)/);
    // Not in the payload itself, which is also what the OFFLINE queue stores:
    // a sale that already happened must never be refused at sync over it.
    const payloadBlock = code.slice(code.indexOf("const payload"), code.indexOf("if (!connected) return"));
    expect(payloadBlock).not.toMatch(/expected_payable/);
  });

  it("never completes the sale by itself", () => {
    /**
     * The mutation's `onError` may put a figure on screen. It may not ring
     * anything: a till that quietly retried at a higher price would be
     * taking money nobody agreed to.
     */
    const onError = code.slice(code.indexOf("onError: (error: unknown) => {"), code.indexOf("onSuccess: ({ data }) => {"));
    expect(onError).toMatch(/setServerDue\(due\)/);
    expect(onError).not.toMatch(/\.mutate\(|checkout\./);
  });

  it("takes the bank's share off the figure once, corrected or not", () => {
    /**
     * `payable` is the till's figure OR the server's correction, and both are
     * the amount BEFORE the bank's share — the server states `payable`, not
     * `amount_due`, for this. So it comes off the same way in both cases.
     *
     * The first version drew the server's figure "whole", which was right
     * while that figure was `amount_due` and would have shown a bank-offer
     * sale Rs 1,000 high once it stopped being.
     */
    expect(code).toMatch(/\{money\(Math\.max\(0, payable - bankDiscount\)\)\}/);
    expect(code).not.toMatch(/money\(serverDue \?\?/);
  });
});

describe("a corrected figure belongs to one bill", () => {
  const base = {
    lines: [{ product_id: "a", quantity: 1, unit_price: 100 }],
    discount: 0, couponDiscount: 0, promoDiscount: 0, redeemPoints: 0,
    method: "card", splitMethods: ["cash"], tradeInTotal: 0, bankId: null, customerPhone: "",
  };

  it("is the same key for the same bill", () => {
    expect(billKey(base)).toBe(billKey({ ...base, lines: [{ ...base.lines[0] }] }));
  });

  it.each([
    ["a line's quantity", { lines: [{ product_id: "a", quantity: 2, unit_price: 100 }] }],
    ["a line being added", { lines: [...base.lines, { product_id: "b", quantity: 1, unit_price: 5 }] }],
    ["a line's discount", { lines: [{ ...base.lines[0], discountValue: 10, discountMode: "pct" }] }],
    ["the cart discount", { discount: 50 }],
    ["a coupon", { couponDiscount: 20 }],
    ["a promotion", { promoDiscount: 20 }],
    ["redeemed points", { redeemPoints: 100 }],
    ["the tender — cash rounds, card does not", { method: "cash" }],
    ["a trade-in", { tradeInTotal: 500 }],
    ["the bank whose offer applies", { bankId: "hbl" }],
    ["the customer — a member's price is a different bill", { customerPhone: "0300" }],
  ])("changes with %s", (_what, over) => {
    // Each of these would make the server answer differently. Carrying the
    // old figure across any of them is a wrong number with the server's
    // name on it.
    expect(billKey({ ...base, ...over })).not.toBe(billKey(base));
  });

  it("is dropped by the page whenever the key changes", () => {
    expect(code).toMatch(/useEffect\(\(\) => \{\s*setServerDue\(null\);\s*\}, \[currentBill\]\)/);
  });
});
