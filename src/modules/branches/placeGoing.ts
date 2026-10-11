import type { PlaceGoing, PlaceLeaving } from "./services/branchService";

/**
 * DELETING A PLACE THAT IS NOT EMPTY — what has to be answered, and whether
 * it has been.
 *
 * A place holding stock, or with people assigned to it, cannot simply go. The
 * owner used to be told that and left to raise a transfer by hand and
 * reassign each person on another screen, then come back and press Delete
 * again. The dialog asks instead, and this is the arithmetic behind its
 * button.
 *
 * Kept out of the dialog so it is tested as a rule: the thing that must not
 * happen is a Delete button that is live while a question is unanswered —
 * the server would refuse, and say so only after the press.
 */
export interface Answers {
  /** "" until chosen. */
  stock: "move" | "discard" | "";
  stockTo: string;
  peopleTo: string;
}

/** What still has to be answered — or null when Delete may be pressed. */
export function unanswered(leaving: PlaceLeaving, answers: Answers): string | null {
  if (leaving.blocked) return leaving.blocked;

  if (leaving.products > 0) {
    if (answers.stock === "") return "Say what becomes of its stock.";
    if (answers.stock === "move" && answers.stockTo === "") return "Choose the place its stock moves to.";
  }

  if (leaving.people > 0 && answers.peopleTo === "") return "Choose where its staff will work.";

  return null;
}

/** Only the answers that were asked for are sent: an empty place needs none. */
export function going(leaving: PlaceLeaving, answers: Answers): PlaceGoing {
  return {
    ...(leaving.products > 0 && answers.stock !== "" ? { stock: answers.stock } : {}),
    ...(leaving.products > 0 && answers.stock === "move" ? { stock_to: answers.stockTo } : {}),
    ...(leaving.people > 0 ? { people_to: answers.peopleTo } : {}),
  };
}

/** "14 products (320 units)" — what the stock question is about. */
export function stockSays(leaving: Pick<PlaceLeaving, "products" | "units">): string {
  const products = `${leaving.products} product${leaving.products === 1 ? "" : "s"}`;
  const units = Math.round(leaving.units * 1000) / 1000;

  return `${products} (${units.toLocaleString()} unit${units === 1 ? "" : "s"})`;
}
