export { brand, cream, gray, ink, radius, shadow, spacing, typography, warm, type ColorScale } from "./tokens";
export { darkColors, lightColors, themes, type ThemeColors, type ThemeName } from "./themes";
export {
  ThemeProvider,
  useColors,
  useTheme,
  type Theme,
  type ThemePreference,
} from "./ThemeProvider";

/**
 * There is no static palette export any more.
 *
 * `colors` used to live here as the light theme, frozen — the escape hatch for
 * screens written before dark mode worked. Every one of them has been migrated,
 * and the hatch is gone rather than merely unused: an export like that is not
 * neutral, it is a trap. A screen that imports it compiles, renders, looks
 * correct to whoever wrote it, and is stuck in light mode for ever on somebody
 * else's phone.
 *
 * Deleting it turns a rule that had to be policed by a test into one the
 * compiler enforces. Read colours with `useColors()`.
 */

