import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/**
 * THE TRUE SERVE MARK, IN ITS THREE PIECES — drawn, not a picture.
 *
 * "Logo ko pieces main divide krk sath jod skty? open krny py splash main."
 * The mark is three shapes: the short bar on the left, the big bar that bends
 * into the stem, and the round foot under it. As vectors they can be moved
 * one by one, so the splash assembles the logo instead of fading a PNG in.
 *
 * Traced from `assets/brand/mark.png` (778 × 557). On a dark ground the short
 * bar is white; on the white splash it takes the deep brand teal instead, or
 * it would vanish.
 */
export const MARK_W = 778;
export const MARK_H = 557;

export const MARK_PIECES = {
  /** The short bar, top left. */
  bar: "M82 0 H352 Q376 0 360 18 L240 148 Q225 165 204 165 H82 A82.5 82.5 0 0 1 82 0 Z",
  /** The big bar along the top, bending down into the stem. */
  stem: "M442 0 H696 A82.5 82.5 0 0 1 696 165 H524 Q504 165 490 179 L270 401 Q256 415 246 399 V200 Q246 184 258 172 L420 9 Q429 0 442 0 Z",
  /** The round foot under the stem. */
  foot: "M499 219 Q520 204 520 232 V418 A139 139 0 0 1 254 466 Z",
} as const;

export type MarkPiece = keyof typeof MARK_PIECES;

/** One piece on its own canvas the size of the whole mark, so pieces stack exactly. */
export function MarkPieceSvg({ piece, size, barColor }: { piece: MarkPiece; size: number; barColor: string }) {
  const h = (size * MARK_H) / MARK_W;
  return (
    <Svg width={size} height={h} viewBox={`0 0 ${MARK_W} ${MARK_H}`} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`g-${piece}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#3ACFC8" />
          <Stop offset="1" stopColor="#22A9B5" />
        </LinearGradient>
      </Defs>
      <Path d={MARK_PIECES[piece]} fill={piece === "bar" ? barColor : `url(#g-${piece})`} />
    </Svg>
  );
}

/** The whole mark, still — for anywhere the logo is simply shown. */
export function BrandMark({ size, barColor }: { size: number; barColor: string }) {
  return (
    <View style={{ width: size, height: (size * MARK_H) / MARK_W }}>
      {(Object.keys(MARK_PIECES) as MarkPiece[]).map((p) => (
        <MarkPieceSvg key={p} piece={p} size={size} barColor={barColor} />
      ))}
    </View>
  );
}
