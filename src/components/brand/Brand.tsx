/**
 * The product's name and mark, in one place.
 *
 * ── Why this is a component and not an .svg ─────────────────────────────
 *
 * The wordmark used to be three image files — light, dark, and an icon-only
 * one for the collapsed rail — each carrying the letters as baked-in vector
 * paths. That is the normal way to ship a logo and it was the wrong one here,
 * for a reason worth writing down: **an SVG loaded through `<img>` is its own
 * document.** It does not inherit the page's font, it cannot fetch Outfit from
 * Google Fonts, and it knows nothing about dark mode — which is exactly why
 * there had to be two of them, and why they were forever one edit apart.
 *
 * Rendered inline as markup, the name is text in the page: it uses the app's
 * own typeface, follows the theme through a token, scales with the layout, and
 * is one file to change when a name changes. It is also readable by a screen
 * reader as a name rather than as alt text somebody remembered to write.
 */

/** The badge alone — for the collapsed rail, where there is no room for words. */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8.4" className="fill-brand-500" />
      {/* A basket, drawn rather than lettered: the handle, the body tapering
          the way a basket does, and the two wheels under it. Kept to strokes so
          it stays legible at 24px on a phone's rail. */}
      <path
        d="M8 9.4h2.1l1 3m0 0 1.7 6.2a1.6 1.6 0 0 0 1.55 1.2h6.3a1.6 1.6 0 0 0 1.55-1.2l1.25-4.6a1.1 1.1 0 0 0-1.06-1.4H11.1"
        stroke="white"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14.4" cy="23.2" r="1.5" fill="white" />
      <circle cx="21.4" cy="23.2" r="1.5" fill="white" />
    </svg>
  );
}

/**
 * The full lock-up: badge plus name.
 *
 * The name is split across two colours on purpose — "Cart" in the reading
 * colour, "Ze" in the brand — so the mark still reads as one word while giving
 * the eye somewhere to land. The brand half follows the tenant's own primary,
 * so a shop that has themed the panel sees its own colour here too.
 */
export function Wordmark({ className = "", tone = "auto", size = 32 }: {
  className?: string;
  /**
   * `onDark` for a surface that is dark in BOTH themes — the sign-in panel sits
   * on brand-950 whatever the viewer has chosen, so the theme-following colours
   * would put near-black letters on near-black blue there. A logo that is
   * invisible on one screen is not a smaller problem than a wrong one.
   */
  tone?: "auto" | "onDark";
  size?: number;
}) {
  const name = tone === "onDark"
    ? "text-white"
    : "text-gray-900 dark:text-white";
  const half = tone === "onDark" ? "text-brand-400" : "text-brand-500";

  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span
        className={`font-semibold tracking-tight ${name}`}
        style={{ fontSize: size * 0.63, lineHeight: 1.1 }}
      >
        Cart<span className={half}>Ze</span>
      </span>
    </span>
  );
}
