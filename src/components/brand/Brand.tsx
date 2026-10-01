/**
 * The product's name and mark, in one place.
 *
 * ── Why these are images, and why there are four of them ────────────────
 *
 * The logo is artwork the company owns — a geometric "T" whose proportions
 * are not something to re-draw by eye. An earlier pass did exactly that,
 * approximating the mark as inline SVG so it could follow the theme, and the
 * result was a shape that was close but not the logo. Supplied art wins.
 *
 * The cost of an image is the one the inline version was avoiding: an <img>
 * is its own document and knows nothing about dark mode. The lock-up's
 * "True" is drawn in the company's near-black (#1B232E), which disappears on
 * a dark rail. So each asset ships twice — the second with that half lifted
 * to white — and the pair is swapped with `dark:` utilities rather than at
 * runtime, so there is no flash and no JavaScript involved.
 *
 * MARK   the badge alone, for the collapsed rail where there is no room for
 *        words.
 * LOCKUP mark plus name, for everywhere else.
 */

const MARK = "/images/logo/true-server-mark.png";
const MARK_ON_DARK = "/images/logo/true-server-mark-ondark.png";
const LOCKUP = "/images/logo/true-server-lockup.png";
const LOCKUP_ON_DARK = "/images/logo/true-server-lockup-ondark.png";

/** The badge alone — for the collapsed rail, where there is no room for words. */
export function BrandMark({ size = 32, tone = "auto" }: {
  size?: number;
  /**
   * `onDark` for a surface that is dark in BOTH themes — the sign-in panel is
   * dark whatever the viewer has chosen, so the `dark:` swap below would still
   * paint the near-black half on a near-black ground there.
   */
  tone?: "auto" | "onDark";
}) {
  if (tone === "onDark") {
    return <img src={MARK_ON_DARK} alt="" aria-hidden="true" style={{ height: size }} className="w-auto shrink-0" />;
  }

  return (
    <>
      <img src={MARK} alt="" aria-hidden="true" style={{ height: size }} className="w-auto shrink-0 dark:hidden" />
      <img src={MARK_ON_DARK} alt="" aria-hidden="true" style={{ height: size }} className="hidden w-auto shrink-0 dark:block" />
    </>
  );
}

/**
 * The full lock-up: mark plus name.
 *
 * The name is part of the artwork rather than text beside it, so it cannot
 * drift from the mark by a font update. `alt` carries it for a screen reader.
 */
export function Wordmark({ className = "", tone = "auto", size = 32 }: {
  className?: string;
  tone?: "auto" | "onDark";
  size?: number;
}) {
  /** The lock-up is a wide strip; its cap-height reads smaller than the
   *  square badge at the same pixel height, so it is given a little more. */
  const height = size * 1.1;

  if (tone === "onDark") {
    return (
      <span className={`flex items-center ${className}`}>
        <img src={LOCKUP_ON_DARK} alt="True Server" style={{ height }} className="w-auto" />
      </span>
    );
  }

  return (
    <span className={`flex items-center ${className}`}>
      <img src={LOCKUP} alt="True Server" style={{ height }} className="w-auto dark:hidden" />
      <img src={LOCKUP_ON_DARK} alt="True Server" style={{ height }} className="hidden w-auto dark:block" />
    </span>
  );
}
