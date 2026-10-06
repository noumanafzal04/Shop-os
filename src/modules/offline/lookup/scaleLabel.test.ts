import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import { resetDbCache } from "../db/open";
import { putMany, putSingleton } from "../db/repo";
import { STORE } from "../db/schema";
import type { CatalogItem } from "../sync/catalogService";
import { findByCode } from "./findByCode";
import fixtures from "./fixtures/scale-labels.json";
import { parseScaleLabel, pluCandidates } from "./scaleLabel";

/**
 * EVERY LABEL THE SERVER WAS ASKED ABOUT, read again by the till with no line.
 *
 * "A code that rings up online and misses offline is a worse bug than having
 * no offline at all." A scale's label was exactly that: online, a kilo and a
 * half of sugar; offline, "Nothing here matches".
 *
 * Nothing below works an answer out. Each expected value is what the real
 * lookup endpoint said (ScaleLabelFixturesTest), and the only question is
 * whether the till's own reading arrives at it.
 */

interface Label {
  name: string;
  settings: Record<string, unknown>;
  code: string;
  expected: { found: boolean; name?: string; quantity?: number | null; mode?: string | null; error_code?: string };
}

const LABELS = (fixtures as unknown as { labels: Label[] }).labels;
const SHELF = (fixtures as unknown as { shelf: Array<{ name: string; plu_code: string; price: number; discount_price: number | null }> }).shelf;

const onTheDevice = async (settings: Record<string, unknown>) => {
  await putMany(
    STORE.CATALOG,
    SHELF.map((row, i) => ({
      id: `p${i}`, sku: null, barcode: null, category_id: null, item_type: "physical_product", unit: "KG",
      sold_by: "weight", wholesale_price: null, price_tiers: null, tax_rate: 0, tax_group_id: null,
      track_inventory: true, stock: 100, offline_ok: true, variants: [], units: [], barcodes: [], modifier_groups: [],
      ...row,
    })) as unknown as CatalogItem[],
  );
  await putSingleton(STORE.SETTINGS, { default_tax_rate: 0, ...settings });
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbCache();
});

describe("the fixtures themselves", () => {
  it("hold both kinds of answer — a file of only hits, or only misses, proves half", () => {
    expect((fixtures as { version: number }).version).toBe(1);
    expect(LABELS.filter((l) => l.expected.found).length).toBeGreaterThanOrEqual(6);
    expect(LABELS.filter((l) => !l.expected.found).length).toBeGreaterThanOrEqual(4);
    expect(LABELS.some((l) => l.expected.mode === "price")).toBe(true);
    expect(LABELS.some((l) => String(l.settings.scale_barcode_prefix).length === 2)).toBe(true);
  });
});

describe("every label the server read, read again with no server", () => {
  it.each(LABELS.map((l) => [l.name, l] as const))("%s", async (_name, label) => {
    await onTheDevice(label.settings);

    const hit = await findByCode(label.code);

    if (!label.expected.found) {
      expect(hit, "the till rang something the server refuses").toBeNull();

      return;
    }

    expect(hit, "the server finds this label's item and the till offline does not").not.toBeNull();
    expect(hit!.item.name).toBe(label.expected.name);
    // To the gram: a line rung offline is repriced by the server on the way
    // up, and a different weight is a different bill.
    expect(hit!.quantity).toBe(label.expected.quantity);
    expect(hit!.variantId).toBeNull();
  });
});

describe("reading the digits", () => {
  const on = { scale_barcode_enabled: true, scale_barcode_prefix: "2", scale_barcode_mode: "weight" };

  it("is off unless the shop switched it on — and absent is not on", () => {
    expect(parseScaleLabel("2000021015000", { ...on, scale_barcode_enabled: false })).toBeNull();
    expect(parseScaleLabel("2000021015000", {})).toBeNull();
    expect(parseScaleLabel("2000021015000", undefined)).toBeNull();
    // A truthy string is not the switch being on.
    expect(parseScaleLabel("2000021015000", { ...on, scale_barcode_enabled: "false" })).toBeNull();
  });

  it("takes the PLU as printed, and offers it with and without its zeroes", () => {
    const label = parseScaleLabel("2000021015000", on)!;

    expect(label.itemCode).toBe("000021");
    expect(pluCandidates(label)).toEqual(["000021", "21"]);
    expect(label.weight).toBe(1.5);
    expect(label.price).toBeNull();
  });

  it("does not take letters, spaces inside, or the wrong length for a label", () => {
    for (const code of ["200002101500", "20000210150000", "2000021O15000", "2000 021015000", ""]) {
      expect(parseScaleLabel(code, on), JSON.stringify(code)).toBeNull();
    }
  });

  it("ignores a stray space around a scanned code", () => {
    expect(parseScaleLabel(" 2000021015000 ", on)?.weight).toBe(1.5);
  });
});

describe("an ordinary barcode is still an ordinary barcode", () => {
  it("is found through the index when scale labels are on and it is not one", async () => {
    await onTheDevice({ scale_barcode_enabled: true, scale_barcode_prefix: "2", scale_barcode_mode: "weight" });
    await putMany(STORE.BARCODE_INDEX, [{ code: "8964000100017", productId: "p0" }] as never);

    const hit = await findByCode("8964000100017");

    expect(hit?.item.name).toBe("Loose Sugar");
    // No weight came off it: the till asks, as it does for anything weighed.
    expect(hit?.quantity).toBeNull();
  });
});
