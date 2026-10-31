import { round2 } from "../offline/pricing/money";

/**
 * THE AMOUNTS A CUSTOMER IS LIKELY TO HAND OVER (#AZ13).
 *
 * The keys beside "Exact" were rounded up to 500, 1,000 and 5,000 whatever the
 * shop traded in: a bill of AED 99.75 was offered 500 · 1,000 · 5,000 — no
 * AED 5,000 note exists, and 100, the obvious one, was missing. A rupee shop
 * fared no better on a small bill: Rs 100 never appeared.
 *
 * The shop's own notes say what can be handed over (`currency.cash`, the list
 * the close-shift count is made in). The bill is rounded up to each of them,
 * and the three smallest amounts above the bill are offered. A note far below
 * the bill only makes amounts nobody pays with (1,239 for a bill of 1,238.15),
 * so a note under a tenth of the bill is skipped — unless that leaves nothing.
 */
const NO_LIST = [5000, 1000, 500, 100, 50, 10, 5, 1];

export function quickTendersFor(payable: number, notes: readonly number[]): number[] {
  const due = round2(payable);
  if (!(due > 0)) return [];

  const kinds = [...new Set((notes.length > 0 ? notes : NO_LIST).filter((n) => n > 0))].sort((a, b) => a - b);
  const above = (from: readonly number[]) =>
    [...new Set(from.map((n) => round2(Math.ceil(round2(due / n)) * n)))]
      .filter((v) => v > due)
      .sort((a, b) => a - b);

  const sizable = above(kinds.filter((n) => n >= due / 10));
  const offered = sizable.length > 0 ? sizable : above(kinds);

  return [due, ...offered.slice(0, 3)];
}
