/**
 * THE SCREENS A PERSON CAN JUMP TO — from the same menu the rail draws.
 *
 * The header's search has said "Search or jump to…" since it was put there,
 * and it could not jump anywhere: it found products, customers and sales, and
 * for "expenses" or "stocktake" it found nothing. Opened with nothing typed
 * it said "Type at least two characters". Half of its own sentence was a
 * promise with nothing behind it.
 *
 * It offers the shop's screens now — the rail's own list, so a screen this
 * shop has not got, or this person may not open, is not offered here either.
 */
export interface Screen {
  name: string;
  path: string;
  /** The menu row it sits under, when it is not a row itself: "Expense Manager". */
  under: string | null;
}

interface Row {
  name: string;
  path?: string;
  subItems?: Array<{ name: string; path: string }>;
}

/** Every place the menu can take somebody, once each, in the menu's order. */
export function screensOf(nav: readonly Row[]): Screen[] {
  const seen = new Set<string>();
  const out: Screen[] = [];
  const add = (screen: Screen) => {
    if (seen.has(screen.path)) return;
    seen.add(screen.path);
    out.push(screen);
  };

  for (const row of nav) {
    if (row.path) add({ name: row.name, path: row.path, under: null });
    for (const sub of row.subItems ?? []) add({ name: sub.name, path: sub.path, under: row.name });
  }

  return out;
}

/**
 * The screens a typed word finds, best first.
 *
 * A name that STARTS with it, then a word inside the name that does, then the
 * name of the row it sits under ("expense" finds everything in Expense
 * Manager), then anywhere in the name. Nothing typed is the head of the menu:
 * the screens a day starts on.
 */
export function findScreens(screens: readonly Screen[], typed: string, limit = 6): Screen[] {
  const q = typed.trim().toLowerCase();
  if (q === "") return screens.slice(0, limit);

  const rank = (s: Screen): number => {
    const name = s.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.split(/[\s&/-]+/).some((word) => word.startsWith(q))) return 1;
    if ((s.under ?? "").toLowerCase().includes(q)) return 2;
    if (name.includes(q)) return 3;

    return -1;
  };

  return screens
    .map((screen, at) => ({ screen, at, rank: rank(screen) }))
    .filter((r) => r.rank >= 0)
    // The menu's own order settles a tie: Sales before Sales reports.
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .slice(0, limit)
    .map((r) => r.screen);
}
