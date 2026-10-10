import { describe, expect, it } from "vitest";
import { changeLines, settingLines, show } from "./auditChanges";

/**
 * The admin switched one module off and the trail printed the shop's whole
 * module map twice. These hold the trail to saying what moved.
 */

const ALL_ON = { pos: true, products: true, promotions: true, customers: true };
const LABELS = { promotions: "Coupons & Promotions", customers: "Customers & Khata" };

describe("a module switched off", () => {
  it("is one line, naming the module the way the admin's screen does", () => {
    const lines = changeLines("updated", { features: ALL_ON }, { features: { ...ALL_ON, promotions: false } }, LABELS);

    expect(lines).toEqual([{ field: "Coupons & Promotions", from: "on", to: "off" }]);
  });

  it("is one line per module when several move, and none for the ones that did not", () => {
    const lines = changeLines(
      "updated",
      { features: ALL_ON },
      { features: { ...ALL_ON, promotions: false, customers: false } },
      LABELS,
    );

    expect(lines.map((l) => l.field)).toEqual(["Coupons & Promotions", "Customers & Khata"]);
  });

  it("shows a module with no known name as its key rather than dropping it", () => {
    const lines = changeLines("updated", { features: ALL_ON }, { features: { ...ALL_ON, pos: false } }, LABELS);

    expect(lines).toEqual([{ field: "pos", from: "on", to: "off" }]);
  });

  it("names a module that was not in the map before", () => {
    const lines = changeLines("updated", { features: { pos: true } }, { features: { pos: true, fuel: true } });

    expect(lines).toEqual([{ field: "fuel", from: "∅", to: "on" }]);
  });
});

describe("a row filed before the trail recorded maps as maps", () => {
  it("reads a map quoted as JSON text as the map it is", () => {
    // Exactly what the admin's screen was showing: a map, an arrow, a string.
    const lines = changeLines(
      "updated",
      { features: ALL_ON },
      { features: JSON.stringify({ ...ALL_ON, promotions: false }) },
      LABELS,
    );

    expect(lines).toEqual([{ field: "Coupons & Promotions", from: "on", to: "off" }]);
  });

  it("sums up a quoted map on a create", () => {
    expect(changeLines("created", null, { features: JSON.stringify(ALL_ON) })).toEqual([
      { field: "features", to: "4 on, 0 off" },
    ]);
  });

  it("leaves ordinary text that merely starts with a brace alone", () => {
    expect(changeLines("updated", { notes: "a" }, { notes: "{not json" })).toEqual([
      { field: "notes", from: "a", to: "{not json" },
    ]);
  });
});

describe("everything else", () => {
  it("keeps an ordinary field as from → to", () => {
    expect(changeLines("updated", { status: "active" }, { status: "suspended" })).toEqual([
      { field: "status", from: "active", to: "suspended" },
    ]);
  });

  it("has one value and no arrow for a create", () => {
    const lines = changeLines("created", null, { business_name: "Gulberg Mart", features: ALL_ON });

    expect(lines).toEqual([
      { field: "business_name", to: "Gulberg Mart" },
      // Summed up: nobody reads twenty-one keys to learn a shop was created.
      { field: "features", to: "4 on, 0 off" },
    ]);
  });

  it("still files a line for a map recorded as changed with nothing different inside", () => {
    const lines = changeLines("updated", { features: ALL_ON }, { features: { ...ALL_ON } });

    expect(lines).toHaveLength(1);
    expect(lines[0].field).toBe("features");
  });

  it("never shows the record's own id or who-columns", () => {
    expect(changeLines("created", null, { id: "x", created_by: "y", updated_by: "z", name: "A" })).toEqual([
      { field: "name", to: "A" },
    ]);
  });

  it("says nothing is nothing", () => {
    expect(show(null)).toBe("∅");
    expect(show(undefined)).toBe("∅");
    expect(show(0)).toBe("0");
  });
});

/**
 * The add-on price list was emptied on a development database and nothing
 * could say by whom: platform settings were not in the trail. They are, and
 * these hold their rows to reading the way the screens that set them do.
 */
describe("a platform setting's row", () => {
  const MODULES = { products: "Products", bank_offers: "Bank Card Offers" };

  it("a price added to the list is one line: which module, free before, the price now", () => {
    const lines = settingLines(
      "module_addon_prices", "updated",
      { value: { products: 25000 } },
      { value: { products: 25000, bank_offers: 350 } },
      MODULES,
    );

    expect(lines).toEqual([{ field: "Add-on price · Bank Card Offers", from: "free", to: "Rs 350" }]);
  });

  it("a price taken off the list says what it was — the line that could not be found", () => {
    const lines = settingLines("module_addon_prices", "updated", { value: { products: 25000, bank_offers: 350 } }, { value: { bank_offers: 350 } }, MODULES);

    expect(lines).toEqual([{ field: "Add-on price · Products", from: "Rs 25,000", to: "free" }]);
  });

  it("the first price ever set is a row too, and so is a list emptied by being reset", () => {
    expect(settingLines("module_addon_prices", "created", null, { key: "module_addon_prices", value: { products: 25000 } }, MODULES))
      .toEqual([{ field: "Add-on price · Products", from: "free", to: "Rs 25,000" }]);
    expect(settingLines("module_addon_prices", "deleted", { key: "module_addon_prices", value: { products: 25000 } }, null, MODULES))
      .toEqual([{ field: "Add-on price · Products", from: "Rs 25,000", to: "free" }]);
  });

  it("an old row that filed the list as its own JSON text is read as the list", () => {
    const lines = settingLines("module_addon_prices", "updated", { value: { products: 25000 } }, { value: '{"products":26000}' }, MODULES);

    expect(lines).toEqual([{ field: "Add-on price · Products", from: "Rs 25,000", to: "Rs 26,000" }]);
  });

  it("commission is said the way its own screen says it", () => {
    expect(settingLines("commission_enabled", "created", null, { value: true })).toEqual([{ field: "Commission", to: "on" }]);
    expect(settingLines("commission_rate", "updated", { value: 3.5 }, { value: 5 })).toEqual([{ field: "Commission rate", from: "3.5%", to: "5%" }]);
    expect(settingLines("commission_base", "updated", { value: "goods" }, { value: "total" }))
      .toEqual([{ field: "Commission is charged on", from: "the goods only", to: "the whole order" }]);
  });

  it("a setting handed back to its default says so", () => {
    expect(settingLines("console_theme_sidebar", "deleted", { value: "dark" }, null)).toEqual([{ field: "Console menu", from: "dark", to: "back to the default" }]);
    expect(settingLines("console_theme_primary", "updated", { value: "#12b76a" }, { value: null }))
      .toEqual([{ field: "Console colour", from: "#12b76a", to: "the house colour" }]);
  });

  it("a setting nobody has named here is shown under its own key rather than dropped", () => {
    expect(settingLines("something_new", "updated", { value: 1 }, { value: 2 })).toEqual([{ field: "something_new", from: "1", to: "2" }]);
  });
});

