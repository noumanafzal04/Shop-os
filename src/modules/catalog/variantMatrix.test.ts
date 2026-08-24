import { describe, expect, it } from "vitest";

import {
  axesFromRows,
  combinations,
  fillAll,
  labelFor,
  regenerate,
  toPayload,
  usableAxes,
  whatIsMissing,
  type MatrixRow,
} from "./variantMatrix";

/**
 * The generator behind the size grid.
 *
 * Tested on its own because this is the part that can be wrong in a way nobody
 * notices. A dropped combination, a row renamed out from under a price somebody
 * typed, a stock figure quietly lost on regeneration — each produces a catalogue
 * that looks finished and is not, and a shop finds out at the till.
 */

const row = (name: string, over: Partial<MatrixRow> = {}): MatrixRow => ({ name, price: 100, ...over });

describe("naming the axes", () => {
  it("ignores an axis with no name or no values", () => {
    expect(
      usableAxes([
        { name: "Colour", values: ["Red"] },
        { name: "", values: ["S"] },
        { name: "Size", values: [] },
      ]).map((a) => a.name),
    ).toEqual(["Colour"]);
  });

  it("trims and de-duplicates values, case-insensitively", () => {
    // A shop typing "Red" and "red" means one colour. Two rows differing only in
    // case are two rows nobody can tell apart on a receipt.
    expect(usableAxes([{ name: "Colour", values: [" Red ", "red", "Blue", "", "Blue"] }])[0].values)
      .toEqual(["Red", "Blue"]);
  });
});

