import React from "react";
import { StatusBar, type StatusBarStyle } from "react-native";
import { useIsFocused } from "@react-navigation/native";

/**
 * Per-screen status bar that only applies while its screen is focused — tab
 * screens stay mounted, so a plain `<StatusBar>` would leak its style to
 * sibling tabs.
 *
 * ── `style` IS DERIVED NOW, and that is a bug fix ────────────────────
 *
 * It used to be required, and five screens answered it five different ways:
 *
 *   home          `isDark ? "light" : "dark"`  — followed the theme
 *   shop page     `"dark-content"`             — black glyphs, always
 *   market        `"light-content"` on `brand[500]`
 *   account       `"light-content"` on `primary`
 *   rider         `isDark ? "light" : "dark"`
 *
 * Three of those are wrong on at least one theme, and the shop page was the
 * visible one: near-black glyphs on a near-black page, so the clock and the
 * battery simply disappeared in dark mode. The market and account screens
 * have the same defect pointing the other way — their ground is the brand,
 * and on the dark palette the brand is a bright #4bb3d4 that white glyphs
 * cannot be read on.
 *
 * The shape of the bug is worth naming: the polarity is a FACT ABOUT THE
 * GROUND, and every call site was being asked to restate it. A caller that
 * restates a derivable fact is a caller that can get it wrong, and five of
 * them means five chances.
 *
 * So `background` decides. `style` stays, as an override for the one case
 * the rule cannot see — a ground this component is not being told about,
 * such as an image or a gradient whose first stop is not what is actually
 * behind the clock.
 */

/**
 * Relative luminance, WCAG. Four lines, because importing a colour library
 * into the shared layer for one ratio is a dependency every app then carries.
 *
 * Only `#rgb` and `#rrggbb` are understood. `rgba()` and a named colour both
 * return null, and null means "cannot tell" rather than a guess — see below
 * for what happens then.
 */
function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const h = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Which glyphs can be read on this ground.
 *
 * The threshold is the luminance at which white and black are equally legible
 * — about 0.179, where both measure 4.5:1. Below it white wins; above it,
 * black. That is one number rather than a per-screen opinion, and it is the
 * same number the rest of this codebase measures contrast with.
 */
export function glyphsFor(background: string | undefined): StatusBarStyle {
  const l = background == null ? null : luminance(background);

  // Unknown ground — `default` hands the decision back to the OS, which is
  // the honest answer and is what every screen got before this component
  // existed. Guessing "dark-content" here would reintroduce exactly the bug
  // this function was written for, on any screen using a translucent fill.
  if (l === null) return "default";

  return l < 0.179 ? "light-content" : "dark-content";
}

export function FocusedStatusBar({
  style,
  background,
}: {
  /** Only when the real ground is not `background` — an image, say. */
  style?: StatusBarStyle;
  background?: string;
}) {
  const focused = useIsFocused();
  if (!focused) return null;

  return <StatusBar barStyle={style ?? glyphsFor(background)} backgroundColor={background} animated />;
}
