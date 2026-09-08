import React from "react";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { useTheme } from "../../theme";

/**
 * COLOURED TILE ART, the way a delivery app draws its categories.
 *
 * ── What this replaces, and what it costs ────────────────────────────
 *
 * The tiles were one Phosphor glyph each, all in `c.primary`, on one
 * `brand[100]` plate. That is a coherent row and it is deliberately quiet —
 * the note in `tradeIcon.tsx` says why: six hues would be six accents, and a
 * screen with six accents has none.
 *
 * Asked for the other thing: flat illustrated icons per category, like the
 * apps people already use. That IS the convention for a marketplace home
 * screen, and the reason it works there is that the tiles are the top of the
 * funnel — colour is what lets somebody find "pharmacy" without reading.
 *
 * So the row is louder on purpose now, and the accent discipline moves down
 * the page: everything BELOW these tiles still has exactly one.
 *
 * ── Why drawn here rather than shipped as images ─────────────────────
 *
 * Stock vector packs were the starting point and are the wrong medium twice
 * over. Their free tiers forbid redistribution inside an application, and they
 * arrive as raster or as editor files — twelve categories at three densities
 * is thirty-six files in the APK and thirty-six decodes on the home screen.
 *
 * These are `react-native-svg` primitives: circles, rectangles and a few
 * arcs. No network, no asset pipeline, no licence, a few hundred bytes each,
 * and they take a size rather than a density. `react-native-svg` is already a
 * dependency — the whole icon set is built on it.
 *
 * ── Why geometry rather than traced path data ────────────────────────
 *
 * Hand-authored `d="M…"` cannot be reviewed by reading it, and I cannot see
 * the result. Composed shapes can be reasoned about exactly: a wheel is a
 * circle at a stated centre with a stated radius. Every number below is in a
 * 48-unit box, so a coordinate is a percentage with the decimal moved.
 *
 * ── The grounds come in pairs ────────────────────────────────────────
 *
 * Same arrangement as `shopCover`: a light tint for a light theme and a
 * deeper, desaturated one for a dark theme. A pastel plate that ignored the
 * theme would be a row of bright patches at midnight.
 */

const B = 48; // the box every shape below is drawn in

/** The palette these are drawn from — the brand's own scales, named. */
const P = {
  orange: "#e94e00",
  orangeMid: "#fb7331",
  orangeSoft: "#ffc3a2",
  amber: "#ebc249",
  amberSoft: "#f5dc94",
  green: "#80b931",
  greenSoft: "#b4d97a",
  ink: "#221711",
  inkSoft: "#5d544f",
  paper: "#fffdfa",
  red: "#d92d20",
  blue: "#2e90fa",
  blueSoft: "#a6d4fd",
} as const;

export interface TileArtProps {
  size?: number;
}

export interface TileArt {
  /** The plate colour behind it: [light theme, dark theme]. */
  ground: readonly [string, string];
  Art: (props: TileArtProps) => React.JSX.Element;
}

/** Every drawing sits in the same box, so one wrapper serves all of them. */
const box = (size: number) => ({ width: size, height: size, viewBox: `0 0 ${B} ${B}` });

// ── Trades ───────────────────────────────────────────────────────────

/** A burger: dome, filling, base. Read at 24pt by the dome alone. */
const Food: TileArt = {
  ground: ["#fff1e6", "#3a2517"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* The dome. An arc across the top half, flat along its own base. */}
      <Path d="M8 21a16 16 0 0 1 32 0z" fill={P.orangeMid} />
      {/* Sesame — three, off-centre, because a symmetric three reads as a face. */}
      <Circle cx="18" cy="14" r="1.5" fill={P.paper} />
      <Circle cx="26" cy="11" r="1.5" fill={P.paper} />
      <Circle cx="32" cy="16" r="1.5" fill={P.paper} />
      {/* Lettuce, then the patty. */}
      <Rect x="7" y="21" width="34" height="4" rx="2" fill={P.green} />
      <Rect x="8" y="25" width="32" height="5" rx="2" fill={P.ink} />
      {/* The base, squarer than the dome so the stack has a bottom. */}
      <Path d="M8 30h32v3a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z" fill={P.orange} />
    </Svg>
  ),
};

