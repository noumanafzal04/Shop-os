/**
 * ARE THE TILES ON SCREEN THE ANSWER TO WHAT WAS ASKED?
 *
 * The till keeps the last list it was given on screen while the next one is
 * fetched, so the shelf does not blink between keystrokes. That is right
 * while the next answer is on its way — and wrong when it never arrives.
 *
 * A cashier typed "Brufen"; the server turned the search away (it was slowing
 * somebody down, or it had an error of its own); and the till went on showing
 * the twenty items it had been showing before, under the word "Brufen", with
 * "20+ results · Enter to add" beneath it. Nothing said the search had
 * failed, because the failure notice was only drawn over an EMPTY shelf. To
 * the cashier the shop simply did not stock it — or, worse, the first tile
 * was it.
 *
 * So the till remembers which question its tiles answer. A failed search
 * whose tiles belong to a different question is a failure to be shown, not a
 * list to be left up.
 */
export interface Asked {
  search: string;
  categoryId: string;
}

export const sameQuestion = (a: Asked, b: Asked): boolean =>
  a.search.trim() === b.search.trim() && a.categoryId === b.categoryId;

/**
 * Whether the shelf has to say it could not be loaded, rather than draw what
 * it is holding.
 *
 * `failure` is the list's own refusal (null when there is none). With nothing
 * on screen there is nothing else to draw; with something on screen, it is
 * only still worth drawing if it answers the question now in the box.
 */
export function shelfCouldNotLoad(failure: string | null, tilesShown: number, shown: Asked, asked: Asked): boolean {
  if (failure === null) return false;

  return tilesShown === 0 || !sameQuestion(shown, asked);
}
