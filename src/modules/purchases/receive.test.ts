import { describe, expect, it } from "vitest";
import { checkNumbers, keepsLots, needsDetails, needsExpiry, overDue, parseSerials } from "./receive";

describe("the numbers written down when goods arrive", () => {
  it("reads one number per line, or per comma, and ignores the gaps", () => {
    expect(parseSerials(" A1 \n\nB2,  C3 ,\n")).toEqual(["A1", "B2", "C3"]);
  });

  it("five numbers for five boxes can be sent", () => {
    expect(checkNumbers("A\nB\nC\nD\nE", 5)).toEqual({ count: 5, tooMany: false, repeated: null, unnumbered: 0, ok: true });
  });

  it("six numbers for five boxes cannot", () => {
    const six = checkNumbers("A\nB\nC\nD\nE\nF", 5);
    expect(six.tooMany).toBe(true);
    expect(six.ok).toBe(false);
    // Nothing is "unnumbered" when there are too many: one fault is said, not two.
    expect(six.unnumbered).toBe(0);
  });

  it("names the number that was scanned twice", () => {
    const twice = checkNumbers("A\nB\nA\nB", 5);
    expect(twice.repeated).toBe("A");
    expect(twice.ok).toBe(false);
  });

  it("three numbers for five boxes can be sent — and says two will have none", () => {
    const short = checkNumbers("A\nB\nC", 5);
    expect(short.ok).toBe(true);
    expect(short.unnumbered).toBe(2);
  });

  it("none at all is every box unnumbered", () => {
    expect(checkNumbers("", 5)).toMatchObject({ count: 0, unnumbered: 5, ok: true });
  });

  it("a quantity that is not a number is no boxes", () => {
    expect(checkNumbers("A", Number.NaN)).toMatchObject({ tooMany: true, ok: false });
    expect(checkNumbers("", Number.NaN)).toMatchObject({ unnumbered: 0, ok: true });
  });
});

describe("an order that has to be received on the sheet that asks", () => {
  const line = (over: object = {}) => ({ quantity_ordered: 5, quantity_received: 0, product: { tracks_serial: false, item_type: "physical_product" }, ...over });

  it("is not one of plain goods", () => {
    expect(needsDetails([line(), line()])).toBe(false);
  });

  it("is one with a phone still to arrive", () => {
    expect(needsDetails([line(), line({ product: { tracks_serial: true, item_type: "physical_product" } })])).toBe(true);
  });

  it("is one with a medicine still to arrive", () => {
    expect(needsDetails([line({ product: { tracks_serial: false, item_type: "medicine" } })])).toBe(true);
  });

  it("is not one whose phones have all arrived", () => {
    expect(needsDetails([line({ quantity_ordered: "5.000", quantity_received: "5.000", product: { tracks_serial: true, item_type: "physical_product" } }), line()])).toBe(false);
  });

  it("is not one whose product is gone", () => {
    expect(needsDetails([line({ product: null })])).toBe(false);
  });
});

describe("a medicine is received with its expiry (tester pass 5, B61)", () => {
  it("holds a medicine line being received with no expiry", () => {
    expect(needsExpiry("medicine", 4, "")).toBe(true);
    expect(needsExpiry("medicine", 4, "  ")).toBe(true);
  });

  it("lets it go once dated, or when none of it is coming this time", () => {
    expect(needsExpiry("medicine", 4, "2026-11-20")).toBe(false);
    expect(needsExpiry("medicine", 0, "")).toBe(false);
  });

  it("asks nothing of anything that is not a medicine", () => {
    expect(needsExpiry("physical_product", 4, "")).toBe(false);
    expect(needsExpiry(undefined, 4, "")).toBe(false);
  });
});

/**
 * A MART'S DATED GOODS ARRIVE WITH THEIR DATE (mart #MT2).
 *
 * PO-000001 brought 40 yogurt in as `PO-000001 · expires —`: the date boxes
 * were drawn for a medicine only, and the expiring list never heard of them.
 */
const SHEET = Object.values(
  import.meta.glob("./pages/PurchaseOrdersPage.tsx", { query: "?raw", import: "default", eager: true }),
)[0] as string;

describe("a good that goes off is received with its date", () => {
  it("offers a batch and an expiry for a medicine and for any good", () => {
    expect(keepsLots("medicine")).toBe(true);
    expect(keepsLots("physical_product")).toBe(true);
  });

  it("not for a service, a dish or a deal — nothing of theirs sits on a shelf in lots", () => {
    for (const t of ["service", "food_item", "deal", undefined]) expect(keepsLots(t), String(t)).toBe(false);
  });

  it("is what the receive sheet draws its date boxes from", () => {
    expect(SHEET).toMatch(/const dated = keepsLots\(it\.product\?\.item_type\);/);
    expect(SHEET).toMatch(/\{dated && \(\s*<div[^>]*data-receive-lot>/);
  });

  it("still holds only a medicine without one", () => {
    expect(needsExpiry("physical_product", 40, "")).toBe(false);
  });
});

describe("more than is due (#PH1)", () => {
  it("is said, and the press held, instead of the extra being dropped", () => {
    expect(overDue(3, 2)).toMatch(/^Only 2 are still due on this order\. A free one from the supplier\?/);
    expect(overDue(2, 1)).toMatch(/^Only 1 is still due/);
  });

  it("says nothing when it fits", () => {
    expect(overDue(2, 2)).toBeNull();
    expect(overDue(0, 2)).toBeNull();
  });
});
