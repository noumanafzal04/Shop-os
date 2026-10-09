import { describe, expect, it } from "vitest";

import { labelPrefs, toSettings } from "./prefs";

describe("what a label carries, as the shop saved it", () => {
  it("a shop that has never set anything prints as labels always have", () => {
    expect(labelPrefs(undefined)).toEqual({
      name: true, price: true, digits: true, shop: false, pack: false, cut: true, stock: "50x25", paper: "sheet",
    });
  });

  it("reads back what was saved", () => {
    const saved = labelPrefs({
      barcode_show_name: false, barcode_show_price: false, label_show_digits: false, label_show_shop: true,
      label_show_pack: true, label_cut_lines: false, label_stock: "100x50", label_paper: "roll",
    });

    expect(saved).toEqual({
      name: false, price: false, digits: false, shop: true, pack: true, cut: false, stock: "100x50", paper: "roll",
    });
  });

  it("a sticker size nobody makes falls back to the standard one", () => {
    expect(labelPrefs({ label_stock: "70x40" }).stock).toBe("50x25");
  });

  it("a change is saved as the one setting it is, and nothing beside it", () => {
    expect(toSettings({ price: false })).toEqual({ barcode_show_price: false });
    expect(toSettings({ stock: "38x25", paper: "roll" })).toEqual({ label_stock: "38x25", label_paper: "roll" });
    expect(toSettings({ shop: true, cut: false })).toEqual({ label_show_shop: true, label_cut_lines: false });
  });

  it("every choice has somewhere it is kept", () => {
    const all = toSettings({ name: true, price: true, digits: true, shop: true, pack: true, cut: true, stock: "50x25", paper: "sheet" });

    expect(Object.keys(all)).toHaveLength(8);
    expect(Object.keys(all)).not.toContain("undefined");
  });
});
