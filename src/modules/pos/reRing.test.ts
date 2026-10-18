import { describe, expect, it } from "vitest";

import type { Product } from "../catalog/types";
import type { Sale, SaleItem } from "../sales/types";
import { reRingDifference, reRingingOf, slipOf } from "./reRing";

/** Q19 B: the bill loaded back, and only the difference asked for. */
const money = (n: number) => `Rs ${n.toLocaleString("en-US")}`;

const milk = {
  id: "milk", name: "Milk", price: "100",
  units: [{ id: "crate", name: "Crate", factor: 12, price: 1150 }],
  modifier_groups: [{ id: "g1", name: "Temp", type: "modifier", min_select: 0, max_select: 1, options: [{ id: "cold", name: "Cold", price_delta: 10 }] }],
} as unknown as Product;

const line = (over: Partial<SaleItem>): SaleItem => ({
  id: "l1", product_id: "milk", variant_id: null, product_name: "Milk", variant_name: null, sku: null,
  item_type: "product", quantity: 2, unit_price: "100", line_total: "200", ...over,
});

describe("what may be re-rung", () => {
  it("is what the server says, with what was paid added up", () => {
    const sale = { id: "s1", invoice_number: "INV-000034", re_ring: { open: true, why_not: null, carried: [{ method: "cash", amount: 800 }, { method: "card", amount: 200 }] } };
    expect(reRingingOf(sale)).toEqual({ id: "s1", invoice_number: "INV-000034", carried: sale.re_ring.carried, paid: 1000 });
    expect(reRingingOf({ ...sale, re_ring: { open: false, why_not: "items were already returned from it", carried: [] } })).toBeNull();
    expect(reRingingOf({ ...sale, re_ring: null })).toBeNull();
  });
});

describe("the bill loaded back onto the counter", () => {
  it("keeps the items, the pack, the options, the discount and the serial numbers", () => {
    const sale = {
      items: [line({ quantity: 1, unit_name: "Crate", line_discount: "50.00", modifiers: [{ group: "Temp", name: "Cold", price_delta: 10 }] })],
      serials: [{ id: "x", sale_item_id: "l1", product_name: "Milk", serial: "SN-1", warranty_months: null, warranty_expires_at: null }],
    } as Pick<Sale, "items" | "serials">;

    expect(slipOf(sale, () => milk)).toEqual({
      sale: { items: [{ product_id: "milk", variant_id: null, quantity: 1, product_unit_id: "crate", line_discount: 50, modifier_option_ids: ["cold"], serials: ["SN-1"] }] },
      left: [],
    });
  });

  it("gives each line its own serial numbers, and none that came back", () => {
    const serial = (id: string, sale_item_id: string, returned_at: string | null = null) =>
      ({ id, sale_item_id, product_name: "Milk", serial: id, warranty_months: null, warranty_expires_at: null, returned_at });
    const sale = {
      items: [line({ id: "l1", quantity: 1 }), line({ id: "l2", quantity: 1 })],
      serials: [serial("SN-1", "l1"), serial("SN-2", "l2"), serial("SN-3", "l1", "2026-10-17 10:00:00")],
    } as unknown as Pick<Sale, "items" | "serials">;

    expect(slipOf(sale, () => milk).sale.items.map((i) => i.serials)).toEqual([["SN-1"], ["SN-2"]]);
  });

  it("names a pack or an option the item no longer has, rather than ring it wrong", () => {
    const sale = { items: [line({ unit_name: "Carton" }), line({ id: "l2", modifiers: [{ group: "Temp", name: "Hot", price_delta: 0 }] })] } as Pick<Sale, "items" | "serials">;

    const slip = slipOf(sale, () => milk);

    expect(slip.sale.items).toEqual([]);
    expect(slip.left).toEqual(["Milk: the Carton is no longer sold.", "Milk: one of its options is no longer offered."]);
  });

  it("leaves an item gone from the shop to the planner, which names it", () => {
    expect(slipOf({ items: [line({})] } as Pick<Sale, "items" | "serials">, () => undefined).sale.items).toHaveLength(1);
  });
});

describe("what changes hands", () => {
  const paid = { carried: [{ method: "cash", amount: 800 }], paid: 800 };

  it("takes the difference on a bigger bill, and hands it back on a smaller one", () => {
    expect(reRingDifference(900, paid, money)).toEqual({ take: 100, back: 0, blocked: null });
    expect(reRingDifference(500, paid, money)).toEqual({ take: 0, back: 300, blocked: null });
    expect(reRingDifference(800, paid, money)).toEqual({ take: 0, back: 0, blocked: null });
  });

  it("hands back no more than was paid in notes", () => {
    const card = { carried: [{ method: "card", amount: 800 }], paid: 800 };
    expect(reRingDifference(900, card, money).blocked).toBeNull();
    expect(reRingDifference(700, card, money).blocked).toMatch(/at least Rs 800/);
    const split = { carried: [{ method: "cash", amount: 300 }, { method: "card", amount: 500 }], paid: 800 };
    expect(reRingDifference(600, split, money).blocked).toBeNull();
    expect(reRingDifference(400, split, money).blocked).toMatch(/at least Rs 500/);
  });
});

const SOURCE = Object.values(
  import.meta.glob("./pages/PosPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;
/** The till's code without its prose, so a comment cannot pass for the rule. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the till re-rings with these rules", () => {
  it("asks the cashier for the difference, and tells the server the whole bill", () => {
    expect(code).toMatch(/const reRingMoney = reRinging === null \? null : reRingDifference\(fullPayable, reRinging, money\);/);
    expect(code).toMatch(/const payable = reRingMoney === null \? fullPayable : reRingMoney\.take;/);
    const call = code.slice(code.indexOf("salesService.reRing("), code.indexOf("salesService.reRing(") + 300);
    expect(call).toMatch(/expected_payable: fullPayable/);
    expect(call).toMatch(/approvalPayload\(reRingApproval, needsReRingApproval\)/);
  });

  it("never queues a re-ring offline as a new sale", () => {
    const offline = code.indexOf("if (!connected) return { data: await ringOffline(");
    const refused = code.indexOf("if (reRinging !== null && !connected) {");
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(offline);
  });

  it("holds Complete while the bill would hand back notes nobody paid, or waits for a PIN", () => {
    expect(code).toMatch(/const reRingHeld = reRingMoney !== null && \(reRingMoney\.blocked !== null \|\| !approvalReady\(reRingApproval, needsReRingApproval\)\);/);
    expect(code).toMatch(/const canCheckout = [^;]*!reRingHeld/);
    expect(code).toMatch(/const needsReRingApproval = !hasPermission\("sales\.void"\);/);
  });

  it("forgets the re-ring when the sale is cleared", () => {
    const clear = code.slice(code.indexOf("const clearSale"), code.indexOf("const clearSale") + 2500);
    expect(clear).toMatch(/setReRinging\(null\)/);
    expect(clear).toMatch(/setReRingApproval\(NO_APPROVAL\)/);
  });
});
