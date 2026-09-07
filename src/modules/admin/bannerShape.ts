/**
 * IS THIS ARTWORK THE SHAPE A BANNER IS DRAWN AT?
 *
 * ── The bug ──────────────────────────────────────────────────────────
 *
 * The mobile app lays a banner out at exactly 2:1 — `PromoCarousel` sets the
 * card to the screen width less 32 points and the height to half of that — and
 * fills it with `resizeMode="cover"`. Cover keeps the ratio and lets the
 * surplus hang off the edges, so artwork that is not 2:1 is published cropped.
 *
 * Nothing checked. The image was validated for type and for size and never for
 * shape, so an off-ratio banner uploaded, saved, published, and appeared cut on
 * every phone — and the only way to find out was to open the app and look.
 *
 * Reported as "banner cutting on mobile, not full banner showing", against
 * artwork made at 1200×480, which is the size this form itself used to ask for.
 *
 * ── Two copies of one rule, on purpose ───────────────────────────────
 *
 * `BannerRequest::checkShape()` is the gate — it is the only thing an upload
 * cannot go around. This is a PRE-FLIGHT, and its whole value is the clock: the
 * same answer in a hundred milliseconds instead of after a two-megabyte upload
 * that was always going to be thrown away. Exactly the arrangement the file
 * size check already had, and for the same reason.
 *
 * If the two ever disagree the server wins, and the visible symptom is a
 * refusal the form did not predict — annoying, never wrong. Change both.
 */

/** The ratio the phone draws. Not a preference — see `PromoCarousel`. */
export const BANNER_RATIO = 2;

/**
 * Accepts anything a designer would call 2:1.
 *
 * An exact ratio would refuse 1200×601, which is a file nobody can see the
 * problem with and which crops by half a pixel. At 4% the worst accepted crop
 * loses 2% of one edge.
 */
export const BANNER_RATIO_TOLERANCE = 0.04;

/** "2.5", not "2.5000000001" — this number goes in front of a person. */
const trim = (n: number) => String(Number(n.toFixed(2)));

/** How much of the longer axis `cover` throws away, as a whole percent. */
const percentLost = (bigger: number, smaller: number) =>
  Math.round((1 - smaller / bigger) * 100);

/**
 * The sentence to show, or null if the artwork is fine.
 *
 * Carries three things somebody can act on: what they sent, what is wanted, and
 * which edges of their own picture disappear. "Wrong ratio" on its own sends
 * somebody back to a file they already believe is right.
 */
export function bannerShapeProblem(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // Unreadable dimensions are not a shape complaint. The file type rules own
    // that refusal and have already said so in words about the file.
    return null;
  }

  const ratio = width / height;
  if (Math.abs(ratio - BANNER_RATIO) <= BANNER_RATIO * BANNER_RATIO_TOLERANCE) return null;

  /**
   * WHICH EDGES.
   *
   * A too-WIDE image is scaled to the card's HEIGHT and spills sideways, so it
   * loses left and right. The first version of this warning had it the other
   * way round, which is worse than no warning: it sends somebody to move the
   * text they had already put in the right place.
   */
  const lost =
    ratio > BANNER_RATIO
      ? `about ${percentLost(ratio, BANNER_RATIO)}% off the left and right`
      : `about ${percentLost(BANNER_RATIO, ratio)}% off the top and bottom`;

  return (
    `That image is ${width}×${height} (${trim(ratio)}:1). The app draws banners at 2:1 ` +
    `and fills the card, so this one would lose ${lost}. Save it at 1200×600.`
  );
}

/** Measure a picked file. Resolves null for anything the browser cannot read. */
export function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // Revoked on BOTH paths: the preview makes its own URL, and this one exists
    // only to be measured. A leak per pick is a leak per pick.
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
