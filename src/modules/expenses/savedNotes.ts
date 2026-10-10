/**
 * WHAT THE SERVER SAID ABOUT AN ENTRY IT HAS JUST SAVED.
 *
 * An expense or an income can be recorded and still have something worth
 * hearing: a budget it took the month past, cash paid out with no drawer open
 * to take it from. Those come back as `meta.warnings` on a SUCCESSFUL save.
 *
 * The two forms did different things with them, and each was wrong in its own
 * way:
 *
 *   The expense form held itself open, showed the warning under the word
 *   "Saved" — and left "Save expense" live beside it, over a form still full
 *   of the bill that had just been filed. One more press and it was filed
 *   twice.
 *
 *   The income form closed, and put the FIRST warning in a toast INSTEAD of
 *   "Income recorded". So a save with a warning never said it had saved, any
 *   second warning was dropped, and the one that was shown was gone in four
 *   seconds. Editing an entry never looked at the warnings at all.
 *
 * One behaviour now, in both: the entry is saved and says so; the form stays
 * up, locked, with every warning on it and a single button — Done.
 */
export function savedNotes(meta: unknown): string[] {
  const warnings = (meta as { warnings?: unknown } | null | undefined)?.warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings.filter((w): w is string => typeof w === "string" && w.trim() !== "");
}
