import { describe, expect, it } from "vitest";
import { categoryMenu, menuLabel } from "./categoryMenu";

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
