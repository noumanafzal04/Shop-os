/**
 * A cart line's identity on this screen.
 *
 * Everything a cashier does to a line — discount, quantity, remove, price
 * level, serial numbers — finds the line by its key. Two lines sharing one is
 * two lines that are discounted together, counted together and REMOVED
 * together.
 *
 * ── How two lines came to share one ──────────────────────────────────
 *
 * The key was a counter in this page's memory: c1, c2, c3. The cart is also
 * parked on the device, so a refresh mid-sale costs a blink and not the
 * trolley — and it was parked, and restored, WITH its keys. A refresh brought
 * back c1 and c2 and a counter that had gone back to nought, so the next item
 * rung was c1 again.
 *
 * Reported as "a discount on one row is applied to another row too". Removing
 * the new line also removed the old one: goods in the bag and off the bill.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * A key is only ever ISSUED here, and never trusted from anywhere a previous
 * page could have written it. Anything that brings lines in from outside —
 * the parked cart, a held ticket — is re-keyed on the way in.
 */

let issued = 0;

/** A key no line on this page has been given. */
export function nextLineKey(): string {
  issued += 1;

  return `c${issued}`;
}

/**
 * The same lines under keys of this page's own.
 *
 * Also heals a cart that was parked while two of its lines already shared a
 * key: every line leaves here with one nobody else has.
 */
export function rekeyed<T extends { key: string }>(lines: readonly T[]): T[] {
  return lines.map((line) => ({ ...line, key: nextLineKey() }));
}
