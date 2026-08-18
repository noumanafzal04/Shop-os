/**
 * The ✕ on a panel that writes its own header.
 *
 * `Modal` has a close button of its own, properly sized — `h-9.5 … sm:h-11`,
 * on a tinted circle. Screens that lay out their own title row skip it and
 * hand-roll a bare glyph instead:
 *
 *     <button className="text-gray-400 hover:text-gray-700"><CloseIcon …/></button>
 *
 * which is a 20-pixel target with no padding around it. On a desk that is
 * merely fiddly. **On the till it is the wrong control to make small** — the
 * tender sheet, the line editor and the held-sales list are all closed with a
 * thumb, often mid-queue, and a miss either does nothing or presses whatever
 * sits behind it.
 *
 * A constant rather than a component, matching `ROW_ACTION`: these sit inside
 * bespoke headers with their own spacing, and a component would bring layout
 * opinions those headers already have.
 */
export const MODAL_CLOSE =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-400/40 dark:hover:bg-white/[0.06] dark:hover:text-gray-200";

/**
 * The ✕ that dismisses a pill or a notice bar, rather than a whole panel.
 *
 * Smaller than `MODAL_CLOSE` because it lives inside a strip two lines high and
 * a 36-pixel button would set the strip's height instead of fitting in it. 28
 * pixels is the compromise: still a target a thumb finds, where before there
 * was a bare 16-pixel glyph with nothing around it.
 *
 * `currentColor` on purpose — these sit on tinted backgrounds (a warning bar, a
 * success pill) and must take the colour of the strip they are in rather than
 * bring their own grey.
 */
export const INLINE_DISMISS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 transition hover:bg-black/5 hover:opacity-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-current/40 dark:hover:bg-white/10";
