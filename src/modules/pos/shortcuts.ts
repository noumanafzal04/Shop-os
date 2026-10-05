/**
 * THE TILL'S KEYS — one table, read by the listener and by every hint.
 *
 * ── Why each action has TWO keys ─────────────────────────────────────
 *
 * The function keys are the counter's own: a cashier on a shop PC presses F9
 * without looking. But on a Mac — and on most laptops — F2 is the brightness
 * key unless `fn` is held, so the keydown never reaches the page at all. From
 * the screen that is indistinguishable from a shortcut that is broken, and it
 * was reported as exactly that.
 *
 * So every action also answers to Alt (Option) + a letter, which arrives on
 * every keyboard. Matched on `code`, not `key`: Option+S on a Mac types "ß",
 * and a rule written against the letter would never fire there.
 *
 * ── What is PRINTED is the function key, everywhere ──────────────────
 *
 * A first version printed "⌥P" on a Mac instead of "F9". The shop read that
 * as the keyboard keys having been taken away — the legend said F2, F4, F6
 * yesterday and something else today. So the hint is the key the counter has
 * always been taught, and the second key is in the tooltip and the Help page,
 * where it is an extra and not a replacement.
 */

export type ShortcutAction = "focusSearch" | "hold" | "openHeld" | "document" | "pay";

export const SHORTCUT_KEYS: ReadonlyArray<{
  action: ShortcutAction;
  label: string;
  /** `KeyboardEvent.key` of the function key. */
  fn: string;
  /** `KeyboardEvent.code` of the letter taken with Alt / Option. */
  code: string;
  letter: string;
}> = [
  { action: "focusSearch", label: "Search", fn: "F2", code: "KeyS", letter: "S" },
  { action: "hold", label: "Hold", fn: "F4", code: "KeyH", letter: "H" },
  { action: "openHeld", label: "Drafts", fn: "F6", code: "KeyD", letter: "D" },
  { action: "document", label: "Quote", fn: "F7", code: "KeyQ", letter: "Q" },
  { action: "pay", label: "Pay", fn: "F9", code: "KeyP", letter: "P" },
];

/**
 * Which action a keydown asks for, or null.
 *
 * Alt alone. With Ctrl as well it is AltGr on a European layout — somebody
 * typing a character — and with Cmd it belongs to the browser.
 */
export function shortcutFor(e: {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): ShortcutAction | null {
  for (const s of SHORTCUT_KEYS) {
    if (e.key === s.fn) return s.action;
  }

  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    for (const s of SHORTCUT_KEYS) {
      if (e.code === s.code) return s.action;
    }
  }

  return null;
}

/** Is this an Apple keyboard, where the F-keys are media keys by default? */
export function isAppleKeyboard(
  nav: { platform?: string; userAgent?: string } | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  return /Mac|iPhone|iPad/i.test(`${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`);
}

const keysOf = (action: ShortcutAction) => SHORTCUT_KEYS.find((s) => s.action === action)!;

/** The key to PRINT for an action: its function key, on every machine. */
export function keyLabel(action: ShortcutAction): string {
  return keysOf(action).fn;
}

/** Both keys, for a tooltip: "Pay · F9 or Alt+P". */
export function keyTitle(action: ShortcutAction, apple: boolean = isAppleKeyboard()): string {
  const s = keysOf(action);

  return apple
    ? `${s.label} · ${s.fn} (hold fn on a Mac), or Option+${s.letter}`
    : `${s.label} · ${s.fn} or Alt+${s.letter}`;
}
