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
 * is its own document and knows nothing about dark mode. The mark's upper
 * arm is drawn in the company's near-black (#1B232E), which disappears on a
 * dark rail. So it ships twice — the second with that arm lifted to white —
 * and the pair is swapped with `dark:` utilities rather than at runtime, so
 * there is no flash and no JavaScript involved.
 *
 * Only the MARK is artwork. The name is set as text beside it — see the
 * Wordmark below for why.
 */

const MARK = "/images/logo/true-serve-mark.png";
const MARK_ON_DARK = "/images/logo/true-serve-mark-ondark.png";

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
 * The full lock-up: the supplied mark, and the name set as TEXT beside it.
 *
 * ── Why the name is not part of the picture ─────────────────────────────
 *
 * The supplied lock-up spelled it "True Server". The product is True Serve,
 * and a logo with an extra letter in it is not something `alt` can fix —
 * a screen reader would hear the right name while every sighted viewer read
 * the wrong one.
 *
 * So the lock-up is split: the MARK stays artwork, because its proportions
 * are the company's and not something to re-draw by eye, and the NAME
 * becomes text. That also buys back everything an <img> gave away — the name
 * uses the app's own typeface, follows the theme through a token, scales
 * with the layout, and is one string to change if the name changes again.
 *
 * The two-tone split is the artwork's own: the first word in the reading
 * colour, the second in the brand.
 */
export function Wordmark({ className = "", tone = "auto", size = 32 }: {
  className?: string;
  /**
   * `onDark` for a surface that is dark in BOTH themes — the sign-in panel is
   * dark whatever the viewer has chosen, so the theme-following colours would
   * put near-black letters on a near-black ground there.
   */
  tone?: "auto" | "onDark";
  size?: number;
}) {
  const name = tone === "onDark" ? "text-white" : "text-gray-900 dark:text-white";
  const half = tone === "onDark" ? "text-brand-400" : "text-brand-500";

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <BrandMark size={size} tone={tone} />
      <span
        className={`font-bold italic tracking-tight ${name}`}
        style={{ fontSize: size * 0.66, lineHeight: 1.1 }}
      >
        True<span className={half}>&nbsp;Serve</span>
      </span>
    </span>
  );
}
