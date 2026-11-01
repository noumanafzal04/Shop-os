import { useDebouncedValue } from "../../common/hooks/useDebouncedValue";

/**
 * WHAT THE LIST ASKS THE SERVER, AND WHEN (2026-11-02, #POS1).
 *
 * The till's product list asked the server on every keystroke. A scanner types
 * a 13-digit code in about eighty milliseconds, so one scan sent thirteen
 * searches — `7`, `79`, `798` … each a LIKE over the whole shelf — and the
 * lookup for the code itself queued behind them: on the 50k garments shop a
 * scan took 1.2–4.6 s to reach the cart, and a cashier who pressed F9 straight
 * after was told "Nothing to pay for yet".
 *
 * The list is asked once the box has been still for SEARCH_SETTLES_MS. A scan
 * empties the box on Enter, long before that, so a scan asks the list nothing
 * at all; a person typing a name sees the list a quarter of a second after
 * they stop. `settled` is false while the box holds words the list has not yet
 * been asked about — Enter must never act on the answer to an older question.
 */
export const SEARCH_SETTLES_MS = 250;

export function useAskedSearch(search: string): { asked: string; settled: boolean } {
  const asked = useDebouncedValue(search, SEARCH_SETTLES_MS);

  return { asked, settled: asked === search };
}
