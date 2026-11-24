import { HERO_PICTURE_DEFAULT, readsUnderWhite } from "../heroColor";

/**
 * THE TOP OF THE APP'S HOME, BUILT AS THE ADMIN TYPES.
 *
 * "real time nzr aye bnta huwa banner on admin side": every field of a
 * top-header banner changes this at once — the colour floods the whole block
 * (status bar, address, search, slide, curve) the way it does on a phone, and
 * the picture grows and shrinks with its slider.
 *
 * Drawn at 1 CSS pixel = 1 app point on a 360-point phone, with the numbers
 * `HomeHero` uses: 16 in from the edge, a 24/30 heavy title, a 132-point
 * slide, a 2:1 artwork slide edge to edge. If those change there, change them
 * here — this is a picture of that file.
 */

export const PHONE_WIDTH = 360;
const SLIDE = 132;

interface Props {
  colour: string;
  style: "words" | "artwork";
  title: string;
  body: string;
  cta: string;
  /** An object URL for a newly picked file, or the saved image. */
  picture: string | null;
  pictureSize: number;
}

export default function HeroBannerPreview({ colour, style, title, body, cta, picture, pictureSize }: Props) {
  const ground = readsUnderWhite(colour) ? colour : "#9ca3af";
  const size = pictureSize || HERO_PICTURE_DEFAULT;
  const slideHeight = style === "artwork" ? PHONE_WIDTH / 2 : Math.max(SLIDE, size + 12);

  return (
    <div className="flex flex-col items-center">
      <p className="mb-1.5 self-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
        On the app · top of home, live
      </p>
      <div
        className="overflow-hidden rounded-[28px] border-[6px] border-gray-900 bg-white shadow-lg"
        style={{ width: PHONE_WIDTH + 12 }}
        data-testid="hero-preview"
      >
        <div style={{ backgroundColor: ground, transition: "background-color 200ms" }}>
          {/* The status bar, on the same colour. */}
          <div className="flex h-6 items-center justify-between px-4 text-[11px] font-semibold text-white/90">
            <span>9:41</span>
            <span>▮▮▮ ●</span>
          </div>

          {/* Address and search, as `CustomerHomeScreen` draws them. */}
          <div className="px-4 pb-2 pt-1">
            <div className="text-[10px] font-bold tracking-wider text-white/75">DELIVER TO</div>
            <div className="truncate text-[15px] font-bold text-white">Gulberg III, Lahore</div>
            <div className="mt-2 flex h-10 items-center gap-2 rounded-xl bg-white px-3 text-[13px] text-gray-400">
              <span aria-hidden>⌕</span> Search food, groceries, medicine…
            </div>
          </div>

          {/* The slide. */}
          {style === "artwork" ? (
            <div style={{ width: PHONE_WIDTH, height: slideHeight }} className="relative">
              {picture ? (
                <img src={picture} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/80">
                  Upload a 1200×600 image
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 pb-[18px] pt-2" style={{ minHeight: slideHeight + 26 }}>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="text-[24px] font-extrabold leading-[30px] text-white [overflow-wrap:anywhere]" style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {title || "Your headline here"}
                </div>
                {!!body && <div className="text-[13px] leading-[18px] text-white/85 line-clamp-2">{body}</div>}
                {!!cta && (
                  <span className="mt-1 self-start rounded-full bg-white px-3.5 py-1.5 text-[13px] font-bold" style={{ color: ground }}>
                    {cta}
                  </span>
                )}
              </div>
              {picture && (
                <img
                  src={picture}
                  alt=""
                  className="shrink-0 object-contain"
                  style={{ width: size, height: size }}
                />
              )}
            </div>
          )}

          {/* The dots sit on the slide's bottom edge. */}
          <div className="relative -mt-4 flex justify-center pb-2">
            <span className="flex gap-1 rounded-lg bg-white/90 px-2 py-1">
              <span className="h-[5px] w-[22px] rounded bg-gray-900" />
              <span className="h-[5px] w-[5px] rounded bg-gray-300" />
              <span className="h-[5px] w-[5px] rounded bg-gray-300" />
            </span>
          </div>
        </div>

        {/* The curve the block ends in. */}
        <div className="h-[26px] overflow-hidden">
          <div
            className="mx-auto -mt-[26px] h-[52px] rounded-b-[50%]"
            style={{ backgroundColor: ground, width: "160%", marginLeft: "-30%" }}
          />
        </div>
        <div className="space-y-2 px-4 pb-4">
          <div className="h-3 w-24 rounded bg-gray-200" />
          <div className="flex gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 flex-1 rounded-xl bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
