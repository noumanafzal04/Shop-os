import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance } from "react-native";
import { riderThemes, themes, type ThemeColors, type ThemeName } from "./themes";
import { useModeStore } from "../stores/modeStore";
import { radius, shadow, spacing, typography } from "./tokens";

/**
 * Theme, and the one hook everything reads it through.
 *
 * `preference` is what the user chose — including "system", which is the
 * default because a phone that is already in dark mode at 11pm should not be
 * argued with. `name` is what that resolves to right now. Keeping the two apart
 * is what lets the app follow the OS *and* remember an explicit override.
 */

export type ThemePreference = ThemeName | "system";

export interface Theme {
  name: ThemeName;
  isDark: boolean;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
  shadow: typeof shadow;
}

interface ThemeContextValue extends Theme {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** What the OS reports. Narrower than RN's ColorSchemeName, which also
 *  admits `undefined` and makes the state setter ambiguous. */
type SystemScheme = "light" | "dark" | null;

/** RN reports "light" | "dark" | "unspecified" | null | undefined. Anything
 *  that is not explicitly dark is treated as light. */
const normalise = (scheme: unknown): SystemScheme => (scheme === "dark" ? "dark" : scheme === "light" ? "light" : null);

const resolve = (pref: ThemePreference, system: SystemScheme): ThemeName =>
  pref === "system" ? (system === "dark" ? "dark" : "light") : pref;

export function ThemeProvider({
  children,
  initialPreference = "system",
  onPreferenceChange,
}: {
  children: ReactNode;
  /** Restored from storage at boot, so the app doesn't flash the wrong theme. */
  initialPreference?: ThemePreference;
  /** Persist the choice. Kept as a callback so this file owns no storage. */
  onPreferenceChange?: (p: ThemePreference) => void;
}) {
  const [preference, setPref] = useState<ThemePreference>(initialPreference);
  const [system, setSystem] = useState<SystemScheme>(normalise(Appearance.getColorScheme()));

  // Follow the OS while the app is open — someone flipping their phone to dark
  // at dusk expects this screen to follow without a restart.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(normalise(colorScheme)));
    return () => sub.remove();
  }, []);

  /**
   * WHICH HALF OF THE APP IS ON SCREEN.
   *
   * The mode swaps the whole navigator, and now it swaps the palette with it:
   * the shopping side is the brand's red-orange, the working side is green.
   * Read here rather than threaded through every screen, because a colour that
   * some screens knew about and others did not would be worse than one colour.
   *
   * Subscribed to the STORE, not to a prop — `ModeSwitchCover` holds a cover
   * over the swap for a few hundred milliseconds, so the repaint happens while
   * nothing is visible.
   */
  const mode = useModeStore((s) => s.mode);

  const value = useMemo<ThemeContextValue>(() => {
    const name = resolve(preference, system);
    const palette = mode === "rider" ? riderThemes : themes;

    return {
      name,
      isDark: name === "dark",
      colors: palette[name],
      spacing,
      radius,
      typography,
      shadow,
      preference,
      setPreference: (p) => {
        setPref(p);
        onPreferenceChange?.(p);
      },
    };
  }, [preference, system, mode, onPreferenceChange]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The only way a component should learn a colour.
 *
 * Throws rather than falling back to light: a silent default would mean a whole
 * subtree renders in the wrong theme and nobody finds out until a screenshot.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Just the colours, for the common case. */
export function useColors(): ThemeColors {
  return useTheme().colors;
}
