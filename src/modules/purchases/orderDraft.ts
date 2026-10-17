import type { ProductUnit } from "../catalog/types";
import { itemKey, type Orderable } from "./orderLines";
import type { SupplierItem } from "./types";

/**
 * A NEW PURCHASE ORDER BEFORE IT IS SENT — its lines, and the few things that
 * are done to all of them at once.
 *
 * Lines arrive from three places — the supplier's own list (what they sold us
 * before), the product search, and the reorder hand-off from Inventory — and
 * each is keyed by `itemKey`, so the same item found twice is one line.
 */
export interface DraftLine {
  key: string;
  product_id: string;
  variant_id: string | null;
  label: string;
  quantity: number;
  /** Per unit bought — per pack when a pack is chosen. */
  unit_cost: number;
  product_unit_id: string | null;
  units: Array<Pick<ProductUnit, "id" | "name" | "factor">>;
}

/** Ticked on the supplier's list: last time's quantity, pack and cost — the order a shop repeats. */
export function fromSupplierItem(item: SupplierItem): DraftLine {
  return {
    key: item.key,
    product_id: item.product_id,
    variant_id: item.variant_id,
    label: item.name,
    quantity: item.last.quantity > 0 ? item.last.quantity : 1,
    unit_cost: item.last.unit_cost,
    // A pack only if it is still one of the item's packs.
    product_unit_id: item.units.some((u) => u.id === item.last.product_unit_id) ? item.last.product_unit_id : null,
    units: item.units,
  };
}

/** Found by searching: one of it, at the cost on file. */
export function fromOrderable(o: Orderable): DraftLine {
  return {
    key: o.key,
    product_id: o.product_id,
    variant_id: o.variant_id,
    label: o.label,
    quantity: 1,
    unit_cost: o.cost,
    product_unit_id: null,
    units: o.units ?? [],
  };
}

/** Handed over by the reorder view: each short item, one of it, at its last cost. */
export function fromReorderItem(p: { id: string; name: string; cost: string | number | null; units?: ProductUnit[] }): DraftLine {
  return {
    key: itemKey(p.id, null),
    product_id: p.id,
    variant_id: null,
    label: p.name,
    quantity: 1,
    unit_cost: Number(p.cost ?? 0),
    product_unit_id: null,
    units: p.units ?? [],
  };
}

/** Lines added; one already on the order stays as it is — its quantity is somebody's decision. */
export function withAdded(lines: DraftLine[], added: DraftLine[]): DraftLine[] {
  const have = new Set(lines.map((l) => l.key));
  const fresh = added.filter((l) => {
    if (have.has(l.key)) return false;
    have.add(l.key);
    return true;
  });

  return fresh.length === 0 ? lines : [...lines, ...fresh];
}

/** One quantity for every line — "10 of each". Nought or less is not a quantity and changes nothing. */
export function withQuantityForAll(lines: DraftLine[], quantity: number): DraftLine[] {
  if (!(quantity > 0)) return lines;

  return lines.map((l) => ({ ...l, quantity }));
}

export const lineAmount = (l: Pick<DraftLine, "quantity" | "unit_cost">): number => Math.round(l.quantity * l.unit_cost * 100) / 100;

export const draftTotal = (lines: DraftLine[]): number =>
  Math.round(lines.reduce((sum, l) => sum + lineAmount(l) * 100, 0)) / 100;

/** A line the server would refuse: no quantity, or a cost below nought. */
export const lineIsWrong = (l: Pick<DraftLine, "quantity" | "unit_cost">): boolean => !(l.quantity > 0) || !(l.unit_cost >= 0);
