import type { CatalogCategory, CatalogItem } from "../sync/catalogService";

/**
 * Finding an item by typing part of its name.
 *
 * Pure, and takes the rows rather than reading them, for two reasons: it can be
 * tested without a browser, and the caller holds the catalog in memory anyway —
 * at 20,000 items the projection is a few megabytes, and scanning it is faster
 * than a round trip to IndexedDB per keystroke.
 *
 * ── What it searches, and what it does not ──────────────────────────────
 *
 * Name, SKU, barcode and category — the four things a cashier actually types.
 * NOT the description: it is the largest column in the table, it is marketing
 * copy rather than an identifier, and it is left out of the projection
 * altogether, so searching it offline is not possible and should not be
 * pretended at.
 *
 * The online search does read descriptions. That is a real difference and it is
 * deliberate: shipping 5,000 characters per item to every tablet to make one
 * rare search work is the wrong trade.
 */

export interface SearchOptions {
  /** Category id → name, so typing "dairy" finds what is in Dairy. */
  categories?: Map<string, string>;
  limit?: number;
}

/** How many rows a counter can usefully look at without scrolling forever. */
const DEFAULT_LIMIT = 50;

/**
 * Rank a match so the obvious answer is first.
 *
 * A cashier typing "mil" wants Milk before Chocolate Milk Shake Powder, and an
 * exact code before either. Lower is better.
 */
function rank(item: CatalogItem, needle: string, categoryName: string): number {
  const name = item.name.toLowerCase();

  // An exact code is not a guess — somebody typed the number.
  if (item.sku?.toLowerCase() === needle) return 0;
  if (item.barcode?.toLowerCase() === needle) return 0;

  if (name === needle) return 1;
  if (name.startsWith(needle)) return 2;
  // A word inside the name beats a match in the middle of one: "milk" should
  // find "Full Cream Milk" ahead of "Milkshake".
  if (name.includes(` ${needle}`)) return 3;
  if (name.includes(needle)) return 4;

  if (item.sku?.toLowerCase().includes(needle)) return 5;
  if (item.barcode?.toLowerCase().includes(needle)) return 6;
  if (categoryName.includes(needle)) return 7;

  return Number.MAX_SAFE_INTEGER;
}

export function searchCatalog(
  items: readonly CatalogItem[],
  query: string,
  options: SearchOptions = {},
): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const categories = options.categories ?? new Map<string, string>();
  const limit = options.limit ?? DEFAULT_LIMIT;

  const scored: Array<{ item: CatalogItem; score: number }> = [];

  for (const item of items) {
    const categoryName = (categories.get(item.category_id ?? "") ?? "").toLowerCase();
    const score = rank(item, needle, categoryName);
    if (score !== Number.MAX_SAFE_INTEGER) {
      scored.push({ item, score });
    }
  }

  return scored
    // Ties break on name so the same query always returns the same order — a
    // list that reshuffles between keystrokes is one a cashier cannot click.
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((row) => row.item);
}

/** Category id → lowercase name, built once per catalog load. */
export function categoryIndex(categories: readonly CatalogCategory[]): Map<string, string> {
  return new Map(categories.map((c) => [c.id, c.name]));
}
