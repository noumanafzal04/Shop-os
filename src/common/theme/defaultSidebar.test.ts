import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { applyTenantTheme, DEFAULT_SIDEBAR, SIDEBAR_CHOICES } from "./tenantTheme";

/**
 * THE MENU IS IN THE SHOP'S OWN COLOUR UNLESS SOMEBODY SAYS OTHERWISE.
 *
 *     "Default sidebar and theme color primary rakhna hai. Admin side par
 *      sidebar color primary — admin ko humne appearance ka option nahi dia.
 *      Demo create ho to sidebar primary. Appearance canvas mein default
 *      sidebar primary, start mein; second mein white, aur baki."
 *
 * "What the sidebar is by default" was written in five panel files and one on
 * the server, each saying "light". A default changed in four of six places is
 * a shop whose menu is one colour for a second and another after — and the
 * platform console, which has no Appearance at all, is drawn ENTIRELY from the
 * fallback. So this holds the constant, and then goes and reads the files.
 */

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

afterEach(() => applyTenantTheme({}));

describe("the default", () => {
  it("is the brand colour", () => {
    expect(DEFAULT_SIDEBAR).toBe("primary");
  });

  it("is what a page with nothing chosen is given", () => {
    applyTenantTheme({ sidebar: "dark" });
    applyTenantTheme({});

    expect(document.documentElement.dataset.sidebar).toBe("primary");
  });

  it("gives way to a shop's own choice — white is still white", () => {
    applyTenantTheme({ sidebar: "light" });

    expect(document.documentElement.dataset.sidebar).toBe("light");
  });
});

describe("the Appearance canvas", () => {
  it("offers Primary first, White second, then the rest", () => {
    expect(SIDEBAR_CHOICES.map((c) => c.value)).toEqual(["primary", "light", "tinted", "dark"]);
    expect(SIDEBAR_CHOICES.map((c) => c.label)).toEqual(["Primary", "White", "Tinted", "Dark"]);
  });

  it("puts the default at the head of its own list", () => {
    expect(SIDEBAR_CHOICES[0].value).toBe(DEFAULT_SIDEBAR);
  });

  it("draws its choices from that list, and starts and resets on the default", () => {
    const canvas = read("src/components/theme/ThemeCustomizer.tsx");

    expect(canvas).toContain("SIDEBAR_CHOICES.map(");
    expect(canvas).toContain("useState<SidebarStyle>(DEFAULT_SIDEBAR)");
    expect(canvas).toContain("setSidebar(DEFAULT_SIDEBAR)");
  });
});

describe("nobody keeps a default of their own", () => {
  // The five places it was written. Each must ask the constant — a literal
  // here is the platform console (or a shop mid-load) in the old colour.
  it.each([
    ["the rail itself — all the platform console ever gets", "src/layout/AppSidebar.tsx"],
    ["the shop's theme hook", "src/modules/shop/hooks/useShop.ts"],
    ["the Appearance canvas", "src/components/theme/ThemeCustomizer.tsx"],
    ["the theme itself", "src/common/theme/tenantTheme.ts"],
  ])("%s", (_what, file) => {
    const source = read(file);

    expect(source, `${file} does not use the shared default`).toContain("DEFAULT_SIDEBAR");
    // `?? "light"` / `= "light"` beside a sidebar is the old default, kept.
    // (The TYPE names "light" first, and that is a list of what exists, not
    // a default — the detector's first run flagged it.)
    const stale = source.split("\n").filter((line) =>
      /sidebar/i.test(line) && /(\?\?|=)\s*"light"/.test(line)
      && !/value:\s*"light"/.test(line) && !/^\s*export type /.test(line));
    expect(stale, `${file} still falls back to a white sidebar`).toEqual([]);
  });

  it("and the server's default is the same one", () => {
    const server = fs.readFileSync(path.resolve(__dirname, "../../../../backend/app/Support/ShopSettings.php"), "utf8");
    const found = /'theme_sidebar'\s*=>\s*'([a-z]+)'/.exec(server);

    // THE DENOMINATOR: a renamed key would make the next line compare undefined.
    expect(found, "ShopSettings no longer names a theme_sidebar default").not.toBeNull();
    expect(found![1]).toBe(DEFAULT_SIDEBAR);
  });
});
