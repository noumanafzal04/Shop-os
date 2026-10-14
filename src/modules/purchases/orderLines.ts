import type { ProductUnit } from "../catalog/types";

/**
 * WHAT A PURCHASE ORDER CAN ASK THE SUPPLIER FOR.
 *
 * A design sold in sizes holds no stock of its own — the stock is on each
 * size. The order form offered only the design, so a clothing shop could raise
 * an order for "Men's Waistcoat" and nothing else, and the stockroom could
 * never receive it: the server refuses to put stock on a design ("say which
 * size"). Zari's first order to Faisalabad Mills could not be taken in.
 *
 * So a sized design is offered as its sizes, each with its own cost (or the
 * design's, where the size has none), and the line carries the size to the
 * server. Packs do not combine with sizes (the server's rule), so a size line
 * offers none.
 */
export interface Orderable {
  key: string;
  product_id: string;
  variant_id: string | null;
  /** "Men's Waistcoat / M" — what the line is called everywhere on the form. */
  label: string;
  cost: number;
  units?: ProductUnit[];
}

interface Source {
  id: string;
  name: string;
  cost?: string | number | null;
  units?: ProductUnit[];
  variants?: Array<{ id: string; name: string; cost?: string | number | null; is_active?: boolean }>;
}

export function orderables(p: Source): Orderable[] {
  const sizes = (p.variants ?? []).filter((v) => v.is_active !== false);
  if (sizes.length === 0) {
    return [{ key: p.id, product_id: p.id, variant_id: null, label: p.name, cost: Number(p.cost ?? 0), units: p.units }];
  }

  return sizes.map((v) => ({
    key: `${p.id}:${v.id}`,
    product_id: p.id,
    variant_id: v.id,
    label: `${p.name} / ${v.name}`,
    cost: Number(v.cost ?? p.cost ?? 0),
  }));
}

/** What one line sends: the size when it has one, a pack only when it has none. */
export function lineOut(l: { product_id: string; variant_id?: string | null; product_unit_id?: string | null; quantity: number; unit_cost: number }) {
  return {
    product_id: l.product_id,
    ...(l.variant_id ? { variant_id: l.variant_id } : { product_unit_id: l.product_unit_id || undefined }),
    quantity: l.quantity,
    unit_cost: l.unit_cost,
  };
}
