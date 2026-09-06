import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

/**
 * THE FIVE GLYPHS AT THE FOOT OF THE APP.
 *
 * ── Why these are drawn here and not imported ────────────────────────
 *
 * The complaint was "ye bht basic sy hain", and it was right, but the fault
 * was not the icon LIBRARY. Every slot in the bar was a thin monoline outline
 * in two greys, and the only difference between the tab you are on and the
 * four you are not was half a point of stroke width. Nothing in it was solid,
 * so nothing in it read as selected — which is the single thing a bottom bar
 * has to communicate.
 *
 * Every polished app of this kind answers that the same way: the selected tab
 * is FILLED and in the brand colour, the rest are outlines in grey. Lucide,
 * which the rest of the app uses and should keep using, is a monoline set with
 * no filled companions — filling one of its paths gives a blob, because the
 * shapes were drawn to be stroked.
 *
 * A second icon package was the obvious answer and was measured rather than
 * assumed:
 *
 *   phosphor-react-native  has the six weights this needs, and its barrel
 *                          eagerly requires 1,512 icon modules over 7.2 MB of
 *                          path data at startup. Its per-icon subpath export
 *                          points at raw `.tsx` that does not compile against
 *                          the react-native-svg in this app (`className`).
 *   vector-icon fonts      mean a native asset and a Gradle change, i.e. a
 *                          rebuild, for five glyphs.
 *
 * So: five, drawn on a 24 grid, each one silhouette that works BOTH ways —
 * stroked when the tab is not selected, filled when it is. `react-native-svg`
 * is already a dependency because Lucide needs it, so this costs one file.
 *
 * ── The rule each path obeys ─────────────────────────────────────────
 *
 * One closed outline carries the shape, and any detail INSIDE it is drawn
 * separately in `knockout` — the colour of whatever the icon sits on. That is
 * what lets the same path be an outline and a solid without a second drawing:
 * filled, the detail is punched back out of the shape rather than vanishing
 * into it.
 */

export interface TabIconProps {
  size?: number;
  color: string;
  /** Solid, for the tab you are on. */
  filled?: boolean;
  /**
   * What is BEHIND the icon, for the lines punched through a filled shape.
   * Omit and the detail is simply not drawn when filled, which is right for
   * shapes that carry no interior detail.
   */
  knockout?: string;
}

/** Shared setup, so eight icons cannot drift into eight stroke weights. */
function Frame({ size = 24, children }: { size?: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

/** The outline weight. Heavier than Lucide's default on purpose: at 22px a 1.8
 *  stroke reads as grey mist beside a solid, and the pair has to balance. */
const STROKE = 1.9;

const body = (filled: boolean, color: string) =>
  filled
    ? { fill: color, stroke: color, strokeWidth: 1, strokeLinejoin: "round" as const }
    : {
        fill: "none",
        stroke: color,
        strokeWidth: STROKE,
        strokeLinejoin: "round" as const,
        strokeLinecap: "round" as const,
      };

const detail = (filled: boolean, color: string, knockout?: string) => ({
  stroke: filled ? (knockout ?? "transparent") : color,
  strokeWidth: filled ? 1.7 : 1.6,
  strokeLinecap: "round" as const,
  fill: "none",
});

/**
 * HOME.
 *
 * The doorway is part of the outline rather than a second shape, so filling
 * the path leaves it as a notch instead of losing it.
 */
export function HomeGlyph({ size, color, filled = false }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M3.2 10.6 12 3.2l8.8 7.4v8.6a1.8 1.8 0 0 1-1.8 1.8h-3.9v-5.6a3.1 3.1 0 0 0-6.2 0v5.6H5a1.8 1.8 0 0 1-1.8-1.8z"
        {...body(filled, color)}
      />
    </Frame>
  );
}

/** GROCERY — a basket, never a trolley: the middle button is the trolley. */
export function BasketGlyph({ size, color, filled = false, knockout }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M8.2 9.6c0-3.1 1.7-5.6 3.8-5.6s3.8 2.5 3.8 5.6"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M3.4 9.6h17.2l-1.6 8.7a3 3 0 0 1-2.95 2.45H7.95A3 3 0 0 1 5 18.3z"
        {...body(filled, color)}
      />
      <Path d="M9.6 13.2v4M14.4 13.2v4" {...detail(filled, color, knockout)} />
    </Frame>
  );
}

