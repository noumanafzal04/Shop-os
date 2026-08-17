/**
 * The Edit and Delete at the end of a table row.
 *
 * ── What they were ──────────────────────────────────────────────────────
 *
 * Twenty-seven bare text links, hand-written in twenty files:
 *
 *   <button className="text-gray-500 hover:text-gray-700 …">Edit</button>
 *   <button className="text-error-500 hover:text-error-600">Delete</button>
 *
 * No shape, no hover surface, no pressed state — two words of coloured text
 * floating at the end of a white row. A shop reported the screens as looking
 * blank, and this is a large part of why: the only thing on a list page you can
 * actually DO is drawn as though it were a caption.
 *
 * ── The part that is not cosmetic ───────────────────────────────────────
 *
 * A 17px line of text is a 17px tap target. On a phone or a tablet — which is
 * what these screens are held on — that is below every touch guideline there
 * is, and the row underneath is usually clickable itself. Missing Delete and
 * opening the record is harmless; missing Edit and hitting Delete is not.
 *
 * A padded pill is ~36px tall, has a surface that lights up under a finger, and
 * shows which of the two you are about to press before you commit.
 *
 * ── Why constants and not a component ───────────────────────────────────
 *
 * These sit inside twenty different row layouts — some in `<td>`, some in a
 * flex header, some carrying an icon, one an `✕`. Wrapping them all would have
 * meant rewriting twenty pieces of working markup to change how they look.
 * Exporting the class list moves every one of them with a single edit and
 * changes no structure at all, and `rowAction.test.ts` is what keeps the next
 * one from being typed by hand.
 */

const BASE =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-theme-sm font-medium transition";

/** A safe, reversible row action: Edit, Duplicate, Switch off. */
export const ROW_ACTION = `${BASE} text-gray-600 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200`;

/**
 * A row action that takes something away.
 *
 * Tinted rather than filled, for the same reason `Button`'s `danger` variant
 * is: twenty red slabs down a table would read as an emergency, and then the
 * one real warning on the page stops meaning anything.
 */
export const ROW_ACTION_DANGER = `${BASE} text-error-600 hover:bg-error-50 hover:text-error-700 dark:text-error-400 dark:hover:bg-error-500/10`;