/** A basket: tapered body, slats, handle. */
const Mart: TileArt = {
  ground: ["#f2f8e6", "#28331a"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* The handle, an arc with no fill. */}
      <Path d="M17 18v-3a7 7 0 0 1 14 0v3" stroke={P.inkSoft} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* The body: wider at the rim than at the base. */}
      <Path d="M9 18h30l-3.5 17a3 3 0 0 1-3 2.4H15.5a3 3 0 0 1-3-2.4z" fill={P.green} />
      <Rect x="8" y="16" width="32" height="4" rx="2" fill={P.greenSoft} />
      {/* Two slats, so it is a basket and not a bucket. */}
      <Rect x="19" y="23" width="2.4" height="10" rx="1.2" fill={P.paper} opacity={0.65} />
      <Rect x="26.6" y="23" width="2.4" height="10" rx="1.2" fill={P.paper} opacity={0.65} />
    </Svg>
  ),
};

/** A capsule on the diagonal, split into two halves. */
const Pharmacy: TileArt = {
  ground: ["#e8f3ff", "#16283a"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* One rounded bar rotated 45°, drawn as two halves that meet. */}
      <Path
        d="M14.4 24.9 24.9 14.4a7.4 7.4 0 0 1 10.5 10.5L24.9 35.4A7.4 7.4 0 0 1 14.4 24.9z"
        fill={P.blueSoft}
      />
      {/* The lower-left half in the stronger tone — the seam is the diagonal. */}
      <Path d="M14.4 24.9 24.9 14.4l10.5 10.5L24.9 35.4z" fill={P.blue} />
      {/* A cross, small, so a capsule reads as medicine and not as a pill box. */}
      <Rect x="27.4" y="19.6" width="6" height="2" rx="1" fill={P.paper} />
      <Rect x="29.4" y="17.6" width="2" height="6" rx="1" fill={P.paper} />
    </Svg>
  ),
};

/** A shopping bag: body, handle, fold. */
const Retail: TileArt = {
  ground: ["#fff1e6", "#3a2517"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      <Path d="M18 17v-2a6 6 0 0 1 12 0v2" stroke={P.inkSoft} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Path d="M11 17h26a2 2 0 0 1 2 2.2l-2 17A3 3 0 0 1 34 39H14a3 3 0 0 1-3-2.8l-2-17A2 2 0 0 1 11 17z" fill={P.orange} />
      {/* A lighter band across the top, which is what makes it a bag and not a
          box: a paper bag's rim catches the light. */}
      <Path d="M9.2 19.2 9 17h30l-.2 2.2z" fill={P.orangeSoft} />
    </Svg>
  ),
};

/** An adjustable spanner. */
const Services: TileArt = {
  ground: ["#eef1f4", "#25292e"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* The shaft, corner to corner. */}
      <Rect
        x="21.5"
        y="12"
        width="5"
        height="26"
        rx="2.5"
        fill={P.inkSoft}
        transform="rotate(-35 24 24)"
      />
      {/* The jaw: a ring with a bite taken out by a square of the ground. */}
      <Circle cx="16.4" cy="16.4" r="7" fill={P.inkSoft} />
      <Circle cx="16.4" cy="16.4" r="3.2" fill={P.paper} />
      <Rect x="9.4" y="9.4" width="6" height="6" fill={P.paper} transform="rotate(-35 12.4 12.4)" />
      {/* The other end, plain, so the tool has a handle. */}
      <Circle cx="33" cy="33" r="4.2" fill={P.amber} />
    </Svg>
  ),
};