describe("the combinations", () => {
  it("makes one row per value on a single axis — the pizza and the drink", () => {
    expect(combinations([{ name: "Size", values: ["Small", "Medium", "Large"] }]).map(labelFor))
      .toEqual(["Small", "Medium", "Large"]);
  });

  it("crosses two axes — the shirt", () => {
    expect(
      combinations([
        { name: "Colour", values: ["Red", "Blue"] },
        { name: "Size", values: ["S", "M", "L"] },
      ]).map(labelFor),
    ).toEqual(["Red / S", "Red / M", "Red / L", "Blue / S", "Blue / M", "Blue / L"]);
  });

  it("moves the FIRST axis slowest, so a colour's sizes stay together", () => {
    // Reversed, the list reads S/Red, S/Blue, M/Red… and a colour's sizes end up
    // scattered down twelve rows. A rail is arranged by colour and so is this.
    const names = combinations([
      { name: "Colour", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
    ]).map(labelFor);

    expect(names.slice(0, 2)).toEqual(["Red / S", "Red / M"]);
  });

  it("crosses three axes without complaint", () => {
    expect(combinations([
      { name: "Colour", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
      { name: "Fit", values: ["Slim", "Regular"] },
    ])).toHaveLength(8);
  });

  it("produces nothing from nothing", () => {
    expect(combinations([])).toEqual([]);
    expect(combinations([{ name: "Colour", values: [] }])).toEqual([]);
  });
});

describe("regenerating keeps what the shop already typed", () => {
  it("keeps the price, cost, sku, stock and id of a row that still exists", () => {
    // THE load-bearing case. A shop prices six rows, then remembers Black — and
    // every price already entered has to survive.
    const existing = [
      row("Red / S", { id: "v1", price: 1200, cost: 700, sku: "TS-R-S", stock_quantity: 9 }),
      row("Red / M", { id: "v2", price: 1300 }),
    ];

    const after = regenerate(
      [{ name: "Colour", values: ["Red", "Black"] }, { name: "Size", values: ["S", "M"] }],
      existing,
      999,
    );

    const kept = after.find((r) => r.name === "Red / S")!;
    expect(kept.id).toBe("v1");
    expect(kept.price).toBe(1200);
    expect(kept.cost).toBe(700);
    expect(kept.sku).toBe("TS-R-S");
    expect(kept.stock_quantity).toBe(9);
  });

  it("gives a brand-new combination the fallback price and nothing else", () => {
    const after = regenerate(
      [{ name: "Colour", values: ["Red", "Black"] }, { name: "Size", values: ["S"] }],
      [row("Red / S", { id: "v1", price: 1200, sku: "TS-R-S" })],
      999,
    );

    const fresh = after.find((r) => r.name === "Black / S")!;
    expect(fresh.price).toBe(999);
    expect(fresh.id).toBeUndefined();
    expect(fresh.sku).toBeUndefined();
  });

  it("drops a combination that is no longer produced", () => {
    // Dropped from the LIST, which the server reads as "retire it" — never as
    // "destroy it". Five tables cascade off a variant, including the whole stock
    // audit trail.
    const after = regenerate(
      [{ name: "Size", values: ["S"] }],
      [row("S", { id: "v1" }), row("M", { id: "v2" })],
    );

    expect(after.map((r) => r.name)).toEqual(["S"]);
  });

  it("matches case-insensitively, so re-typing a value does not reprice a row", () => {
    const after = regenerate([{ name: "Size", values: ["small"] }], [row("Small", { id: "v1", price: 650 })]);

    expect(after[0].id).toBe("v1");
    expect(after[0].price).toBe(650);
    // The label follows what was typed most recently.
    expect(after[0].name).toBe("small");
  });
});

describe("reopening a grid that was never recorded as one", () => {
  it("recovers two axes from rows made before axes were kept", () => {
    const axes = axesFromRows(
      [row("Red / S"), row("Red / M"), row("Blue / S"), row("Blue / M")],
      ["Colour", "Size"],
    );

    expect(axes).toEqual([
      { name: "Colour", values: ["Red", "Blue"] },
      { name: "Size", values: ["S", "M"] },
    ]);
  });

  it("refuses when the rows are not a full grid", () => {
    // Three rows across 2 × 2 means the shop deleted one. Rebuilding the grid
    // would silently put it back, so this hands back null and the caller shows a
    // flat list — the honest fallback.
    expect(axesFromRows([row("Red / S"), row("Red / M"), row("Blue / S")], ["Colour", "Size"])).toBeNull();
  });

  it("refuses when the rows do not agree on how many segments they have", () => {
    // "Red / S" and "Large" is not a matrix, and pretending otherwise invents an
    // axis the shop never had.
    expect(axesFromRows([row("Red / S"), row("Large")])).toBeNull();
  });

  it("refuses a single row, which is not evidence of a grid", () => {
    expect(axesFromRows([row("Large")])).toBeNull();
  });
});

describe("setting one value on every size", () => {
  it("writes the price into every row and leaves everything else alone", () => {
    const after = fillAll([row("S", { id: "v1", sku: "A" }), row("M", { sku: "B" })], "price", 750);

    expect(after.map((r) => r.price)).toEqual([750, 750]);
    expect(after.map((r) => r.sku)).toEqual(["A", "B"]);
    expect(after[0].id).toBe("v1");
  });
});

describe("what the shop still has to answer", () => {
  it("says nothing when there are no sizes at all", () => {
    expect(whatIsMissing([])).toBeNull();
  });

  it("counts the unpriced sizes rather than just refusing", () => {
    // The server requires a price and answers 422, and the form never rendered
    // `variants.*.price` — so a blank price produced a save that appeared to do
    // nothing at all. A count is something a shop can act on.
    expect(whatIsMissing([row("S", { price: 100 }), row("M", { price: "" })]))
      .toBe("1 of 2 sizes still need a price.");
  });

  it("speaks plainly when none of them are priced", () => {
    expect(whatIsMissing([row("S", { price: "" }), row("M", { price: "" })]))
      .toBe("Give these a price — every size needs one.");
  });

  it("catches two sizes with the same name", () => {
    // The server's `distinct` catches exact repeats only, so "Red / S" and
    // "Red/S" both reach production and a cashier cannot tell them apart.
    expect(whatIsMissing([row("Red / S"), row("red / s")])).toMatch(/both called/);
  });

  it("passes a complete grid", () => {
    expect(whatIsMissing([row("S", { price: 100 }), row("M", { price: 200 })])).toBeNull();
  });
});

describe("the payload", () => {
  it("sends an id for an existing row and stock only for a new one", () => {
    // Stock has ONE write path (InventoryService) so every unit lands in
    // stock_movements. An edit that could set a quantity would be a second,
    // silent door onto the shelf.
    const [existing, fresh] = toPayload([
      row("S", { id: "v1", stock_quantity: 5 }),
      row("M", { stock_quantity: 7 }),
    ]);

    expect(existing).toMatchObject({ id: "v1" });
    expect("stock_quantity" in existing).toBe(false);
    expect(fresh).toMatchObject({ stock_quantity: 7 });
    expect("id" in fresh).toBe(false);
  });

  it("drops a blank sku and a blank cost rather than sending empty strings", () => {
    const [only] = toPayload([row("S", { sku: "  ", cost: "" })]);

    expect(only.sku).toBeUndefined();
    expect(only.cost).toBeUndefined();
  });

  it("sends is_active only when a size has been switched off", () => {
    const [on, off] = toPayload([row("S"), row("M", { is_active: false })]);

    expect("is_active" in on).toBe(false);
    expect(off.is_active).toBe(false);
  });
});


describe("a size's own barcode travels with it", () => {
  it("is sent even when blank, so clearing the box clears the code", () => {
    // The server reads a present-but-empty `barcode` as "this packet no longer
    // carries that code". Dropping the key on empty would make the old one
    // permanent — the shop empties the field, saves, and nothing happens.
    const [cleared] = toPayload([{ name: "500ml", price: 80, barcode: "" }]);
    expect(cleared).toHaveProperty("barcode", "");

    const [set] = toPayload([{ name: "1L", price: 140, barcode: " 8961000000022 " }]);
    expect(set.barcode, "a scanned code is not trimmed before it is stored").toBe("8961000000022");
  });

  it("is left out entirely when the row never had one", () => {
    // Absent is not the same as blank. A row that never carried the key must
    // not tell the server to delete a code somebody set elsewhere.
    const [row] = toPayload([{ name: "M", price: 100 }]);
    expect("barcode" in row).toBe(false);
  });

  it("survives a regeneration that keeps the row", () => {
    // Rows are matched by NAME across a regeneration, and everything already
    // typed has to come back — a shop that adds a third colour must not lose
    // the barcodes it typed for the first two.
    const kept = regenerate(
      [{ name: "Size", values: ["S", "M"] }],
      [{ name: "S", price: 100, barcode: "111" }],
    );

    expect(kept.find((r) => r.name === "S")?.barcode).toBe("111");
    expect(kept.find((r) => r.name === "M")?.barcode).toBeUndefined();
  });
});
