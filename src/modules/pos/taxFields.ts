/**
 * THE TWO TAX FIELDS A CART LINE CARRIES, read off whatever was added.
 *
 * ── Why this is a function and not two lines at each call site ───────
 *
 * A product reaches the till's cart by five doors: the grid, the scanner,
 * the size-and-modifier sheet, a substitute, and a parked ticket. The tax
 * rate was copied onto the line at ONE of them, by hand, and the others each
 * forgot it in their own way — the modifier sheet left it off entirely, the
 * substitute passed three fields and dropped the rest.
 *
 * A rule written at every door is a rule somebody will not write at the
 * sixth. So it is written here, and each door spreads the result.
 *
 * ── Both fields, always ──────────────────────────────────────────────
 *
 * `tax_rate` is the product's own. `tax_group_rate` is the rate of the group
 * it is on, and the server charges THAT when there is one. Carrying only the
 * first is the bug: on the database this was found on, 17,140 products are on
 * a group and 124 have a rate of their own.
 *
 * Numbers arrive as strings from a decimal column, so both are coerced. A
 * value that is absent, null or not a number comes back as `null` — "no
 * opinion" — and never as 0, because zero is a rate and means exempt.
 */
export interface TaxFields {
  tax_rate: number | null;
  tax_group_rate: number | null;
}

function rate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

export function taxFieldsOf(product: object): TaxFields {
  const p = product as { tax_rate?: unknown; tax_group_rate?: unknown };

  return {
    tax_rate: rate(p.tax_rate),
    tax_group_rate: rate(p.tax_group_rate),
  };
}