/** A car from the side. */
const Automotive: TileArt = {
  ground: ["#eaf1ff", "#1b2333"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* Cabin, then the body — the roof sits inside the body's width. */}
      <Path d="M15 22l3.2-5.4A3 3 0 0 1 20.8 15h6.4a3 3 0 0 1 2.6 1.6L33 22z" fill={P.blueSoft} />
      <Path d="M8 23h32a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z" fill={P.orange} />
      {/* Wheels, on the body's own baseline. */}
      <Circle cx="15" cy="33" r="4.6" fill={P.ink} />
      <Circle cx="15" cy="33" r="1.8" fill={P.paper} />
      <Circle cx="33" cy="33" r="4.6" fill={P.ink} />
      <Circle cx="33" cy="33" r="1.8" fill={P.paper} />
    </Svg>
  ),
};

/** A fuel pump with its hose. */
const Petroleum: TileArt = {
  ground: ["#fdf6e2", "#332a10"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* The hose first, so the body covers where it joins. */}
      <Path d="M31 20h4a3 3 0 0 1 3 3v11" stroke={P.inkSoft} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Rect x="12" y="11" width="18" height="27" rx="3" fill={P.amber} />
      {/* The window — the readout every pump has. */}
      <Rect x="15.5" y="14.5" width="11" height="7" rx="1.5" fill={P.paper} />
      {/* The nozzle bay. */}
      <Rect x="15.5" y="25" width="8" height="3" rx="1.5" fill={P.ink} opacity={0.55} />
      <Circle cx="38" cy="35" r="3" fill={P.orange} />
    </Svg>
  ),
};

/** A bank: pediment and columns. */
const Finance: TileArt = {
  ground: ["#f2f8e6", "#28331a"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* The roof, a triangle wider than the building under it. */}
      <Path d="M24 9 42 19H6z" fill={P.green} />
      <Rect x="9" y="19" width="30" height="3" rx="1.5" fill={P.greenSoft} />
      {/* Three columns, evenly spaced inside the roof's footprint. */}
      <Rect x="13" y="23" width="4" height="12" rx="1" fill={P.inkSoft} />
      <Rect x="22" y="23" width="4" height="12" rx="1" fill={P.inkSoft} />
      <Rect x="31" y="23" width="4" height="12" rx="1" fill={P.inkSoft} />
      <Rect x="8" y="35" width="32" height="4" rx="2" fill={P.green} />
    </Svg>
  ),
};

/** A shopfront with an awning — the fallback, and the "general store" tile. */
const General: TileArt = {
  ground: ["#fff1e6", "#3a2517"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      <Rect x="10" y="20" width="28" height="19" rx="2" fill={P.orangeSoft} />
      {/* The awning: one bar, then two stripes over it, so it reads striped
          without four separate shapes. */}
      <Path d="M8 13h32l3 7H5z" fill={P.orange} />
      <Rect x="17.5" y="13" width="4.5" height="7" fill={P.paper} opacity={0.55} />
      <Rect x="28" y="13" width="4.5" height="7" fill={P.paper} opacity={0.55} />
      {/* A doorway, off to one side — centred it reads as a garage. */}
      <Rect x="14" y="27" width="9" height="12" rx="1" fill={P.ink} opacity={0.6} />
      <Rect x="27" y="26" width="8" height="7" rx="1" fill={P.paper} opacity={0.75} />
    </Svg>
  ),
};

// ── The four ways to shop ────────────────────────────────────────────

/** A price tag. */
const Offers: TileArt = {
  ground: ["#fdf6e2", "#332a10"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      <Path
        d="M24.6 8.6h11.8a3 3 0 0 1 3 3v11.8a3 3 0 0 1-.9 2.1L26.6 38.5a3 3 0 0 1-4.2 0L9.5 25.6a3 3 0 0 1 0-4.2L22.5 9.5a3 3 0 0 1 2.1-.9z"
        fill={P.amber}
      />
      {/* The eyelet — a tag with no hole is a rounded square. */}
      <Circle cx="32.4" cy="15.6" r="3" fill={P.paper} />
    </Svg>
  ),
};

