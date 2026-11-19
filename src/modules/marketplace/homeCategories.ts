import type { CategoryTrade } from "./services/marketplaceService";

/**
 * THE HOME ROW: KINDS OF SHOP, NOT TRADES.
 *
 * foodpanda's row is cuisines — Pakistani, Paratha, Pizza, Fast Food — not
 * "Restaurants". So a trade is opened into the categories its shops chose
 * (`fast_food`, `bakery`, `garments`…) and each becomes a tile; shops that
 * chose none are still reachable through a tile for the trade itself.
 * Busiest first; nothing with no shop behind it.
 */
export interface HomeTile {
  key: string;
  label: string;
  shops: number;
  trade: string;
  /** null = the whole trade (its shops that chose no category). */
  value: string | null;
}

export function homeCategoryTiles(trades: CategoryTrade[], cap: number): HomeTile[] {
  const out: HomeTile[] = [];
  for (const t of trades) {
    if (!(t.shops_count > 0)) continue;
    const cats = (t.categories ?? []).filter((c) => c.shops_count > 0);
    for (const c of cats) {
      out.push({ key: `${t.type}:${c.value}`, label: c.label, shops: c.shops_count, trade: t.type, value: c.value });
    }
    const named = cats.reduce((n, c) => n + c.shops_count, 0);
    const rest = t.shops_count - named;
    // Shops that picked no category — or a server that sent none at all.
    if (cats.length === 0 || rest > 0) {
      out.push({ key: t.type, label: t.label, shops: cats.length === 0 ? t.shops_count : rest, trade: t.type, value: null });
    }
  }
  return out
    .sort((a, b) => b.shops - a.shops || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, cap));
}
