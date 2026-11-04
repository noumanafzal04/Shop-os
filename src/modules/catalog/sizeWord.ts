import { JOIN } from "./variantMatrix";

/**
 * WHAT THIS ITEM'S SIZES ARE CALLED.
 *
 * "Sizes" is the product's word for one item sold in several versions — and
 * for a kurta it is the right word. For a laptop it is not: the shop typed
 * "Model" and listed "Core i5 / 8GB / 256GB", and the till then asked
 * "Which size?". A phone shop's versions are its Storage, a chemist's its
 * Strength, a diner's drink its Flavor.
 *
 * The shop already said what varies — the editor saves the names it typed in
 * `attributes.variant_axes`, and every product list sends them. So a question
 * about one item asks in that item's own word, and "size" is only the answer
 * when the item never said (an older item, or an import).
 */

/** The names the shop typed for what varies — [] when the item kept none. */
export function axisNames(attributes: Record<string, unknown> | null | undefined): string[] {
  const raw = attributes?.["variant_axes"];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((a) => (a && typeof a === "object" && typeof (a as { name?: unknown }).name === "string"
      ? ((a as { name: string }).name).trim()
      : ""))
    .filter(Boolean);
}

/** What a question asks for: "model", "size and colour". "size" when nothing better is known. */
export function sizeWord(names: string[]): string {
  const words = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (words.length === 0) return "size";
  if (words.length === 1) return words[0];

  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** A column heading over the versions' names: "Model", "Size / Colour" — the same join the names use. */
export function sizeHeading(names: string[]): string {
  const named = names.map((n) => n.trim()).filter(Boolean);

  return named.length > 0 ? named.join(JOIN) : "Size";
}

/** How many versions: "12 sizes" when they are sizes, "2 options" for a model, a storage, a flavour. */
export function sizeCount(names: string[], n: number): string {
  const words = names.map((x) => x.trim().toLowerCase()).filter(Boolean);
  const sizes = words.length === 0 || (words.length === 1 && words[0] === "size");
  const one = sizes ? "size" : "option";

  return `${n} ${n === 1 ? one : `${one}s`}`;
}
