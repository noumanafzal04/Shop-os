import type { VariantInput } from "./types";

/**
 * TURNING "Red, Blue" × "S, M, L" INTO SIX ROWS.
 *
 * A garment shop sells one shirt in three colours and four sizes. That is twelve
 * things on the shelf, each with its own price and its own stock, and until now
 * the only way to record them was to type twelve rows by hand: name, SKU, price,
 * stock, four unlabelled boxes each. Counted out, 3 × 4 was **60 pointer
 * interactions and 252 keystrokes** — most of them the same price typed twelve
 * times, and twelve hand-typed "Colour / Size" strings that had to stay
 * byte-identical from memory (`distinct` only catches exact repeats, so `Red / S`
 * and `Red/S` both survive to production).
 *
 * A pizza needs one axis. A drink needs one — 500ml, 1L. A shirt needs two. So
 * the shape is: name the axes, list each axis's values, and the combinations
 * fall out.
 *
 * ── Why this is a module and not a component ─────────────────────────────
 *
 * Because it is the part that can be wrong in a way nobody notices. A generator
 * that drops a combination, or that renames a row a shop had already priced, or
 * that quietly loses the stock somebody typed, produces a catalogue that is
 * plausible and incorrect. That deserves its own tests rather than being
 * exercised through a form.
 *
 * The server stays flat — one `name` string per variant — so this joins the axis
 * values into "Red / S". The AXES themselves are persisted beside the product so
 * the grid can be rebuilt on edit instead of showing twelve unexplained rows.
 */

/** One axis a shop is varying: a name and the values along it. */
export interface Axis {
  name: string;
  values: string[];
}

/** A row in the editor: a variant, plus where it came from. */
export interface MatrixRow {
  /** Present once the server knows about it. */
  id?: string;
  /** The joined label — what the receipt, the KOT and the cart line all show. */
  name: string;
  sku?: string;
  price: number | string;
  cost?: number | string;
  stock_quantity?: number;
  is_active?: boolean;
}

/**
 * The separator between axis values.
 *
 * `/` matches what the schema's own comment uses (`// e.g. "Red / Large"`) and
 * what the form's placeholder has always said, so it is the convention already
 * in the shop's head.
 *
 * It is not free of cost and the cost is worth writing down: six places in the
 * two repos compose `product + separator + variant`, and three of them also use
 * `/`. So a two-axis variant renders as `T-Shirt / Red / S` — three segments,
 * with nothing to say which slash is the product boundary. Reports group on
 * `(product_name, variant_name)`, so "how did Red sell across every size" is a
 * question the flat model cannot answer whatever separator is chosen. Changing
 * this character would not fix that; a structured axis column would, and that is
 * a different piece of work.
 */
export const JOIN = " / ";

/** A trimmed, de-duplicated, order-preserving value list. */
function clean(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    // Case-insensitive de-dupe: a shop that types "Red" and "red" means one
    // colour, and two variants differing only in case are two rows nobody can
    // tell apart on a receipt.
    const key = v.toLowerCase();
    if (v === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }

  return out;
}

/** The axes worth generating from — named, with at least one value. */
export function usableAxes(axes: Axis[]): Axis[] {
  return axes
    .map((a) => ({ name: a.name.trim(), values: clean(a.values) }))
    .filter((a) => a.name !== "" && a.values.length > 0);
}

/**
 * Every combination, in reading order.
 *
 * The FIRST axis moves slowest, so a shirt lists Red/S, Red/M, Red/L, then Blue —
 * which is how a shop says it out loud and how a rail is arranged. Reversing that
 * gives S/Red, S/Blue, M/Red, and a colour's sizes end up scattered down a
 * twelve-row list.
 */
export function combinations(axes: Axis[]): string[][] {
  const usable = usableAxes(axes);
  if (usable.length === 0) return [];

  return usable.reduce<string[][]>(
    (rows, axis) => rows.flatMap((row) => axis.values.map((v) => [...row, v])),
    [[]],
  );
}

/** The label a combination gets: "Red / S". */
export function labelFor(combination: string[]): string {
  return combination.join(JOIN);
}

