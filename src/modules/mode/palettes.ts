import React from "react";
import { emberThemes, leafThemes, type ThemeColors, type ThemeName } from "../../theme";
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
 * ── The mapping, and it has been turned over once already ────────────
 *
 * SHOPPING IS LEAF GREEN and working is EMBER ORANGE, decided after seeing
 * both on a phone. The palettes are named for their COLOURS rather than for
 * their side precisely so this can be reversed again without every name in
 * the codebase becoming a lie — which is exactly what happened the first
 * time, and is why the splash screen shipped painting the rider's orange on
 * a green app.
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
      paletteFor: (name: ThemeName) => (mode === "rider" ? emberThemes : leafThemes)[name],
      oppositePaletteFor: (name: ThemeName) => (mode === "rider" ? leafThemes : emberThemes)[name],
    }),
    [mode],
  );
}
