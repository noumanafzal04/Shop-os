import { describe, expect, it } from "vitest";

import { tabAskedFor } from "./tabInUrl";

const TABS = ["expenses", "recurring", "budgets", "categories"] as const;

describe("which tab a link asked for", () => {
  it("opens on the tab named in the address", () => {
    expect(tabAskedFor("?tab=recurring", TABS, "expenses")).toBe("recurring");
    expect(tabAskedFor(new URLSearchParams("tab=budgets&x=1"), TABS, "expenses")).toBe("budgets");
  });

  it("opens on the page's first tab when none was named", () => {
    expect(tabAskedFor("", TABS, "expenses")).toBe("expenses");
    expect(tabAskedFor("?page=2", TABS, "expenses")).toBe("expenses");
  });

  it("ignores a tab the page does not have", () => {
    expect(tabAskedFor("?tab=payroll", TABS, "expenses")).toBe("expenses");
    expect(tabAskedFor("?tab=", TABS, "expenses")).toBe("expenses");
    // Another page's key is not this page's.
    expect(tabAskedFor("?tab=entries", TABS, "expenses")).toBe("expenses");
  });
});