/**
 * THE BASKET ITSELF — the middle button.
 *
 * Defaults to the OUTLINE like every other glyph here, even though the only
 * caller today asks for the solid. A set where six icons default one way and
 * the seventh defaults the other is a set whose next caller gets a surprise,
 * and the bar states `filled` explicitly anyway.
 */
export function CartGlyph({ size, color, filled = false, knockout }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M2.8 3.6h1.9a1.4 1.4 0 0 1 1.37 1.1L6.4 6.5"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M6.4 6.5h14.4l-1.55 7.6a2.4 2.4 0 0 1-2.35 1.92H9.6a2.4 2.4 0 0 1-2.35-1.9z"
        {...body(filled, color)}
      />
      <Circle cx={9.9} cy={19.6} r={1.7} fill={filled ? color : "none"} stroke={color} strokeWidth={filled ? 1 : STROKE} />
      <Circle cx={17.2} cy={19.6} r={1.7} fill={filled ? color : "none"} stroke={color} strokeWidth={filled ? 1 : STROKE} />
      <Path d="M11.2 9.4h4.8" {...detail(filled, color, knockout)} />
    </Frame>
  );
}

/** ORDERS — a receipt, torn along the bottom. */
export function ReceiptGlyph({ size, color, filled = false, knockout }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M5 3.4A1.4 1.4 0 0 1 6.4 2h11.2A1.4 1.4 0 0 1 19 3.4v17.4a.7.7 0 0 1-1.05.6L15.9 20.2l-2.05 1.2a.7.7 0 0 1-.7 0L11.1 20.2 9.05 21.4a.7.7 0 0 1-.7 0L6.3 20.2l-.25.15A.7.7 0 0 1 5 19.74z"
        {...body(filled, color)}
      />
      <Path d="M8.4 7.4h7.2M8.4 11.2h7.2M8.4 15h4.4" {...detail(filled, color, knockout)} />
    </Frame>
  );
}

/** ACCOUNT — head and shoulders, cropped by the frame like every app's. */
export function PersonGlyph({ size, color, filled = false }: TabIconProps) {
  return (
    <Frame size={size}>
      <Circle cx={12} cy={8} r={3.9} {...body(filled, color)} />
      <Path d="M4.4 20.6a7.6 7.6 0 0 1 15.2 0z" {...body(filled, color)} />
    </Frame>
  );
}

/** RIDER — a parcel, because a delivery is a thing carried and not a vehicle. */
export function ParcelGlyph({ size, color, filled = false, knockout }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M12 2.4 20.6 7v10L12 21.6 3.4 17V7z"
        {...body(filled, color)}
      />
      <Path d="M3.6 7.1 12 11.7l8.4-4.6M12 11.9v9.4" {...detail(filled, color, knockout)} />
    </Frame>
  );
}

/** EARNINGS — a wallet with the card showing. */
export function WalletGlyph({ size, color, filled = false, knockout }: TabIconProps) {
  return (
    <Frame size={size}>
      <Path
        d="M3.2 8a2.4 2.4 0 0 1 2.4-2.4h12.8A2.4 2.4 0 0 1 20.8 8v9.2a2.4 2.4 0 0 1-2.4 2.4H5.6a2.4 2.4 0 0 1-2.4-2.4z"
        {...body(filled, color)}
      />
      <Path d="M3.6 10.8h5.2a1.6 1.6 0 0 1 0 3.2H3.6" {...detail(filled, color, knockout)} />
    </Frame>
  );
}
