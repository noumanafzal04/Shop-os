/**
 * WHAT THIS BANNER WILL ACTUALLY LOOK LIKE, IN BOTH PLACES.
 *
 * ── Why two, and why they are not the same shape ─────────────────────
 *
 * The phone lays a banner out at 2:1 (`PromoCarousel`: `width / 2`). The web
 * storefront draws it at roughly 3.5:1 — `h-40 sm:h-48` inside `max-w-2xl`.
 * Both use `object-cover`, so the SAME artwork loses its top and bottom on the
 * web and keeps them on the phone.
 *
 * Nobody uploading a banner could know that. The form said "Recommended
 * 1200×480", which is a third ratio and matches neither, and the only way to
 * find out what survived the crop was to publish and go and look.
 *
 * ── And it tells the truth about the title ───────────────────────────
 *
 * Building this is what turned up the fact that the phone drew the title only
 * when the image FAILED — so a title typed here appeared nowhere, on a field
 * that saved happily. The app draws it now, over a band, the way the web
 * already did. This preview shows both, so a claim like that cannot be made
 * again without somebody seeing it.
 */

interface Props {
  /** An object URL for a newly picked file, or the saved image. */
  src: string | null;
  title?: string;
  /** What a tap does, in words — "Opens Rahat Bakers", "Opens a link". */
  action?: string | null;
}

export default function BannerPreview({ src, title, action }: Props) {
  if (!src) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-theme-xs text-gray-400 dark:border-gray-700">
        Pick an image to see how it will look.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── On a phone ────────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          On the app · 2:1
        </p>
        <div className="relative w-full overflow-hidden rounded-[20px] border border-gray-200 dark:border-white/10">
          {/*
            `aspect-[2/1]` rather than a fixed height: the preview has to crop
            the way the phone crops, and the phone's card is the screen's width
            minus 32 points — a ratio, not a size.
          */}
          <div className="aspect-[2/1] w-full">
            <img src={src} alt="" className="h-full w-full object-cover" />
          </div>
          {title ? (
            <span className="absolute inset-x-0 bottom-0 bg-[rgba(12,7,5,0.62)] px-3.5 py-2.5 text-left text-sm font-bold text-white">
              {title}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── On the website ────────────────────────────────────────── */}
      <div>
        <p className="mb-1.5 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          On the website · wider, so more of the top and bottom is cut
        </p>
        <div className="relative w-full overflow-hidden rounded-3xl border border-gray-200 dark:border-white/10">
          <div className="aspect-[7/2] w-full">
            <img src={src} alt="" className="h-full w-full object-cover" />
          </div>
          {title ? (
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-left text-sm font-semibold text-white">
              {title}
            </span>
          ) : null}
        </div>
      </div>

      {/*
        WHAT A TAP DOES, in the same panel.

        The target is three separate fields — a type, a shop, a URL — and
        whether they add up to a working link is not readable from any one of
        them. Saying the outcome in a sentence is the cheapest way to catch a
        banner pointing nowhere.
      */}
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
        {action ? `Tapping it: ${action}` : "Tapping it does nothing — pick a target below."}
      </p>
    </div>
  );
}
