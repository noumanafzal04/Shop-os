/**
 * WHY A SHOP CANNOT TAKE AN ORDER, IN ONE WORD.
 *
 * A shop that paused orders for a while ("Busy" in the partner app — gas ran
 * out, the kitchen is drowning) is closed to checkout like a shop past its
 * hours, but "Closed" reads as shut for the day. The server says which
 * (`is_busy`); every card and the shop page use these words.
 */
export function shutLabel(shop: { is_busy?: boolean | null } | null | undefined): string {
  return shop?.is_busy ? "Busy" : "Closed";
}

/** The longer line on a picture: "Busy right now" / "Closed for now". */
export function shutLine(shop: { is_busy?: boolean | null } | null | undefined): string {
  return shop?.is_busy ? "Busy right now" : "Closed for now";
}
