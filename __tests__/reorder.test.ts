import { PROJECT_ROOT, codeOnly, fs, path } from "./support/node";
import { reorderPlan, skippedNote } from "../src/modules/orders/reorder";

/**
 * "ORDER AGAIN" on a finished order (foodpanda's reorder). Plain items go back
 * in the basket; a line that cannot be rebuilt is NAMED, never silently lost.
 */
const plain = {
  product_id: "p1",
  variant_id: null,
  product_unit_id: null,
  product_name: "Daal",
  variant_name: null,
  quantity: 2,
  line_total: "1000.00",
};

describe("what a past order puts back in the basket", () => {
  it("puts a plain item back, at its old unit price", () => {
    const plan = reorderPlan([plain]);
    expect(plan.skipped).toEqual([]);
    expect(plan.lines).toEqual([
      { line: { product_id: "p1", variant_id: null, name: "Daal", unit_price: 500 }, qty: 2 },
    ]);
  });

  it("keeps the size and names the line with it", () => {
    const plan = reorderPlan([{ ...plain, variant_id: "v9", variant_name: "Large", quantity: 1, line_total: "850" }]);
    expect(plan.lines[0].line).toMatchObject({ variant_id: "v9", name: "Daal / Large", unit_price: 850 });
  });

  it("a weighed item stays weighed", () => {
    const plan = reorderPlan([{ ...plain, quantity: "1.250", line_total: "250" }]);
    expect(plan.lines[0]).toMatchObject({ qty: 1.25, line: { sold_by: "weight", unit_price: 200 } });
  });

  it("names what cannot come back: a deleted product, food choices, a pack, a zero line", () => {
    const plan = reorderPlan([
      { ...plain, product_id: null, product_name: "Old soup" },
      { ...plain, product_name: "Zinger", modifiers: [{ group: "Spice", name: "Hot" }] },
      { ...plain, product_name: "Panadol", product_unit_id: "u1" },
      { ...plain, product_name: "Ghost", quantity: 0 },
      plain,
    ]);
    expect(plan.lines.map((l) => l.line.name)).toEqual(["Daal"]);
    expect(plan.skipped).toEqual(["Old soup", "Zinger", "Panadol", "Ghost"]);
  });

  it("says which to choose again, briefly", () => {
    expect(skippedNote([])).toBeNull();
    expect(skippedNote(["Zinger"])).toBe("Choose Zinger again on the shop page — options aren't carried over.");
    expect(skippedNote(["A", "B", "C", "D"])).toMatch(/^Choose A, B and 2 more again/);
  });
});

describe("the orders list offers it", () => {
  const screen = codeOnly(
    fs.readFileSync(path.join(PROJECT_ROOT, "src/modules/orders/screens/OrdersScreen.tsx"), "utf8"),
  );

  it("asks before replacing another shop's basket, then opens the basket", () => {
    expect(screen).toMatch(/cart\.wouldReplace\(slug\)/);
    expect(screen).toMatch(/confirm\.ask\(/);
    expect(screen).toMatch(/navigation\.navigate\("CartTab"\)/);
  });

  it("shows the shop's logo and an Order again button on a finished order", () => {
    expect(screen).toMatch(/uri=\{order\.shop\?\.logo_url \?\? null\}/);
    expect(screen).toMatch(/onPress=\{onAgain\}/);
  });
});
