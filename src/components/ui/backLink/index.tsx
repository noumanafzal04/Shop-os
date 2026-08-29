import { Link } from "react-router";

import { ChevronLeftIcon } from "../../../icons";

/**
 * THE WAY OUT OF A FULL-SCREEN SCREEN.
 *
 * Four screens render outside the console shell — the till, the dine-in floor,
 * a tab, and the kitchen board — so none of them has the sidebar or the
 * breadcrumb that gets a person back. Each grew its own way out, and by the
 * time a shop looked at them on a phone there were three different ones:
 *
 *   the floor    a bare "←" glyph, plain text
 *   a tab        a bare "←" glyph, plain text
 *   the kitchen  a bordered "Exit" with a chevron
 *
 * The first two are the ones a shop could not use. A text arrow has no border,
 * no surface and no hover, so nothing about it says it can be pressed — and
 * its tap target is the height of one line of 14px text, on the screens most
 * likely to be used one-handed while carrying plates.
 *
 * ── What this fixes, specifically ───────────────────────────────────────
 *
 * A control, not a character: a real surface with a border, and never smaller
 * than 44px in either direction, which is the smallest thing a finger hits
 * reliably. The label still folds away below `sm` — the word costs 90px of a
 * 390px header and says nothing the chevron does not — but the TARGET does
 * not fold away with it, which is what was actually wrong.
 */
export default function BackLink({
  to,
  label,
}: {
  to: string;
  /** Where it goes, in the shop's words: "Dashboard", "Floor". */
  label: string;
}) {
  return (
    <Link
      to={to}
      aria-label={`Back to ${label.toLowerCase()}`}
      className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 text-theme-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 sm:px-3 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-white"
    >
      <ChevronLeftIcon className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
