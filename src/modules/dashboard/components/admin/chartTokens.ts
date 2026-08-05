import { useMemo } from "react";
import { useTheme } from "../../../../context/ThemeContext";

/**
 * Chart colours are read from the live CSS custom properties instead of being
 * written into the chart config: a tenant's brand hue is remapped onto
 * --color-brand-* at runtime, so any literal would stop following the theme.
 */
const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface ChartTokens {
  /** Single-series marks (subscription revenue). */
  line: string;
  active: string;
  suspended: string;
  /**
   * Categorical slots in a FIXED order, assigned in sequence and never cycled.
   * The steps differ per mode so every slice clears the surface it sits on.
   */
  categorical: string[];
  /** The folded "Other" bucket — deliberately colourless. */
  neutral: string;
  axis: string;
  grid: string;
  /** Painted between adjacent marks so touching fills read as separate. */
  surface: string;
  ink: string;
  muted: string;
  tooltip: "light" | "dark";
  fontFamily: string;
}

export function useChartTokens(): ChartTokens {
  const { theme } = useTheme();

  return useMemo<ChartTokens>(() => {
    const dark = theme === "dark";

    return {
      line: token(dark ? "--color-brand-400" : "--color-brand-500"),
      active: token(dark ? "--color-brand-400" : "--color-brand-500"),
      suspended: token("--color-error-500"),
      categorical: [
        token("--color-brand-500"),
        token("--color-success-600"),
        token("--color-warning-500"),
        token("--color-error-500"),
        token(dark ? "--color-brand-300" : "--color-brand-400"),
      ],
      neutral: token("--color-gray-400"),
      axis: token(dark ? "--color-gray-400" : "--color-gray-500"),
      grid: token(dark ? "--color-gray-800" : "--color-gray-200"),
      surface: token(dark ? "--color-gray-900" : "--color-white"),
      ink: token(dark ? "--color-white" : "--color-gray-800"),
      muted: token(dark ? "--color-gray-400" : "--color-gray-500"),
      tooltip: dark ? "dark" : "light",
      fontFamily: "Outfit, sans-serif",
    };
  }, [theme]);
}
