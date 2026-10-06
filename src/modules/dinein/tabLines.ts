import type { TicketItem } from "./services/dineInService";

/**
 * THE LINES OF A TAB, AS A WAITER THINKS OF THEM.
 *
 * A tab is one list in the database and three piles in a waiter's head: what
 * I have not sent yet, what the kitchen is making, and what has gone out. The
 * screen drew the one list, every line the same card, with a small badge to
 * tell them apart — so "have I sent the naan?" was a question answered by
 * reading every row.
 */

/** A line still on the bill: not voided, by either of the two ways one can be. */
export const isLive = (i: TicketItem): boolean => !i.voided_at && i.kot_status !== "void";

/** Ordered, and the kitchen has not been told. The only lines that can still change. */
export const isUnsent = (i: TicketItem): boolean => isLive(i) && !i.sale_id && i.kot_status === "pending";

export interface TabPiles {
  /** Not sent yet — can be stepped, noted, removed. */
  toSend: TicketItem[];
  /** Fired, and not yet out. */
  inKitchen: TicketItem[];
  /** Out — served, or taken off the board in a clear-down. */
  out: TicketItem[];
  /** Paid for already. Still shown: it is part of what this table had. */
  paid: TicketItem[];
}

export function piles(items: TicketItem[]): TabPiles {
  const live = items.filter(isLive);
  const paid = live.filter((i) => !!i.sale_id);
  const owed = live.filter((i) => !i.sale_id);

  return {
    toSend: owed.filter((i) => i.kot_status === "pending"),
    inKitchen: owed.filter((i) => i.kot_status === "fired"),
    out: owed.filter((i) => i.kot_status !== "pending" && i.kot_status !== "fired"),
    paid,
  };
}

const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined): boolean => {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();

  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * The unsent line another one of THIS would join, or null.
 *
 * Tapping a dish used to add a new line of one every time. Tapping it now
 * adds to the line already there — but only when it is honestly the same
 * order:
 *
 *   the same dish, the same size, the same extras. A Large is not a Regular
 *   and a karahi with extra butter is not a karahi.
 *
 *   NOT a line with a note. "No green chilli" was said about one karahi; a
 *   second tap joining that line would tell the kitchen to make two without
 *   chilli, and nobody said that.
 *
 *   and never one already sent or paid — those are what happened, not what
 *   is being ordered.
 */
export function joinable(
  items: TicketItem[],
  choice: { product_id: string; variant_id?: string | null; modifier_option_ids?: string[] },
): TicketItem | null {
  return (
    items.find(
      (i) =>
        isUnsent(i)
        && i.product_id === choice.product_id
        && (i.variant_id ?? null) === (choice.variant_id ?? null)
        && sameSet(i.modifier_option_ids, choice.modifier_option_ids)
        && !i.note,
    ) ?? null
  );
}

/** How many of each dish are waiting to be sent — the number on a menu tile. */
export function unsentByDish(items: TicketItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    if (!isUnsent(i) || !i.product_id) continue;
    out[i.product_id] = (out[i.product_id] ?? 0) + Number(i.quantity);
  }

  return out;
}

/** Portions, not rows: three lines of 2, 1 and 8 are eleven things to carry. */
export const portions = (items: TicketItem[]): number =>
  items.reduce((n, i) => n + Number(i.quantity), 0);

/** In paisa and back, so a tab of .10s and .20s does not add up to a float. */
export const totalOf = (items: TicketItem[]): number =>
  items.reduce((n, i) => n + Math.round(Number(i.line_total) * 100), 0) / 100;

/**
 * What a waiter says to a kitchen, most often. One press each.
 *
 * Offered beside the box, never instead of it: an allergy is typed.
 */
export const QUICK_NOTES = ["No chilli", "Less spicy", "Extra spicy", "No onion", "Well done", "No ice", "Packed"];
