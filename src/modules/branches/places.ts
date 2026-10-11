import type { Branch } from "./services/branchService";

/**
 * A PLACE IS A SHOP OR A WAREHOUSE — and what the panel says about each.
 *
 * Both hold stock. A shop sells at a counter; a warehouse only holds, and has
 * no till. The server decides what each may do (`Branch::mustSell`,
 * `StockPlace`); this file is only the words and the two questions the
 * screens ask before drawing anything.
 *
 * ── Two questions that used to be one ───────────────────────────────────
 *
 * "Is this a multi-branch shop?" was asked in six files as
 * `max_branches !== 1`, and it stood for two different things:
 *
 *   · is there anywhere ELSE stock could be — which a single shop with a
 *     godown now answers yes to;
 *   · is there more than one place that SELLS — which it still answers no to.
 *
 * A sales list has no use for a Branch column in a shop with one counter and
 * a godown, and that same shop very much needs the screen where the godown is
 * added. One rule for both would have got one of them wrong.
 */
export type PlaceKind = "shop" | "warehouse";

interface Allowed {
  max_branches: number | null;
  max_warehouses?: number | null;
}

/**
 * What the business actually HAS open, as the server counts it.
 *
 * ── A second place existing is the switch ───────────────────────────────
 *
 * Every plan allows a warehouse, and most shops will never have one: the shop
 * is where the goods arrive, are kept and are sold. Everything here used to be
 * decided from the ALLOWANCE — so a one-counter grocer was shown Stock by
 * place (a table with one column), Stock transfers (moving stock to nowhere),
 * a Branch column reading "Main" all the way down, and a "branch prices"
 * button with one branch in it.
 *
 * It is how every other stock system does it: one location is the plain
 * experience, and the screens about locations appear when a second is added.
 * The allowance still answers one question — may another be ADDED — and that
 * is the only thing `mayHaveMore…` is for now.
 */
interface Has {
  places?: { shops: number; warehouses: number } | null;
}

/** Is there, today, more than one open place stock could be. */
export function hasSecondPlace(has: Has | null | undefined): boolean {
  // Absent from a server that pre-dates the count, and absent reads as one
  // place: the quiet menu is the safe one to be wrong towards.
  const open = has?.places;

  return open ? open.shops + open.warehouses >= 2 : false;
}

/** Is there, today, more than one open place that SELLS. */
export function hasSecondShop(has: Has | null | undefined): boolean {
  return (has?.places?.shops ?? 0) >= 2;
}

/** Could stock be anywhere but the one shop: another branch, or a warehouse. */
export function mayHaveMorePlaces(allowed: Allowed | null | undefined): boolean {
  if (!allowed) return false;

  // `max_warehouses` is absent from a server that pre-dates warehouses, and
  // absent has to read as none: this decides whether a menu entry is drawn.
  return mayHaveMoreShops(allowed) || (allowed.max_warehouses === null || (allowed.max_warehouses ?? 0) > 0);
}

/** Could more than one place SELL. Null is "no ceiling". */
export function mayHaveMoreShops(allowed: Allowed | null | undefined): boolean {
  return allowed ? allowed.max_branches !== 1 : false;
}

export function isWarehouse(place: Pick<Branch, "kind"> | null | undefined): boolean {
  return place?.kind === "warehouse";
}

/** The word for a place of this kind, as a noun in a sentence. */
export function kindWord(kind: PlaceKind | undefined): "branch" | "warehouse" {
  return kind === "warehouse" ? "warehouse" : "branch";
}

export interface Places {
  shops: Branch[];
  warehouses: Branch[];
}

/** The same list, split by kind — each half in the order the server sent it. */
export function byKind(list: readonly Branch[]): Places {
  return {
    shops: list.filter((b) => !isWarehouse(b)),
    warehouses: list.filter((b) => isWarehouse(b)),
  };
}

export interface Allowance {
  used: number;
  /** null is "no ceiling". */
  limit: number | null;
  /** May one more be added. */
  room: boolean;
  /** "2 of 3 used", or "2" where nothing limits it. */
  says: string;
}

/**
 * How many of a kind there are against how many are allowed.
 *
 * Worked out per kind because the two are counted apart: a shop at its
 * branch limit may still have room for a warehouse, and telling it "limit
 * reached" over the wrong one is how a godown never gets added.
 */
export function allowance(used: number, limit: number | null | undefined): Allowance {
  const ceiling = limit === undefined ? 0 : limit;

  return {
    used,
    limit: ceiling,
    room: ceiling === null || used < ceiling,
    says: ceiling === null ? String(used) : `${used} of ${ceiling} used`,
  };
}
