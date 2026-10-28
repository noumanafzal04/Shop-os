/**
 * A SCANNER GUN DOES NOT WAIT (mart #MT1).
 *
 * A gun types a code as keystrokes a few milliseconds apart, presses Enter,
 * and starts on the next code at once. The till emptied its box only when the
 * lookup came BACK — so the next code was typed onto the end of the last one,
 * `2100000100001` + `2100000100002` became one code no item carries, and every
 * scan after it on that bill glued on too. Ten scans, two lines: the goods
 * were bagged and the bill was short.
 *
 * So the box is emptied the moment Enter is taken, and the lookups queue here:
 * one at a time, in the order they were scanned, so the lines land on the bill
 * in that order and an options sheet never opens on top of another. A lookup
 * that fails does not stop the ones behind it.
 */
export function oneScanAtATime() {
  let last: Promise<void> = Promise.resolve();

  return (lookUp: () => Promise<void>): Promise<void> => {
    const run = last.then(lookUp);
    last = run.then(
      () => {},
      () => {},
    );

    return run;
  };
}
