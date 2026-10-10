import { describe, expect, it } from "vitest";

import { indexEntriesFor } from "./barcodeIndex";
import type { CatalogItem } from "./catalogService";

/**
 * What a scan lands on with no server to ask.
 *
 * The online lookup and this index have to agree, code for code: a carton's
 * second barcode that rings a carton at a till with a connection and a single
 * piece at one without is worse than a code that does not work at all, because
 * nobody at the counter can see why the money is wrong.
 */
const biscuits = (over: Partial<CatalogItem> = {}): CatalogItem =>
  ({
    id: "p-biscuits",
    name: "Butter Biscuits",
    sku: "BIS-1",
    barcode: "8961230000011",
    plu_code: null,
    variants: [],
    units: [{ id: "u-carton", name: "Carton", factor: 24, price: 1080, barcode: "8961230000028" }],
    barcodes: [],
    ...over,
  }) as CatalogItem;

const landing = (item: CatalogItem, code: string) => indexEntriesFor(item).find((e) => e.code === code);

describe("what a scan lands on, offline", () => {
  it("any OTHER code printed on a carton is the carton", () => {
    const item = biscuits({
      codes: [
        { code: "STICKER", variant_id: null, unit_id: "u-carton" },
        { code: "OLD-ART", variant_id: null, unit_id: "u-carton" },
      ],
    });

    for (const code of ["8961230000028", "STICKER", "OLD-ART"]) {
      expect(landing(item, code), code).toEqual({ code, productId: "p-biscuits", unitId: "u-carton" });
    }
  });

  it("the item's own barcode and its plain other codes are one piece", () => {
    const item = biscuits({ barcodes: ["PIECE-OLD-LABEL"], codes: [{ code: "STICKER", variant_id: null, unit_id: "u-carton" }] });

    expect(landing(item, "8961230000011")).toEqual({ code: "8961230000011", productId: "p-biscuits" });
    expect(landing(item, "PIECE-OLD-LABEL")).toEqual({ code: "PIECE-OLD-LABEL", productId: "p-biscuits" });
  });

  it("a size's own code is that size — though the plain list repeats it", () => {
    // The plain list still carries a size's code, for a till built before
    // `codes` existed. Read second, it would land on the drink and ask.
    const cola = biscuits({
      id: "p-cola",
      units: [],
      variants: [{ id: "v-1l", name: "1 Litre", sku: "COLA-1L" }, { id: "v-500", name: "500 ml", sku: "COLA-500" }] as CatalogItem["variants"],
      barcodes: ["EAN-1L", "EAN-500"],
      codes: [
        { code: "EAN-1L", variant_id: "v-1l", unit_id: null },
        { code: "EAN-500", variant_id: "v-500", unit_id: null },
      ],
    });

    expect(landing(cola, "EAN-1L")).toEqual({ code: "EAN-1L", productId: "p-cola", variantId: "v-1l" });
    expect(landing(cola, "EAN-500")).toEqual({ code: "EAN-500", productId: "p-cola", variantId: "v-500" });
    // One entry a code, not two.
    expect(indexEntriesFor(cola).filter((e) => e.code === "EAN-1L")).toHaveLength(1);
  });

  it("the plainest reading still wins: the item's own barcode is never a pack's", () => {
    const item = biscuits({ codes: [{ code: "8961230000011", variant_id: null, unit_id: "u-carton" }] });

    expect(landing(item, "8961230000011")).toEqual({ code: "8961230000011", productId: "p-biscuits" });
  });

  it("a row cached before `codes` existed still indexes everything it has", () => {
    const old = biscuits({ barcodes: ["PIECE-OLD-LABEL"] });
    delete (old as { codes?: unknown }).codes;

    expect(indexEntriesFor(old).map((e) => e.code).sort()).toEqual(["8961230000011", "8961230000028", "BIS-1", "PIECE-OLD-LABEL"].sort());
  });

  it("blank codes are nobody's", () => {
    const item = biscuits({ codes: [{ code: "  ", variant_id: null, unit_id: "u-carton" }], barcodes: [""] });

    expect(indexEntriesFor(item).map((e) => e.code).sort()).toEqual(["8961230000011", "8961230000028", "BIS-1"].sort());
  });
});
