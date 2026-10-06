/**
 * THE PRODUCT, AS IT IS.
 *
 *     "acha screenshot leke achy data k sth landing page py … taa k achi
 *      look aye"
 *
 * The front page used to carry a DRAWING of the console — a rail, four tiles
 * and a chart, built out of divs. It was tidy, and it was not the product:
 * the moment the real dashboard changed, the page was advertising a screen
 * nobody would find after signing up.
 *
 * These are photographs of the real thing — a working restaurant's dashboard,
 * and its till with a sale half rung — taken at the size a 1440-wide screen
 * shows at 90%.
 *
 * ── One screen, at two sizes ─────────────────────────────────────────
 *
 * Each picture is a window with a phone standing in front of it, and the
 * phone shows the SAME screen ("POS ke sath POS mobile ki lagao"). Side by
 * side, the same screen at two sizes is the claim itself: this is one shop,
 * and it fits wherever it is opened.
 *
 * The hero carries the dashboard and nothing else ("hero main dashboard ki
 * hi lagayen gy image"); the till has a section of its own further down.
 * They began as two tabs on one window. Two tabs meant the first thing after
 * the headline was a choice, and whichever was not chosen was never seen.
 *
 * ── A phone gets a phone's picture ───────────────────────────────────
 *
 * A 1600-wide screenshot squeezed into a 390-wide column is a grey smudge
 * with a blue stripe down it. Below `sm` the window holds the screen as a
 * phone draws it, and the phone beside it is not drawn at all.
 *
 * ── Keeping them true ────────────────────────────────────────────────
 *
 * They are files in `public/landing/`, and they go stale when the screens
 * change. How they were taken is in
 * docs/decisions/shopos-the-front-page-shows-the-product.md.
 */
const SHOTS = {
  dashboard: {
    address: "dashboard",
    alt:
      "The owner's dashboard for a restaurant: today's sales, expenses and profit, "
      + "how many tables are sat, and what is waiting on the kitchen.",
  },
  pos: {
    address: "point of sale",
    alt:
      "The till with a sale in progress: the menu on the left, five dishes in the cart, "
      + "tax worked out, and the total ready to take.",
  },
} as const;

export type ShotKey = keyof typeof SHOTS;

interface Props {
  shot: ShotKey;
  /**
   * The picture the page OPENS on. Fetched first and at once; every other is
   * left until the reader is near it.
   */
  first?: boolean;
}

export function ProductShot({ shot, first = false }: Props) {
  const { address, alt } = SHOTS[shot];

  return (
    <div className="relative mx-auto max-w-6xl">
      {/* The light the screen throws into the room. Decorative. */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 -top-8 bottom-1/4 -z-10 rounded-[3.5rem] bg-brand-500/25 blur-[90px]"
      />

      {/* LEANING BACK, LIKE A LAPTOP'S SCREEN.
       *
       *     "top banner ko thora tilt ni kr skty, pichhe ko, jaise laptop
       *      hota — matlab screen ko"
       *
       * Flat, the window was a rectangle pasted on the page. Tipped a few
       * degrees away at the top it is a screen standing on a desk, seen from
       * a chair — and the phone beside it, which stays upright, is then
       * plainly in front of it. `perspective` is on the parent and the
       * rotation on the child, hinged at the bottom edge the way a lid is.
       *
       * From `sm` only: below it the frame holds a phone's own picture, and a
       * phone does not lean. A hand resting on the window brings it nearly
       * upright, for anyone who wants to read it — unless they have asked
       * their device for less motion, in which case it simply stays. */}
      <div className="sm:[perspective:2200px]">
        {/* THE WINDOW DISSOLVES INTO THE ROOM.
            A screenshot is a slice of a longer page, and wherever the slice
            ends it ends mid-sentence: half a panel, a heading with nothing
            under it. A hard edge there reads as a picture that was cropped
            badly. Faded out over its last seventh, it reads as a screen that
            carries on — which is true. No more than that: the till's total
            and its Pay button sit low on the screen, and a longer fade took
            the one figure the picture is there to show. The border is a real
            border and not a ring so that it fades with the rest; a ring is
            drawn outside the box and a mask would simply cut it off. */}
        <div className="relative origin-bottom transition-transform duration-700 ease-out [mask-image:linear-gradient(to_bottom,black_0%,black_86%,transparent_100%)] sm:[transform:rotateX(11deg)] motion-safe:sm:hover:[transform:rotateX(2deg)]">
          <div className="overflow-hidden rounded-t-2xl border border-b-0 border-white/15 bg-gray-900 sm:rounded-t-3xl">
            {/* The window's bar: three lights and an address. A drawing of a
                window, kept thin — the screen is the point. */}
            <div aria-hidden="true" className="flex items-center gap-3 border-b border-white/10 bg-gray-950 px-4 py-2.5">
              <span className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-white/20" />
                <span className="size-2.5 rounded-full bg-white/20" />
              </span>
              <span className="mx-auto hidden h-6 w-72 items-center justify-center rounded-md bg-white/5 text-[11px] text-white/40 sm:flex">
                your-shop · {address}
              </span>
              <span className="hidden w-10 sm:block" />
            </div>

            {/* The frame holds its shape from the first paint — `aspect-*` —
                so nothing below it moves when the picture arrives. */}
            <div className="relative aspect-[402/600] bg-gray-950 sm:aspect-[16/10]">
              <picture>
                <source media="(max-width: 639px)" srcSet={`/landing/${shot}-phone.webp`} />
                <source
                  srcSet={`/landing/${shot}-1280.webp 1280w, /landing/${shot}.webp 2560w`}
                  sizes="(min-width: 1280px) 1152px, 100vw"
                />
                <img
                  src={`/landing/${shot}-1280.webp`}
                  width={1280}
                  height={800}
                  loading={first ? "eager" : "lazy"}
                  fetchPriority={first ? "high" : "auto"}
                  decoding="async"
                  alt={alt}
                  className="absolute inset-0 size-full object-cover object-top"
                />
              </picture>
            </div>
          </div>
        </div>
      </div>

      {/* THE SAME SCREEN, IN A HAND. From `md` up, where there is a margin
          for it to stand in. It is a second picture of what the window
          already shows — decorative — so it says nothing to a screen reader
          that the window has not said. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-3 top-[24%] hidden w-[10.5rem] md:block lg:-right-10 lg:w-[12.5rem] xl:-right-16"
      >
        <div className="rounded-[1.9rem] bg-gray-950 p-1.5 shadow-[0_30px_70px_-15px_rgba(0,0,0,0.8)] ring-1 ring-white/20">
          <div className="relative aspect-[402/874] overflow-hidden rounded-[1.5rem] bg-gray-900">
            <img
              src={`/landing/${shot}-phone.webp`}
              width={804}
              height={1748}
              loading={first ? "eager" : "lazy"}
              decoding="async"
              alt=""
              className="absolute inset-0 size-full object-cover object-top"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
