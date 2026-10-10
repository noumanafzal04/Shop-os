import { PRODUCT } from "../../common/brand";

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

/**
 * ── THE MARK WEARS THE PRIMARY, AND THE APP ICON DOES NOT ───────────
 *
 * Asked for directly: *"panel main logo color primary wala e hoga"*. These
 * two files are the mark as it appears INSIDE the product — in the rail, on
 * the sign-in panel — beside buttons and links drawn in #1a759f. A mark in a
 * neighbouring teal there does not read as a highlight, it reads as a second
 * brand.
 *
 * The APP ICON is the other case and keeps the supplied artwork's aqua on its
 * own deep ground (`public/icon-*.png`, and the phones' launcher icons). An
 * icon is masked by a launcher and sits beside other companies' logos with
 * nothing of ours around it; the palette has no claim on it.
 *
 * Both are cut from the same artwork by the script in `core/brand/`, so the
 * SHAPE cannot drift between them — only the pigment, deliberately.
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
 * The supplied lock-up spelled the name with an extra letter in it, and that
 * is not something `alt` can fix —
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
export function Wordmark({ className = "", tone = "auto", size = 32, nameClassName = "" }: {
  className?: string;
  /**
   * Extra classes for the NAME alone — so a bar with no room can drop the
   * word and keep the mark (`max-[359px]:hidden`). Whoever hides it owes the
   * link an `aria-label`: a hidden name is hidden from a screen reader too.
   */
  nameClassName?: string;
  /**
   * `onDark` for a surface that is dark in BOTH themes — the sign-in panel is
   * dark whatever the viewer has chosen, so the theme-following colours would
   * put near-black letters on a near-black ground there.
   */
  tone?: "auto" | "onDark" | "onBrand";
  size?: number;
}) {
  // `onBrand`: the ground IS the brand colour (the Primary sidebar), so the
  // half that is normally set in the brand would be invisible on it. Both
  // halves go white and the second is only softened — still two tones.
  const name = tone === "auto" ? "text-gray-900 dark:text-white" : "text-white";
  const half = tone === "onBrand" ? "text-white/70" : tone === "onDark" ? "text-brand-400" : "text-brand-500";

  /**
   * THE TWO-TONE SPLIT, TAKEN FROM THE NAME RATHER THAN TYPED.
   *
   * The artwork sets the first word in the reading colour and the rest in the
   * brand. That was written out as `True<span>&nbsp;Serve</span>` — correct,
   * and the last place in this app where the product's name was a literal, so
   * a rename would have left the wordmark itself saying the old thing while
   * every page title said the new one. The one string that is the brand is
   * not a good place for that.
   *
   * A name with no space in it keeps the whole word in the reading colour and
   * loses the second tone. That is the right failure: a split needs two
   * halves, and inventing one by cutting letters would produce a lock-up
   * nobody designed.
   */
  const [first, ...rest] = PRODUCT.name.split(" ");
  const second = rest.join(" ");

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      {/* A brand ground is a dark ground as far as the mark is concerned. */}
      <BrandMark size={size} tone={tone === "auto" ? "auto" : "onDark"} />
      <span
        className={`font-bold italic tracking-tight ${name} ${nameClassName}`}
        style={{ fontSize: size * 0.66, lineHeight: 1.1 }}
      >
        {first}
        {second && <span className={half}>&nbsp;{second}</span>}
      </span>
    </span>
  );
}
