import { describe, expect, it } from "vitest";
import { categoryMenu, menuLabel } from "./categoryMenu";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Next rounds #22: online the till's category menu offered five rows, offline
 * six — the sub-category was in the flat offline list and inside the tree's
 * `children` online, where nothing looked.
 */
const tree = [
  { id: "g", name: "General", parent_id: null },
  {
    id: "hk", name: "QA Home & Kitchen", parent_id: null,
    children: [{ id: "cw", name: "QA Cookware", parent_id: "hk", children: [{ id: "pans", name: "Pans", parent_id: "cw" }] }],
  },
  { id: "el", name: "QA Electronics", parent_id: null },
];
const flat = [
  { id: "g", name: "General", parent_id: null },
  { id: "hk", name: "QA Home & Kitchen", parent_id: null },
  { id: "el", name: "QA Electronics", parent_id: null },
  { id: "cw", name: "QA Cookware", parent_id: "hk" },
  { id: "pans", name: "Pans", parent_id: "cw" },
];

describe("one category list, however it arrives", () => {
  it("lists the tree's children under their parents, as deep as they go", () => {
    expect(categoryMenu(tree).map(menuLabel)).toEqual(["General", "QA Home & Kitchen", "— QA Cookware", "— — Pans", "QA Electronics"]);
  });

  it("gives the offline shelf's flat list the very same menu", () => {
    expect(categoryMenu(flat)).toEqual(categoryMenu(tree));
  });

  it("keeps a child whose parent it was not sent", () => {
    expect(categoryMenu([{ id: "cw", name: "QA Cookware", parent_id: "gone" }])).toEqual([{ id: "cw", name: "QA Cookware", depth: 0 }]);
  });
});

/**
 * #AZ5: the item form built its own list one level deep, so a third-level
 * category could be made and filtered by but nothing could be filed in it.
 * Every picker reads `categoryMenu`; nobody walks `children` by hand.
 */
describe("no screen lists categories one level deep by hand", () => {
  const src = resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const at = join(dir, name);
      if (statSync(at).isDirectory()) return files(at);

      return /\.tsx?$/.test(name) && !/\.test\./.test(name) && name !== "categoryMenu.ts" ? [at] : [];
    });

  it("walks children only inside categoryMenu", () => {
    const handmade = files(src).filter((f) => /children \?\? \[\]\)\.(map|flatMap)|\.children\?\.map/.test(readFileSync(f, "utf8")));

    expect(handmade).toEqual([]);
  });

  it("the item form offers every level", () => {
    const form = readFileSync(resolve(__dirname, "pages/ProductFormPage.tsx"), "utf8");

    expect(form).toMatch(/categoryMenu\(categories\.data/);
  });
});
