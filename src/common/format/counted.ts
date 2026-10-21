import { formatQuantity } from "./quantity";

/**
 * A COUNT WITH ITS NOUN, the way a person writes one: "1 item", "3 items",
 * "0 items", "2.5 days".
 *
 * Seven screens wrote "3 item(s)" — the sentence a program writes when it does
 * not want to decide. A refund read "RET-0004 · 1 item(s)", a collection
 * "12 item(s)", a customer group "1 member(s)".
 *
 * `many` is for the nouns that do not take an s: `counted(n, "box", "boxes")`.
 */
export function counted(n: number | string | null | undefined, one: string, many: string = `${one}s`): string {
  const value = Number(n ?? 0);

  return `${formatQuantity(value)} ${value === 1 ? one : many}`;
}

const IRREGULAR: Record<string, string> = { people: "person", staff: "staff" };

/**
 * THE ONE OF A LIST'S PLURAL: "people" → "person", "entries" → "entry",
 * "past orders" → "past order", "orders being worked" → "order being worked".
 *
 * A list's count is handed its noun in the plural, once, and printed "1 people",
 * "1 sales", "1 changes" whenever a filter left one row (retail #12). The first
 * word that is a plural is the one that changes.
 */
function oneOf(many: string): string {
  const words = many.split(" ");
  const at = words.findIndex((w) => IRREGULAR[w] !== undefined || (w.endsWith("s") && !w.endsWith("ss")));
  if (at < 0) return many;

  const w = words[at];
  words[at] = IRREGULAR[w] ?? (w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.slice(0, -1));

  return words.join(" ");
}

/** A list's count in its own noun, given in the plural: "1 person", "12 people". */
export function countedList(n: number, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? oneOf(many) : many}`;
}

