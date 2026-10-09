import { describe, expect, it } from "vitest";

import { refusalsOutOfSight, tabOfField, tabsFor } from "./formTabs";

describe("the tabs follow the shop and the item", () => {
  it("offers Online only to a shop that sells online", () => {
    const item = { sizes: true, addOns: false, service: false };

    expect(tabsFor({ ...item, online: false })).toEqual(["details", "options", "advanced"]);
    expect(tabsFor({ ...item, online: true })).toEqual(["details", "online", "options", "advanced"]);
  });

  it("gives a service no codes and packs", () => {
    expect(tabsFor({ online: false, sizes: true, addOns: false, service: true })).toEqual(["details", "options"]);
  });

  it("keeps Sizes & options for a dish with add-ons and no sizes", () => {
    expect(tabsFor({ online: false, sizes: false, addOns: true, service: false })).toContain("options");
    expect(tabsFor({ online: false, sizes: false, addOns: false, service: false })).not.toContain("options");
  });
});

describe("a field is on one tab", () => {
  it("finds a nested field by its first word", () => {
    expect(tabOfField("units.0.factor")).toBe("advanced");
    expect(tabOfField("barcodes.2")).toBe("advanced");
    expect(tabOfField("variants.1.price")).toBe("options");
    expect(tabOfField("min_order_qty")).toBe("online");
  });

  it("puts anything it has not heard of on Details", () => {
    expect(tabOfField("price")).toBe("details");
    expect(tabOfField("expiry_date")).toBe("details");
    expect(tabOfField("something_new")).toBe("details");
  });
});

describe("a refusal nobody is looking at is said at the top", () => {
  const all = ["details", "online", "options", "advanced"] as const;
  const taken = { barcode: ["The barcode has already been taken."] };

  it("names the tab when the field is on another one", () => {
    expect(refusalsOutOfSight(taken, "details", [...all])).toEqual([
      { on: "advanced", message: "The barcode has already been taken." },
    ]);
  });

  it("says nothing twice: on its own tab the field already says it", () => {
    expect(refusalsOutOfSight(taken, "advanced", [...all])).toEqual([]);
  });

  it("still says it when the field has nowhere of its own to say it", () => {
    // Sale price draws no message beside itself, so on its own tab this is the
    // only place the sentence can appear.
    const refused = { discount_price: ["The sale price must be less than the price."] };

    expect(refusalsOutOfSight(refused, "details", [...all])).toEqual([
      { on: undefined, message: "The sale price must be less than the price." },
    ]);
    // …and a nested pack field is not the `units` line the form draws.
    expect(refusalsOutOfSight({ "units.0.factor": ["A pack must hold more than one."] }, "advanced", [...all])).toHaveLength(1);
  });

  it("does not send anybody to a tab this form does not have", () => {
    // A service has no Codes & packs: the message is shown, with no tab to go to.
    expect(refusalsOutOfSight({ sku: ["The SKU has already been taken."] }, "details", ["details", "options"])).toEqual([
      { on: undefined, message: "The SKU has already been taken." },
    ]);
  });

  it("lists one sentence once", () => {
    const twice = { "barcodes.0": ["That barcode is on another item."], "barcodes.1": ["That barcode is on another item."] };

    expect(refusalsOutOfSight(twice, "details", [...all])).toHaveLength(1);
  });
});
