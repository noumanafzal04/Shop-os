/**
 * A SCAN FINDS THE TILL WHEREVER THE CURSOR IS (2026-11-02, #POS2).
 *
 * A barcode scanner is a keyboard that types very fast and presses Enter. The
 * till only listened in its search box, so a scan went wherever the cursor
 * happened to be — measured on the 50k garments shop:
 *
 *   after pressing a line's "+"   Enter pressed "+" again: 2 → 3, and the
 *                                 scanned item was never rung
 *   cursor in a quantity box      the code became the quantity:
 *                                 GK-00007 × 7,980,000,000,091
 *   after clicking a tile         Enter pressed the tile again: that item × 2
 *   after clicking the cart       the scan went nowhere
 *
 * So, on anything that is not a box to type in — a button, a tile, the page —
 * keys that arrive a scanner's pace apart and end in Enter are a SCAN: the
 * Enter presses nothing and the code is rung as if it had been scanned into the
 * search box. A person — pressing Enter on a button, typing slowly — is left
 * alone. Nothing is caught inside a dialog or behind the lock screen.
 *
 * A box to type in keeps its own keys: timing a scanner there failed, because
 * every digit typed into a quantity box re-draws the till and the next key
 * waits behind it. A quantity box knows a barcode by its LENGTH instead — see
 * isScannedCode.
 */
export const SCAN_KEY_GAP_MS = 50;
export const SCAN_MIN_LENGTH = 6;

/**
 * A "quantity" eight digits long is a barcode — EAN-8 and longer. No line on a
 * till is ten million of anything.
 */
export const isScannedCode = (typed: string): boolean => /^\d{8,}$/.test(typed.trim());

const typesText = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export interface ScanCatcherOptions {
  /** The till's own search box — a scan typed there is handled there. */
  isSearchBox: (target: EventTarget | null) => boolean;
  /** Somewhere a scan must not ring a line: a dialog, the lock screen. */
  isBlocked: (target: EventTarget | null) => boolean;
  onScan: (code: string) => void;
  /** For tests. In the browser the pace is read from each key's own timeStamp — see below. */
  now?: () => number;
}

/** A keydown listener for the till's window, in the capture phase. */
export function scanCatcher(o: ScanCatcherOptions): (e: KeyboardEvent) => void {
  let chars = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  const reset = () => { chars = ""; lastAt = Number.NEGATIVE_INFINITY; };

  return (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || o.isSearchBox(e.target) || typesText(e.target) || o.isBlocked(e.target)) { reset(); return; }
    // When the key arrived, not when this ran: a busy page makes keys wait.
    const at = o.now ? o.now() : e.timeStamp > 0 ? e.timeStamp : performance.now();

    if (e.key === "Enter") {
      const scanned = chars.length >= SCAN_MIN_LENGTH && at - lastAt <= SCAN_KEY_GAP_MS * 2;
      const code = chars;
      reset();
      if (!scanned) return;
      e.preventDefault();
      e.stopPropagation();
      o.onScan(code);
      return;
    }

    // Tab, arrows, Backspace, a function key: a person at the keyboard.
    if (e.key.length !== 1) { reset(); return; }

    if (at - lastAt > SCAN_KEY_GAP_MS) chars = "";   // a new run of keys
    chars += e.key;
    lastAt = at;
  };
}
