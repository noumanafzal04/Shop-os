import type { ReceiveInput, ShortReason, StockTransfer, TransferItem, TransferStatus } from "./services/transferService";

/**
 * WHAT A TRANSFER SAYS ABOUT ITSELF — the words, and the arithmetic of
 * counting one in.
 *
 * Kept out of the screen so it can be tested as rules rather than as markup:
 * a transfer screen is mostly a table, and what goes wrong in it is a status
 * that reads as finished when it is not, or a receipt that sends "30 arrived"
 * for a line somebody typed 28 against.
 */

interface Says {
  label: string;
  /** A Badge colour. */
  color: "primary" | "info" | "warning" | "success" | "light";
  /** What it means for whoever is reading the row. */
  hint: string;
}

export function statusSays(status: TransferStatus): Says {
  switch (status) {
    case "requested":
      return { label: "Asked for", color: "primary", hint: "The place that needs it has asked. Nothing has moved until the other place sends it." };
    case "in_transit":
      return { label: "On its way", color: "info", hint: "Sent, and not yet counted in. It is on nobody's shelf." };
    case "short":
      return { label: "Received short", color: "warning", hint: "Less arrived than was sent. The sender has to say what became of the rest." };
    case "cancelled":
      return { label: "Called back", color: "light", hint: "Stopped before it arrived. The stock is back where it was sent from." };
    default:
      return { label: "Received", color: "success", hint: "Everything is accounted for." };
  }
}

/**
 * WHAT THIS PERSON CAN DO WITH A NEW TRANSFER between these two places.
 *
 * Three verbs, and which are offered depends on where the person works:
 *
 *   send  the stock is at their place — they put it on the road
 *   ask   the stock is somewhere else and it is wanted at THEIR place — they
 *         may not take it, so they ask whoever keeps it
 *   move  both ends at once, which takes somebody allowed at both
 *
 * The server decides (`StockPlace`); this only keeps a button it would refuse
 * off the form. A keeper pinned to the shop used to be shown "Send" for stock
 * in the godown, press it, and be told no.
 *
 * @param anywhere  the owner, or anyone holding "Move stock at any place"
 * @param ownPlace  the place they work at; null when the panel does not know
 */
export function whatCanBeDone(
  from: string,
  to: string,
  { anywhere, ownPlace }: { anywhere: boolean; ownPlace: string | null },
): { send: boolean; ask: boolean; move: boolean } {
  if (from === "" || to === "" || from === to) return { send: false, ask: false, move: false };
  if (anywhere) return { send: true, ask: false, move: true };

  return { send: ownPlace === from, ask: ownPlace === to, move: false };
}

/** 2.000 reads wrong; 2 does. Real fractions are kept. */
export function qty(n: number | string | null | undefined): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "0";

  return String(Math.round(value * 1000) / 1000);
}

/** "Polo shirt — Medium": the size is part of what the line IS. */
export function lineName(item: Pick<TransferItem, "product_name" | "variant_name">): string {
  return item.variant_name ? `${item.product_name} — ${item.variant_name}` : item.product_name;
}

/**
 * "25 of the 40 asked for" — where a request was answered with less (or more)
 * than it asked. Null when it was answered in full, or was never a request.
 */
export function askedSays(item: Pick<TransferItem, "quantity" | "quantity_requested">, sent: boolean): string | null {
  if (item.quantity_requested === null || item.quantity_requested === undefined || !sent) return null;
  if (Number(item.quantity_requested) === Number(item.quantity)) return null;

  return `${qty(item.quantity)} of the ${qty(item.quantity_requested)} asked for`;
}

/** Units on a transfer, added up — what a driver would count off a van. */
export function unitsSent(transfer: Pick<StockTransfer, "items">): number {
  return (transfer.items ?? []).reduce((sum, i) => sum + Number(i.quantity), 0);
}

/** How much of a line left and did not arrive. Nought until it is counted in. */
export function shortOf(item: Pick<TransferItem, "quantity" | "quantity_received">): number {
  if (item.quantity_received === null || item.quantity_received === undefined) return 0;

  return Math.max(0, Math.round((Number(item.quantity) - Number(item.quantity_received)) * 1000) / 1000);
}

/** Every line that arrived short, with how much. */
export function shortLines(transfer: Pick<StockTransfer, "items">): Array<{ item: TransferItem; short: number }> {
  return (transfer.items ?? []).map((item) => ({ item, short: shortOf(item) })).filter((l) => l.short > 0);
}

/**
 * What a row says about a shortage — and whether it is still waiting on
 * somebody.
 *
 * "2 did not arrive" in amber is right while nobody has decided. Left like
 * that after the sender put them back, it reads as a problem still open on a
 * transfer whose badge says Received. Settled, it says what was decided, and
 * says it quietly.
 */
export function shortSays(transfer: Pick<StockTransfer, "items">): { text: string; open: boolean } | null {
  const lines = shortLines(transfer);
  if (lines.length === 0) return null;

  const units = qty(lines.reduce((n, l) => n + l.short, 0));
  const outcomes = new Set(lines.map((l) => l.item.short_outcome));

  if (outcomes.has(null)) return { text: `${units} did not arrive`, open: true };
  if (outcomes.size > 1) return { text: `${units} short — settled`, open: false };

  return { text: `${units} short — ${outcomes.has("returned") ? "put back" : "written off"}`, open: false };
}

export const SHORT_REASONS: Array<{ value: ShortReason; label: string }> = [
  { value: "missing", label: "Missing — it did not arrive" },
  { value: "damaged", label: "Damaged — it arrived unusable" },
];

/** What somebody typed against one line while counting a transfer in. */
export interface Counted {
  /** As typed. Empty is "not filled in", which is not the same as nought. */
  received: string;
  reason: ShortReason | "";
}

/**
 * Why a count cannot be sent yet — or null when it can.
 *
 * The server refuses all three of these too. Said here first because a
 * person counting cartons should be told which line, before pressing a button
 * that tells them only that something was wrong.
 */
export function countProblem(items: readonly TransferItem[], counted: Record<string, Counted>): string | null {
  for (const item of items) {
    const row = counted[item.id];
    if (!row) continue;

    const sent = Number(item.quantity);
    if (row.received.trim() === "") return `${lineName(item)}: type how many arrived.`;

    const got = Number(row.received);
    if (!Number.isFinite(got) || got < 0) return `${lineName(item)}: ${row.received} is not a quantity.`;
    if (got > sent) return `${lineName(item)}: ${qty(sent)} was sent, so no more than ${qty(sent)} can arrive.`;
    if (got < sent && row.reason === "") return `${lineName(item)}: say why ${qty(sent - got)} did not arrive.`;
  }

  return null;
}

/**
 * What to send when a count is confirmed: only the lines that did NOT arrive
 * whole. A line left out arrived as it was sent — which is also what a
 * transfer received with no body at all means.
 */
export function countedPayload(items: readonly TransferItem[], counted: Record<string, Counted>): ReceiveInput {
  const short = items.flatMap((item) => {
    const row = counted[item.id];
    if (!row) return [];

    const got = Number(row.received);
    if (got >= Number(item.quantity)) return [];

    return [{ id: item.id, quantity_received: got, short_reason: row.reason === "" ? null : row.reason }];
  });

  return short.length > 0 ? { items: short } : {};
}
