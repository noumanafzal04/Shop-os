/** A category as a picker lists it: its place in the tree is its depth. */
export interface MenuCategory {
  id: string;
  name: string;
  depth: number;
}

interface AnyCategory {
  id: string;
  name: string;
  parent_id?: string | null;
  children?: AnyCategory[];
}

/**
 * ONE CATEGORY LIST, HOWEVER IT ARRIVES (next rounds #22).
 *
 * `GET /categories` answers a TREE; the till's offline shelf keeps a FLAT list
 * that names each parent. The POS menu read only the tree's top row, so a
 * sub-category could be chosen at the till only while the line was down — and
 * the Products filter went one level deep while the Categories screen says
 * "nest as deep as you like".
 *
 * Either shape comes out as the same list: every category, each child straight
 * under its parent, in the order it arrived, with how deep it sits.
 */
export function categoryMenu(categories: AnyCategory[]): MenuCategory[] {
  const flat: Array<{ id: string; name: string; parent: string | null }> = [];
  const walk = (list: AnyCategory[], parent: string | null) =>
    list.forEach((c) => {
      flat.push({ id: c.id, name: c.name, parent: c.parent_id ?? parent });
      walk(c.children ?? [], c.id);
    });
  walk(categories, null);

  const known = new Set(flat.map((c) => c.id));
  const out: MenuCategory[] = [];
  const seen = new Set<string>();
  const place = (parent: string | null, depth: number) =>
    flat
      .filter((c) => (parent === null ? c.parent === null || !known.has(c.parent) : c.parent === parent))
      .forEach((c) => {
        if (seen.has(c.id)) return;
        seen.add(c.id);
        out.push({ id: c.id, name: c.name, depth });
        place(c.id, depth + 1);
      });
  place(null, 0);

  return out;
}

/** How a picker writes a category's name: a dash for each level down. */
export const menuLabel = (c: MenuCategory) => `${"— ".repeat(c.depth)}${c.name}`;
