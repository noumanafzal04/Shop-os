import { useState } from "react";

/**
 * THE PRODUCT, AS IT IS.
 *
 *     "acha screenshot leke achy data k sth landing page py … taa k achi
 *      look aye"
 *
 * The hero used to carry a DRAWING of the console — a rail, four tiles and a
 * chart, built out of divs. It was tidy, and it was not the product: the
 * moment the real dashboard changed, the front page was advertising a screen
 * nobody would find after signing up.
 *
 * These are photographs of the real thing: a working restaurant's dashboard
 * and its till with a sale half rung, taken at the size a 1440-wide screen
 * shows at 90%. Two screens, one window, and the visitor chooses — the two
 * things the page has been describing in words since the first line.
 *
 * ── A phone gets a phone's picture ───────────────────────────────────
 *
 * A 1600-wide screenshot squeezed into a 390-wide column is a grey smudge
 * with a blue stripe down it. Below `sm` the same two screens are shown as
 * they look ON a phone, which is also the truth about how they would be
 * used there.
 *
 * ── Keeping them true ────────────────────────────────────────────────
 *
 * They are files in `public/landing/`, and they go stale when the screens
 * change. How they were taken is in
 * docs/decisions/shopos-the-front-page-shows-the-product.md.
 */
const SHOTS = [
  {
    key: "dashboard",
    label: "Dashboard",
    alt:
      "The owner's dashboard for a restaurant: today's sales, expenses and profit, "
      + "how many tables are sat, and what is waiting on the kitchen.",
  },
  {
    key: "pos",
    label: "Point of sale",
    alt:
      "The till with a sale in progress: the menu on the left, five dishes in the cart, "
      + "tax worked out, and the total ready to take.",
  },
] as const;

type ShotKey = (typeof SHOTS)[number]["key"];

export function ProductShots() {
  const [shown, setShown] = useState<ShotKey>("dashboard");

  return (
    <div className="relative">
      {/* The light the screen throws into the room. Decorative. */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 -z-10 rounded-[3.5rem] bg-brand-500/20 blur-[90px]"
      />

      <div className="relative overflow-hidden rounded-2xl bg-gray-900 shadow-[0_50px_110px_-25px_rgba(0,0,0,0.75)] ring-1 ring-white/12 sm:rounded-3xl">
        {/* The lit top edge — a screen that is on. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
        />

        {/* The window's bar. The three lights are a drawing of a window; the
            two tabs are real, and are how the picture is changed. */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-gray-950/80 px-3 py-2.5 sm:px-4">
          <span aria-hidden="true" className="hidden w-14 gap-1.5 sm:flex">
            <span className="size-3 rounded-full bg-white/15" />
            <span className="size-3 rounded-full bg-white/15" />
            <span className="size-3 rounded-full bg-white/15" />
          </span>
          <div role="tablist" aria-label="Which screen to show" className="mx-auto flex gap-1 rounded-xl bg-white/5 p-1">
            {SHOTS.map((shot) => (
              <button
                key={shot.key}
                type="button"
                role="tab"
                id={`shot-tab-${shot.key}`}
                aria-selected={shown === shot.key}
                aria-controls="shot-panel"
                onClick={() => setShown(shot.key)}
                className={`min-h-10 rounded-lg px-4 text-sm font-semibold transition ${
                  shown === shot.key
                    ? "bg-white text-gray-900 shadow"
                    : "text-white/65 hover:bg-white/10 hover:text-white"
                }`}
              >
                {shot.label}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="hidden w-14 sm:block" />
        </div>

        {/* Both pictures are in the page and one is shown, so changing tab
            is a fade and not a wait. The frame holds its shape from the
            first paint — `aspect-*` — so nothing below it moves when a
            picture arrives. */}
        <div
          id="shot-panel"
          role="tabpanel"
          aria-labelledby={`shot-tab-${shown}`}
          className="relative aspect-[402/600] bg-gray-950 sm:aspect-[16/10]"
        >
          {SHOTS.map((shot, i) => (
            <picture key={shot.key}>
              <source media="(max-width: 639px)" srcSet={`/landing/${shot.key}-phone.webp`} />
              <source
                srcSet={`/landing/${shot.key}-1280.webp 1280w, /landing/${shot.key}.webp 2560w`}
                sizes="(min-width: 1280px) 1216px, 100vw"
              />
              <img
                src={`/landing/${shot.key}-1280.webp`}
                width={1280}
                height={800}
                // The first is what the page opens on; the second is fetched
                // when the browser has nothing better to do.
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                alt={shown === shot.key ? shot.alt : ""}
                aria-hidden={shown !== shot.key}
                className={`absolute inset-0 size-full object-cover object-top transition-opacity duration-500 motion-reduce:transition-none ${
                  shown === shot.key ? "opacity-100" : "opacity-0"
                }`}
              />
            </picture>
          ))}
        </div>
      </div>
    </div>
  );
}
