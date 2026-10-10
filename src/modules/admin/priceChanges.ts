/**
 * WHAT WAS CHANGED ON THE ADD-ON PRICE LIST — and nothing that was not.
 *
 * The list used to be saved whole: every box the screen held, as it had
 * loaded them. A screen that had been open since before somebody else priced
 * a module did not have that price in its boxes, so its next save — of
 * something else entirely — took it off, and off every bill that carried it.
 *
 * So a save says only what was typed. A number prices a module; null takes
 * its price off (blank and nought are both "free to add"); a module whose box
 * was not touched is not named, and the server leaves it as it is.
 */
export function priceChanges(saved: Record<string, number>, typed: Record<string, string>): Record<string, number | null> {
  const changes: Record<string, number | null> = {};

  for (const key of new Set([...Object.keys(saved), ...Object.keys(typed)])) {
    const was = saved[key] ?? 0;
    const now = priceTyped(typed[key]);
    if (now !== was) changes[key] = now > 0 ? now : null;
  }

  return changes;
}

/** A box's figure: blank, nought, a minus and half a number are all "no price". */
export function priceTyped(box: string | undefined): number {
  const n = Number((box ?? "").trim());

  return Number.isFinite(n) && n > 0 ? n : 0;
}
