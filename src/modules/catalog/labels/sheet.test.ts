import { describe, expect, it } from "vitest";

import { perSheet, printables, sheets, STOCKS } from "./sheet";
import type { Product } from "../types";

describe("how many stickers a sheet takes", () => {
  it("the standard sticker: three across, ten down", () => {
    // 194 mm of paper between the margins, 50 mm stickers with 2 mm between.
    expect(perSheet(STOCKS["50x25"])).toEqual({ cols: 3, rows: 10, count: 30 });
  });

  it("the small one fits four across", () => {
    expect(perSheet(STOCKS["38x25"])).toEqual({ cols: 4, rows: 10, count: 40 });
  });

  it("a shelf tag is one across and five down", () => {
    expect(perSheet(STOCKS["100x50"])).toEqual({ cols: 1, rows: 5, count: 5 });
  });

  it("a gap is between stickers, not after the last one", () => {
    // Three 64 mm stickers need 192 + 2 gaps = 196 mm: more than the 194 there is.
    expect(perSheet({ w: 64, h: 25 }).cols).toBe(2);
    // …and three of 63.3 mm need 189.9 + 4 = 193.9: they fit.
    expect(perSheet({ w: 63.3, h: 25 }).cols).toBe(3);
  });

  it("a sticker bigger than the sheet is still one a sheet, not none", () => {
    expect(perSheet({ w: 400, h: 400 }).count).toBe(1);
  });
});

describe("a run, cut into sheets", () => {
  const run = Array.from({ length: 73 }, (_, i) => i + 1);

  it("73 labels at 30 a sheet is three sheets, the last part-full", () => {
    const pages = sheets(run, 30);

    expect(pages.map((p) => p.length)).toEqual([30, 30, 13]);
    expect(pages[1][0]).toBe(31);
    expect(pages[2][12]).toBe(73);
  });

  it("stickers already used come off the FIRST sheet only", () => {
    const pages = sheets(run, 30, 4);

    expect(pages[0].slice(0, 5)).toEqual([null, null, null, null, 1]);
    expect(pages[0].filter((l) => l !== null)).toHaveLength(26);
    expect(pages[1].every((l) => l !== null)).toBe(true);
    // 4 places lost on sheet one push the tail onto a sheet it would not have needed.
    expect(sheets(Array.from({ length: 60 }, (_, i) => i), 30, 4).map((p) => p.length)).toEqual([30, 30, 4]);
  });

  it("nothing to print is no sheets — not one blank one", () => {
    expect(sheets([], 30, 4)).toEqual([]);
  });

  it("a whole sheet cannot be skipped", () => {
    // Skipping every place would print a blank sheet and call it page one.
    expect(sheets([1, 2], 30, 99)[0].filter((l) => l === null)).toHaveLength(29);
  });
});

describe("what there is to print for a product", () => {
  const biscuit = {
    id: "p1", name: "Super Biscuit 100g", barcode: "8961234567890", price: "50", discount_price: null, sold_by: "unit", unit: "Piece",
    variants: [], barcodes: [],
    units: [
      { id: "u1", name: "Carton", factor: "24", price: "1080", barcode: "890000000002" },
      { id: "u2", name: "Pack", factor: "12", price: null, barcode: "890000000001" },
      { id: "u3", name: "Tray", factor: "6", price: "280", barcode: null },
    ],
  } as unknown as Product;

  it("a carton is its own sticker, with the carton's barcode and the carton's price", () => {
    const carton = printables(biscuit).find((l) => l.part === "Carton of 24")!;

    expect(carton.barcode).toBe("890000000002");
    expect(carton.price).toBe(1080);
    expect(carton.name).toBe("Super Biscuit 100g Carton of 24");
  });

  it("a pack with no price of its own is its pieces at the piece price", () => {
    expect(printables(biscuit).find((l) => l.part === "Pack of 12")!.price).toBe(600);
  });

  it("a pack with no barcode has nothing to print", () => {
    expect(printables(biscuit).map((l) => l.part)).toEqual([null, "Carton of 24", "Pack of 12"]);
  });

  it("a size is printed under its own barcode and its own price", () => {
    const shirt = {
      id: "p2", name: "T-Shirt", barcode: null, price: "900", sold_by: "unit",
      variants: [{ id: "v1", name: "Small", price: "900", is_active: true }, { id: "v2", name: "Large", price: "1000", is_active: true }],
      barcodes: [{ id: "b1", barcode: "111", variant_id: "v1" }, { id: "b2", barcode: "222", variant_id: "v2" }],
      units: [],
    } as unknown as Product;

    // No barcode on the shirt itself, so there is no sticker for "T-Shirt".
    expect(printables(shirt).map((l) => [l.name, l.barcode, l.price])).toEqual([
      ["T-Shirt Small", "111", 900],
      ["T-Shirt Large", "222", 1000],
    ]);
  });

  it("an item on sale is priced at the sale price, and says what it was", () => {
    const soap = { id: "p3", name: "Soap", barcode: "333", price: "120", discount_price: "99", sold_by: "unit", variants: [], barcodes: [], units: [] } as unknown as Product;

    expect(printables(soap)[0]).toMatchObject({ price: 99, was: 120 });
  });

  it("something sold loose says per what", () => {
    const sugar = { id: "p4", name: "Sugar", barcode: "444", price: "180", sold_by: "weight", unit: "KG", variants: [], barcodes: [], units: [] } as unknown as Product;

    expect(printables(sugar)[0].perUnit).toBe("/KG");
  });
});
