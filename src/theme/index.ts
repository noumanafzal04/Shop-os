export { brand, cream, gray, ink, radius, shadow, spacing, typography } from "./tokens";
export { darkColors, lightColors, themes, type ThemeColors, type ThemeName } from "./themes";
export {
  ThemeProvider,
  useColors,
  useTheme,
  type Theme,
  type ThemePreference,
} from "./ThemeProvider";

import { lightColors } from "./themes";

/**
 * The light palette as a static export.
 *
 * @deprecated Use `useColors()` — a component reading this one is frozen in
 * light mode and will not follow the user's theme. It exists so the screens
 * written before dark mode keep working, and it should shrink to nothing as
 * they are touched. Anything new reads the hook.
 */
export const colors = lightColors;
