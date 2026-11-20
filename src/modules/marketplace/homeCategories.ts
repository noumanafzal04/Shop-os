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

/**
 * FIVE TILES ACROSS, on any phone.
 *
 * "4 ki bajaye 5 categories show krwao, thora size kam" — the tiles were a
 * fixed 84 points, so a 390-point phone showed four and a bit, and they read
 * as too big. The size now comes from the screen: the row's padding (16 each
 * side) and four gaps of 8 taken off, the rest split five ways, kept between
 * 56 (a label still fits) and 76 (a tablet shows more rather than giants).
 *
 * The radius stays well under half the size — at exactly half Fabric draws a
 * square on a real phone.
 */
export const TILES_ACROSS = 5;
export const TILE_GAP = 8;
const ROW_PADDING = 16;

export interface TileSize {
  tile: number;
  pic: number;
  radius: number;
}

export function tileSize(screenWidth: number, across = TILES_ACROSS): TileSize {
  const n = Math.max(1, Math.floor(across));
  const free = (Number.isFinite(screenWidth) ? screenWidth : 0) - ROW_PADDING * 2 - TILE_GAP * (n - 1);
  const tile = Math.min(76, Math.max(56, Math.floor(free / n)));
  return { tile, pic: Math.round(tile * 0.68), radius: Math.round(tile * 0.3) };
}
