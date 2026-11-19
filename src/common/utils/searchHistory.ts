/**
 * WHAT A PERSON LOOKED FOR — the rules, apart from where they are kept.
 *
 * "Recent search b ayen kuch." The history existed but it filled with the
 * wrong things and showed up late:
 *
 *  - It remembered every term the search settled on after a quarter-second
 *    pause, so "piz" and "pizz" went in on the way to "pizza", and so did
 *    typos that found nothing.
 *  - It was read once when the screen opened, so a search just made never
 *    appeared until the screen was opened again.
 *
 * Now a term is remembered once it has STOOD for a moment and FOUND something,
 * or when the shopper pressed Search on the keyboard. The list on screen is
 * updated with the same rule the phone stores, so the two cannot disagree.
 */

/** How many recent searches are kept and shown. */
export const RECENT_MAX = 8;

/** Most recent first, without the same word twice in any case, capped. */
export function withRecent(list: readonly string[], term: string, max: number = RECENT_MAX): string[] {
  const clean = term.trim();
  if (clean.length < 2) return [...list].slice(0, max);
  const kept = list.filter((s) => s.toLowerCase() !== clean.toLowerCase());
  return [clean, ...kept].slice(0, Math.max(0, max));
}

/**
 * Worth keeping: two letters or more, and it found something. A search that
 * found nothing is a typo or a dead end, and offering it again is offering
 * the same empty screen.
 */
export function worthRemembering(term: string, found: number | null | undefined): boolean {
  return term.trim().length >= 2 && (found ?? 0) > 0;
}

/**
 * Things to try when there is no history yet, or beside it: the names of
 * items on offer near the shopper right now — real, in stock, nearby, so a
 * tap always finds something. Never the words already in the history.
 */
export function popularTerms(
  names: ReadonlyArray<string | null | undefined>,
  recent: readonly string[],
  cap: number = 6,
): string[] {
  if (cap <= 0) return [];
  const seen = new Set(recent.map((r) => r.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 28) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}
