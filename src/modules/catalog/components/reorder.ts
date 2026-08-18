/**
 * Dragging a row to a new place among its siblings.
 *
 * ── Why this is written out rather than pulled from a library ───────────
 *
 * `react-dnd` and `react-dnd-html5-backend` were in `package.json` and
 * **nothing imported either of them.** They would not have served here anyway:
 * the HTML5 drag-and-drop backend does not fire on touch, and a shopkeeper
 * ordering their menu is doing it on the tablet that runs the till. Writing
 * this is what found them; they have since been removed, along with `nanoid`,
 * which was equally unused.
 *
 * Pointer events cover mouse, pen and finger with one set of handlers, and the
 * whole of the arithmetic is the two functions below.
 *
 * ── Why midpoints rather than a row height ──────────────────────────────
 *
 * Rows are not all the same height — one being renamed grows a text field, a
 * long name wraps on a phone. Multiplying a drag distance by an assumed row
 * height puts the line in the wrong place exactly when the list is most
 * awkward to read. Measuring where the rows actually are cannot drift.
 */

/**
 * The slot a pointer at `y` is pointing into.
 *
 * Returns an INSERTION index: 0 means "above the first row", `mids.length`
 * means "below the last". Rows count as passed once the pointer is beyond their
 * middle, which is what makes a drag feel like it commits halfway rather than
 * at the moment of overlap.
 */
export function insertionFor(mids: number[], y: number): number {
  let i = 0;
  while (i < mids.length && y > mids[i]) i++;

  return i;
}

/**
 * The list after the row at `from` is dropped into insertion slot `at`.
 *
 * The subtraction is the part worth stating: once the row is lifted out,
 * everything below it has shifted up by one, so an insertion slot BELOW the
 * origin refers to a position one further along than it did. Without it a row
 * dragged downwards lands one place short, every time.
 */
export function moveTo<T>(items: T[], from: number, at: number): T[] {
  const arr = [...items];
  const [row] = arr.splice(from, 1);
  arr.splice(at > from ? at - 1 : at, 0, row);

  return arr;
}

/**
 * Did anything actually move?
 *
 * A tap on the grip is a drag of zero pixels, and firing a reorder for it would
 * write the same order back to the server on every mis-touch — on a till, all
 * day.
 */
export function sameOrder(a: Array<{ id: string }>, b: Array<{ id: string }>): boolean {
  return a.length === b.length && a.every((row, i) => row.id === b[i].id);
}
