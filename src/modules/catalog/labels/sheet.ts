import type { Product } from "../types";

/**
 * A LABEL IS A PHYSICAL OBJECT, and so is the sheet it is printed on.
 *
 * Everything here is in millimetres, because that is what survives the trip to
 * a printer, and nothing here draws anything: it answers the three questions
 * the screen and the paper both have to agree on —
 *
 *   how many stickers of this size fit on a sheet
 *   which sticker is on which sheet, and where
 *   what there IS to print for a product (itself, and each pack and size that
 *   carries its own barcode)
 *
 * The page used to hand the browser one long run of stickers and let it break
 * the pages wherever it liked, and preview "one of each product". So nobody
 * could say how many sheets a run would take until it had been printed.
 */

export type StockKey = "38x25" | "50x25" | "50x38" | "100x50";

export interface Stock {
  label: string;
  hint: string;
  w: number; // mm
  h: number; // mm
  bar: number; // barcode block height, mm
  name: number; // pt
  price: number; // pt
  meta: number; // pt
  lines: 1 | 2; // product-name lines that fit
}

export const STOCKS: Record<StockKey, Stock> = {
  "38x25": { label: "38 × 25", hint: "Small", w: 38, h: 25, bar: 8, name: 5.5, price: 8, meta: 4.5, lines: 1 },
  "50x25": { label: "50 × 25", hint: "Standard", w: 50, h: 25, bar: 9, name: 6, price: 9.5, meta: 5, lines: 1 },
  "50x38": { label: "50 × 38", hint: "Tall", w: 50, h: 38, bar: 13, name: 7.5, price: 12, meta: 6, lines: 2 },
  "100x50": { label: "100 × 50", hint: "Shelf tag", w: 100, h: 50, bar: 18, name: 12, price: 18, meta: 8.5, lines: 2 },
};

export const isStockKey = (v: unknown): v is StockKey => typeof v === "string" && v in STOCKS;

/** Sticker padding and the gap between stickers on a sheet, mm. */
export const PAD = 1.5;
export const GAP = 2;

/** A4, and the margin every desktop printer leaves round it. */
export const PAGE = { w: 210, h: 297, margin: 8 } as const;

/** How many stickers of this size a sheet takes: across, down, and in all. */
export function perSheet(stock: Pick<Stock, "w" | "h">): { cols: number; rows: number; count: number } {
  // A gap sits BETWEEN stickers, so n of them need n widths and n − 1 gaps.
  const fit = (room: number, size: number) => Math.max(1, Math.floor((room + GAP) / (size + GAP)));
  const cols = fit(PAGE.w - PAGE.margin * 2, stock.w);
  const rows = fit(PAGE.h - PAGE.margin * 2, stock.h);

  return { cols, rows, count: cols * rows };
}

/**
 * The run, cut into sheets.
 *
 * `skip` is the stickers already peeled off the FIRST sheet — a part-used
 * sheet is put back in the printer, not thrown away. They are places on the
 * sheet with nothing printed on them (`null`), on that sheet only.
 */
export function sheets<T>(labels: T[], count: number, skip = 0): Array<Array<T | null>> {
  const size = Math.max(1, count);
  const blanks = Math.max(0, Math.min(skip, size - 1));
  const run: Array<T | null> = [...Array.from({ length: blanks }, () => null), ...labels];

  const out: Array<Array<T | null>> = [];
  for (let i = 0; i < run.length; i += size) out.push(run.slice(i, i + size));

  return labels.length === 0 ? [] : out;
}

/** One thing a label can be printed for. */
export interface Printable {
  /** Stable across searches and pages: the product, and which pack or size of it. */
  key: string;
  productId: string;
  /** What the sticker says it is. */
  name: string;
  /** What it is, under its product, in a list: "Carton of 24", "Large". Null for the product itself. */
  part: string | null;
  barcode: string;
  price: number;
  /** The price it is marked down from, where it is on sale. */
  was: number | null;
  /** "/kg" for things sold by weight. */
  perUnit: string;
  /** "Carton = 24 Piece" — the largest pack, said on a single's label. Null for a pack or a size. */
  packLine: string | null;
}

const num = (v: string | number | null | undefined): number => Number(v ?? 0);

/**
 * Everything about a product that has a barcode of its own.
 *
 * The page printed ONE label for a product — its base barcode at its base
 * price — and mentioned its largest pack as a line of text. But a carton is
 * scanned by the carton's barcode and sold at the carton's price, and a Large
 * by the Large's: each is its own sticker.
 */
export function printables(p: Product): Printable[] {
  const out: Printable[] = [];
  const price = num(p.price);
  const sale = p.discount_price != null && num(p.discount_price) > 0 && num(p.discount_price) < price ? num(p.discount_price) : null;

  // Packs are kept smallest first, so the last is the biggest.
  const packs = p.units ?? [];
  const biggest = packs.length > 0 ? packs[packs.length - 1] : undefined;

  if (p.barcode) {
    out.push({
      packLine: biggest ? `${biggest.name} = ${num(biggest.factor)} ${p.unit ?? "pcs"}` : null,
      key: p.id,
      productId: p.id,
      name: p.name,
      part: null,
      barcode: p.barcode,
      price: sale ?? price,
      was: sale !== null ? price : null,
      perUnit: p.sold_by === "weight" && p.unit ? `/${p.unit}` : "",
    });
  }

  for (const v of p.variants ?? []) {
    const code = (p.barcodes ?? []).find((b) => b.variant_id === v.id)?.barcode;
    if (!code || v.is_active === false) continue;
    out.push({
      key: `${p.id}:size:${v.id}`,
      productId: p.id,
      name: `${p.name} ${v.name}`,
      part: v.name,
      barcode: code,
      price: num(v.price),
      was: null,
      perUnit: "",
      packLine: null,
    });
  }

  for (const u of p.units ?? []) {
    if (!u.barcode) continue;
    const holds = num(u.factor);
    out.push({
      key: `${p.id}:pack:${u.id ?? u.name}`,
      productId: p.id,
      name: `${p.name} ${u.name} of ${holds}`,
      part: `${u.name} of ${holds}`,
      barcode: u.barcode,
      // A pack with no price of its own is its pieces at the piece price.
      price: u.price != null && u.price !== "" ? num(u.price) : (sale ?? price) * holds,
      was: null,
      perUnit: "",
      packLine: null,
    });
  }

  return out;
}
