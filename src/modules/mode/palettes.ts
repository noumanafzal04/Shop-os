import React from "react";
import { carmineThemes, meadowThemes, type ThemeColors, type ThemeName } from "../../theme";
import { useModeStore } from "../../stores/modeStore";

/**
 * WHICH SIDE OF THIS APP WEARS WHICH COLOUR.
 *
 * ── Why this file exists at all ──────────────────────────────────────
 *
 * `ThemeProvider` used to answer this itself, by importing `modeStore`. That
 * was the one line tying the whole theme layer to THIS app: a mode is a
 * shopper who is sometimes a rider, and no other app has one. A second app
 * importing the provider would have dragged in a store it can never use.
 *
 * So the provider now asks, and this is the answer — the only file in the
 * product that knows the mapping.
 *
 * ── The mapping, and it has been turned over twice now ───────────────
 *
 * SHOPPING IS MEADOW and working is CARMINE (#ef4444). Meadow is the
 * ten-step lime-to-ocean strip in `tokens.ts`, given 2026-10-03; its primary
 * is the ocean #1a759f, because that is the lightest step of the strip a
 * white button label can still be read on. It replaced emerald #10b981,
 * which could not carry a white label at all. Before that it was leaf olive
 * and ember orange, and before THAT the two were the other way round.
 *
 * The palettes are named for their COLOURS rather than for their side
 * precisely so this keeps being reversible without every name in the codebase
 * becoming a lie — which is exactly what happened the first time, and is why
 * the splash screen once shipped painting the rider's orange on a green app.
 * Renaming the scales when the hue family moves is part of that bargain, not
 * an extra: `emerald` describing an ocean blue would have been the same lie.
 */
export interface ModePalettes {
  /** The colours this app is wearing now. */
  paletteFor: (name: ThemeName) => ThemeColors;
  /** The other side's, for the two controls that lead there. */
  oppositePaletteFor: (name: ThemeName) => ThemeColors;
}

export function useModePalettes(): ModePalettes {
  const mode = useModeStore((s) => s.mode);

  return React.useMemo(
    () => ({
      paletteFor: (name: ThemeName) => (mode === "rider" ? carmineThemes : meadowThemes)[name],
      oppositePaletteFor: (name: ThemeName) => (mode === "rider" ? meadowThemes : carmineThemes)[name],
    }),
    [mode],
  );
}