/** Three coins, seen low. */
const Cheap: TileArt = {
  ground: ["#f2f8e6", "#28331a"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* Bottom to top, so each overlaps the one below it. */}
      <Ellipse cx="24" cy="32" rx="13" ry="5.2" fill={P.green} />
      <Ellipse cx="24" cy="26" rx="13" ry="5.2" fill={P.greenSoft} />
      <Ellipse cx="24" cy="20" rx="13" ry="5.2" fill={P.green} />
      <Ellipse cx="24" cy="19" rx="6" ry="2.4" fill={P.paper} opacity={0.7} />
    </Svg>
  ),
};

/** A sparkle, with two smaller ones. */
const NewIn: TileArt = {
  ground: ["#fff1e6", "#3a2517"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      {/* Four-pointed: each arm is a quadratic curve into the centre. */}
      <Path
        d="M22 8q2 12 14 14-12 2-14 14-2-12-14-14 12-2 14-14z"
        fill={P.orange}
      />
      <Path d="M37 28q.9 5 5 6-4 1-5 6-1-5-5-6 4-1 5-6z" fill={P.orangeMid} />
      <Path d="M38.5 8.5q.6 3.4 3.5 4-2.9.7-3.5 4-.6-3.3-3.5-4 2.9-.6 3.5-4z" fill={P.amber} />
    </Svg>
  ),
};

/** A star. */
const TopRated: TileArt = {
  ground: ["#fdf6e2", "#332a10"],
  Art: ({ size = 26 }) => (
    <Svg {...box(size)}>
      <Path
        d="M24 7.5l5.1 10.4 11.4 1.7-8.2 8 1.9 11.4L24 33.6l-10.2 5.4 1.9-11.4-8.2-8 11.4-1.7z"
        fill={P.amber}
      />
      {/* A lighter inner star would need a second polygon; a soft highlight on
          one arm does the same job with one shape. */}
      <Path d="M24 7.5l5.1 10.4-5.1 2z" fill={P.amberSoft} />
    </Svg>
  ),
};

/**
 * Trade code → art. The legacy codes point at the same drawing as the current
 * one they map to, exactly as `tradeIcon` does: a shop created before the
 * current set still has to have a picture.
 */
const BY_TRADE: Record<string, TileArt> = {
  food: Food,
  mart: Mart,
  pharmacy: Pharmacy,
  retail: Retail,
  services: Services,
  automotive: Automotive,
  petroleum: Petroleum,
  finance: Finance,
  online: Retail,

  restaurant: Food,
  bakery: Food,
  grocery: Mart,
  wholesale: Mart,
  clinic: Pharmacy,
  salon: Services,
  service: Services,
  workshop: Automotive,
  hardware: General,
  books: General,
  general: General,
};

/** Shortcut key → art. Keys match `SHORTCUTS` in `tradeIcon.tsx`. */
const BY_SHORTCUT: Record<string, TileArt> = {
  offers: Offers,
  cheap: Cheap,
  new: NewIn,
  top: TopRated,
};

/**
 * The art for a trade, and the plate it sits on.
 *
 * Falls back to the shopfront rather than to null. A tile with no picture is a
 * blank square on the home screen, and a trade this app has not heard of is
 * still a shop.
 */
export function tradeArt(type: string | null | undefined): TileArt {
  return BY_TRADE[(type ?? "").toLowerCase()] ?? General;
}

export function shortcutArt(key: string): TileArt | null {
  return BY_SHORTCUT[key] ?? null;
}

/**
 * The plate colour for the theme that is on.
 *
 * A hook rather than a constant for the same reason `useShopCover` is one: the
 * pastel that reads as a tint at noon is a bright patch at midnight, so each
 * ground carries both and this picks.
 */
export function useTileGround(): (art: TileArt) => string {
  const { isDark } = useTheme();

  return React.useCallback((art: TileArt) => art.ground[isDark ? 1 : 0], [isDark]);
}
