/**
 * THE QA WALKTHROUGH — one pass through the whole product, in the order a shop
 * actually lives it.
 *
 * ── Why this is not the Help Centre ─────────────────────────────────────
 *
 * The Help Centre is written for a SHOPKEEPER and is filtered to what their
 * shop has: a chemist never reads about dine-in, and a cashier never reads
 * about staff pay. That is right for them and useless for a tester, who needs
 * the opposite — everything, in one order, including the parts this particular
 * shop has switched off, and including what each thing is FOR so they can tell
 * a bug from a rule.
 *
 * ── The shape of a step ─────────────────────────────────────────────────
 *
 * Every step answers the same questions before it asks for anything: what this
 * is, where it lives, why it exists, and whether a shop can do without it. Only
 * then does it say what to do — because a tester who does not know what a
 * screen is FOR reports the rules as defects and misses the real ones
 * underneath.
 */

export interface QaCheck {
  /** What the tester does — one action, in the words of the screen. */
  do: string;
  /** What must happen. If it does not, that is the bug. */
  expect: string;
}

export interface QaStep {
  id: string;
  title: string;
  /** One line, read before anything is opened. */
  summary: string;
  /** Where it lives. A path in the shop panel unless it says otherwise. */
  screen?: string;
  /**
   * The module that has to be on. A tester who does not know this reports
   * "the screen is missing" against a shop that was never given it.
   */
  module?: string;
  /** Trades this belongs to, when it is not for every shop. */
  trades?: string[];
  /** What it is and why it exists — read before testing it. */
  what: string[];
  /** Can a shop run without it? Written down so nobody argues later. */
  required: "always" | "optional" | "trade" | "module";
  checks: QaCheck[];
  /** What a REAL failure looks like here, as against the rules doing their job. */
  wrong?: string[];
}

export interface QaSection {
  id: string;
  title: string;
  /** Why this whole section exists, in one sentence. */
  blurb: string;
  steps: QaStep[];
}
