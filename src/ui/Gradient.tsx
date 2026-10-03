import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useColors } from "../theme";

/**
 * A block filled with the theme's own ramp.
 *
 * ── Why this exists at all, after a note saying it should not ────────
 *
 * `PromoCarousel` carries the opposite decision in writing: *"a flat
 * translucent black rather than a gradient: a gradient needs
 * `react-native-linear-gradient`, which is a native module and a rebuild,
 * for an effect nobody would name if it were missing."*
 *
 * Both halves of that sentence have since stopped being true.
 *
 *   the cost   `react-native-svg` has been a dependency of both apps for
 *              months and draws gradients natively. There is no new module
 *              and no rebuild — the thing that was expensive is already paid
 *              for.
 *   the gain   the palette changed. The old brand was ONE hue, where a
 *              gradient really is decoration. This one is a ten-step ramp
 *              from a lime to an ocean whose defining property is that it
 *              travels — `tokens.ts` says so, and a palette like that drawn
 *              only as flat swatches is a palette with its argument removed.
 *
 * So: not "we can do gradients now", but "this specific palette has a
 * gradient in it and nothing was drawing it".
 *
 * ── It reads the THEME, not a token ──────────────────────────────────
 *
 * Default `colors.gradient`, which is three stops the current theme chose —
 * see `ThemeColors.gradient` for why a dark theme needs its own. A caller may
 * pass its own stops; a caller that passes raw hexes from `tokens.ts` has
 * written a light gradient that will glow on a dark page, which is the bug
 * this default exists to make unlikely.
 */

export type GradientDirection = "diagonal" | "vertical" | "horizontal";

/**
 * Unit coordinates in the SVG's own box, so the angle is independent of the
 * block's pixel size. A 48pt chip and a 240pt header get the same ramp rather
 * than the chip getting a slice of one.
 */
const VECTORS: Record<GradientDirection, { x1: string; y1: string; x2: string; y2: string }> = {
  diagonal: { x1: "0", y1: "0", x2: "1", y2: "1" },
  vertical: { x1: "0", y1: "0", x2: "0", y2: "1" },
  horizontal: { x1: "0", y1: "0", x2: "1", y2: "0" },
};

let seq = 0;

export function Gradient({
  children,
  style,
  colors,
  direction = "diagonal",
  /**
   * Reversed, for a block whose text sits at the TOP.
   *
   * The ramp is written light-to-dark because that is the order the reference
   * strip reads in. A header with a title in the top-left wants its darkest
   * corner there instead, and reversing is cheaper to read at the call site
   * than a second set of stops that could drift from the first.
   */
  reverse = false,
  /** Matches the parent's own radius — SVG does not inherit `overflow`. */
  borderRadius = 0,
  pointerEvents,
  testID,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  colors?: readonly string[];
  direction?: GradientDirection;
  reverse?: boolean;
  borderRadius?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}) {
  const c = useColors();
  const stops = colors ?? c.gradient;
  const ordered = reverse ? [...stops].reverse() : stops;

  /**
   * A FRESH ID PER MOUNT, and this is not paranoia.
   *
   * SVG gradient ids share one document-wide namespace. Two `<Gradient>`s on
   * one screen with the same id means the second definition wins and BOTH
   * blocks draw it — a shop hero and an offer chip rendering the same ramp at
   * the same angle, which looks like a theming bug rather than a collision.
   */
  const id = React.useMemo(() => `grad${(seq += 1)}`, []);
  const v = VECTORS[direction];

  return (
    <View style={[{ borderRadius, overflow: "hidden" }, style]} pointerEvents={pointerEvents} testID={testID}>
      {/*
        BEHIND the children, filled absolutely, and NOT touchable.

        `StyleSheet.absoluteFill` with `pointerEvents="none"` so a button
        drawn on a gradient header is still a button — an SVG laid over a
        Pressable swallows the press and the control simply stops working.
      */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
            {ordered.map((stop, i) => (
              <Stop
                key={`${stop}-${i}`}
                // Evenly spaced. Three stops become 0 / 0.5 / 1, which is the
                // ramp's own shape — see `gradients` in `tokens.ts`.
                offset={ordered.length === 1 ? "0" : String(i / (ordered.length - 1))}
                stopColor={stop}
                stopOpacity="1"
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}
