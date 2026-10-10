/**
 * What to call a business of a given trade, mid-sentence — article and all.
 *
 * The module picker built its sentences as "a " + the trade's label + " shop",
 * which is how the console came to say:
 *
 *   "Only what a finance manager shop can use"   — it is not a shop
 *   "Not usual for a auto & tyre shop"           — "a auto"
 *   "What Basic gives a retail store shop"       — a store shop
 *   "everything a online store shop can use"     — "a online", a store shop
 *
 * A label is a title for a dropdown, not a noun. So each trade says what a
 * business of that kind IS, and an unknown one falls back to a phrase that is
 * at least grammatical.
 */
const PHRASE: Record<string, string> = {
  food: "a restaurant",
  mart: "a mart",
  pharmacy: "a pharmacy",
  retail: "a retail shop",
  services: "a service business",
  automotive: "an auto workshop",
  petroleum: "a fuel station",
  online: "an online shop",
  finance: "a books-only business",
};

export function tradePhrase(code: string | null | undefined, label?: string | null): string {
  if (code && PHRASE[code]) return PHRASE[code];

  const named = (label ?? "").trim().toLowerCase();
  if (named === "") return "this kind of business";

  return `${/^[aeiou]/.test(named) ? "an" : "a"} ${named} business`;
}
