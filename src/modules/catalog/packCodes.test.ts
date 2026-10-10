import { describe, expect, it } from "vitest";

import { blankPack, packPayload, packRowsFrom, pieceCodes } from "./packCodes";

const CARTON = { id: "u-carton", name: "Carton", factor: "24.000", price: "1080.00", barcode: "8961230000028" };

describe("a pack on the item form", () => {
  it("keeps which pack it is, and every code on it", () => {
    const [row] = packRowsFrom([{ ...CARTON, codes: [{ barcode: "STICKER" }, { barcode: "OLD-ART" }] }]);

    expect(row).toEqual({ id: "u-carton", name: "Carton", factor: "24.000", price: "1080.00", barcode: "8961230000028", codes: ["STICKER", "OLD-ART"] });
  });

  it("sends its id back, so the server updates it where it stands", () => {
    const [sent] = packPayload(packRowsFrom([{ ...CARTON, codes: [] }]));

    expect(sent.id).toBe("u-carton");
    expect(sent).toMatchObject({ name: "Carton", factor: 24, price: 1080, barcode: "8961230000028" });
  });

  it("a pack with no codes known to have none says so", () => {
    expect(packPayload(packRowsFrom([{ ...CARTON, codes: [] }]))[0].barcodes).toEqual([]);
  });

  it("a pack whose codes it was NEVER TOLD says nothing about them", () => {
    // An answer without `codes` — an older server, a list that did not load them.
    const rows = packRowsFrom([CARTON]);

    expect(rows[0].codes).toBeUndefined();
    // Not `barcodes: []`: to the server that means take them all off.
    expect("barcodes" in packPayload(rows)[0]).toBe(false);
  });

  it("a new row is known to have none, and has no id to send", () => {
    const sent = packPayload([{ ...blankPack(), name: "Case", factor: "48" }])[0];

    expect(sent).toEqual({ name: "Case", factor: 48, price: null, barcode: null, barcodes: [] });
    expect("id" in sent).toBe(false);
  });

  it("tidies the codes: no blanks, no repeats, not the pack's own first code again", () => {
    const [sent] = packPayload([{ ...CARTON, codes: [" STICKER ", "", "STICKER", "8961230000028", "OLD-ART"] }]);

    expect(sent.barcodes).toEqual(["STICKER", "OLD-ART"]);
  });

  it("a row with no name or no size is not a pack yet", () => {
    expect(packPayload([{ ...blankPack(), name: "", factor: "24" }, { ...blankPack(), name: "Tray", factor: "" }, { ...blankPack(), name: "Tray", factor: "0" }])).toEqual([]);
  });

  it("a blank price is the base price times the size, and a blank barcode is none", () => {
    const [sent] = packPayload([{ ...blankPack(), name: "Strip", factor: "10", price: "", barcode: "  " }]);

    expect(sent.price).toBeNull();
    expect(sent.barcode).toBeNull();
  });
});

describe("the item's own other codes", () => {
  const all = [
    { barcode: "PIECE-OLD-LABEL", variant_id: null, product_unit_id: null },
    { barcode: "ONE-LITRE", variant_id: "v-1l", product_unit_id: null },
    { barcode: "STICKER", variant_id: null, product_unit_id: "u-carton" },
    { barcode: "FROM-AN-OLDER-SERVER" },
  ];

  it("are the ones that mean a single piece", () => {
    expect(pieceCodes(all)).toEqual(["PIECE-OLD-LABEL", "FROM-AN-OLDER-SERVER"]);
  });

  it("never include a size's or a pack's", () => {
    expect(pieceCodes(all)).not.toContain("ONE-LITRE");
    expect(pieceCodes(all)).not.toContain("STICKER");
  });

  it("are none when the item has none", () => {
    expect(pieceCodes(undefined)).toEqual([]);
    expect(pieceCodes(null)).toEqual([]);
  });
});
