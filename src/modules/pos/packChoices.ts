import type { ProductUnit } from "../catalog/types";
import { packPrice } from "./lineMath";

/**
 * ONE TAP FOR THE PACK THE CUSTOMER ASKED FOR (2026-11-05, #POS4).
 *
 * A chemist sells a STRIP far more often than one tablet, and a box now and
 * then. The till's tap rang one tablet; a strip meant opening the line and
 * changing its "Sale Unit" — a sheet nobody would find at a busy counter. So an
 * item that comes in packs carries a button per pack under its row:
 * "+ Tablet Rs 3 · + Strip (10) Rs 30 · + Box (100) Rs 290".
 *
 * The price on the button is the price the line will carry — the same
 * `packPrice` the cart uses — and a pack bigger than what is left on the shelf
 * is shown, switched off, with the reason, rather than rung and refused at Pay.
 */
export interface PackChoice {
  /** null = the base unit (a tablet), else the pack's id. */
  unitId: string | null;
  label: string;
  /** How many base units this choice takes off the shelf. */
  factor: number;
  price: number;
  /** Why it cannot be rung now, or null. */
  why: string | null;
}

export function packChoices(o: {
  base: number;
  /** The base unit's word ("Tablet"); "Each" when the item has none. */
  unit: string | null | undefined;
  units: readonly ProductUnit[] | null | undefined;
  /** What is on the shelf, in base units — null when the item keeps no count. */
  left: number | null;
}): PackChoice[] {
  const packs = (o.units ?? []).filter((u) => u.id && Number(u.factor) > 0);
  if (packs.length === 0) return [];

  const word = o.unit?.trim() || "Each";
  const short = (factor: number) =>
    o.left !== null && o.left < factor ? `Only ${trim(o.left)} ${word} left` : null;

  return [
    { unitId: null, label: word, factor: 1, price: o.base, why: short(1) },
    ...packs.map((u) => {
      const factor = Number(u.factor);
      return { unitId: u.id as string, label: `${u.name} (${trim(factor)})`, factor, price: packPrice(o.base, u), why: short(factor) };
    }),
  ];
}

const trim = (n: number) => String(Number(n.toFixed(3)));