/**
 * Regenerate the rows for a set of axes, **keeping what the shop already typed.**
 *
 * This is the load-bearing behaviour of the whole feature. A shop names two
 * colours, prices six rows, then remembers Black — and every price it has already
 * entered must survive. Matching is by NAME, because the name is what the
 * combination produces and nothing else about a row is stable across a
 * regeneration.
 *
 * Three consequences, all deliberate:
 *
 *   · a combination that already exists keeps its id, price, cost, sku, stock and
 *     active flag untouched;
 *   · a new combination arrives with the fallback price and nothing else, so it
 *     is visibly incomplete rather than silently priced;
 *   · a row whose combination is no longer produced is DROPPED from the list —
 *     which the server reads as "retire it", never as "destroy it".
 */
export function regenerate(
  axes: Axis[],
  existing: MatrixRow[],
  fallbackPrice: number | string = "",
): MatrixRow[] {
  const byName = new Map(existing.map((r) => [r.name.trim().toLowerCase(), r]));

  return combinations(axes).map((combo) => {
    const name = labelFor(combo);
    const kept = byName.get(name.toLowerCase());

    return kept !== undefined ? { ...kept, name } : { name, price: fallbackPrice };
  });
}

/**
 * Read the axes back out of rows that have no axes recorded.
 *
 * For a product created before this existed, or through the API. Splitting on the
 * separator recovers the grid when every row has the same number of segments —
 * and refuses to guess when they do not, because a list of "Red / S" and "Large"
 * is not a matrix and pretending otherwise would invent an axis the shop never
 * had. The caller then shows a flat list, which is the honest fallback.
 */
export function axesFromRows(rows: MatrixRow[], names: string[] = []): Axis[] | null {
  if (rows.length < 2) return null;

  const split = rows.map((r) => r.name.split(JOIN).map((s) => s.trim()));
  const width = split[0].length;
  if (width < 1 || split.some((s) => s.length !== width)) return null;

  const axes: Axis[] = [];
  for (let i = 0; i < width; i++) {
    axes.push({ name: names[i] ?? `Option ${i + 1}`, values: clean(split.map((s) => s[i])) });
  }

  // Only a FULL grid can be reopened as one. Nine rows across 2 × 5 axes means
  // the shop deleted one, and rebuilding the grid would silently put it back.
  const expected = axes.reduce((n, a) => n * a.values.length, 1);

  return expected === rows.length ? axes : null;
}

/** Set one field on every row — the "same price for all sizes" control. */
export function fillAll<K extends "price" | "cost" | "stock_quantity">(
  rows: MatrixRow[],
  field: K,
  value: MatrixRow[K],
): MatrixRow[] {
  return rows.map((r) => ({ ...r, [field]: value }));
}

/**
 * What the shop still has to answer before this can be saved.
 *
 * The server requires a price on every variant and says so with a 422 — but the
 * form never rendered `variants.*.price` errors, so a blank price produced a save
 * that appeared to do nothing at all. Answering it here means the shop is told
 * before it presses the button.
 */
export function whatIsMissing(rows: MatrixRow[]): string | null {
  if (rows.length === 0) return null;

  const unpriced = rows.filter((r) => r.price === "" || r.price === null || Number.isNaN(Number(r.price)));
  if (unpriced.length > 0) {
    return unpriced.length === rows.length
      ? "Give these a price — every size needs one."
      : `${unpriced.length} of ${rows.length} sizes still need a price.`;
  }

  const blank = rows.filter((r) => r.name.trim() === "");
  if (blank.length > 0) return "Every size needs a name.";

  const seen = new Set<string>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (seen.has(key)) return `Two sizes are both called "${r.name}".`;
    seen.add(key);
  }

  return null;
}

/** Rows shaped for the API — the flat list the rest of the system reads. */
export function toPayload(rows: MatrixRow[]): VariantInput[] {
  return rows.map((r) => ({
    ...(r.id !== undefined ? { id: r.id } : {}),
    name: r.name.trim(),
    sku: r.sku?.trim() || undefined,
    price: r.price,
    cost: r.cost === "" || r.cost === undefined ? undefined : r.cost,
    ...(r.id === undefined ? { stock_quantity: Number(r.stock_quantity ?? 0) } : {}),
    ...(r.is_active === false ? { is_active: false } : {}),
  })) as VariantInput[];
}
