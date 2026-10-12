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
