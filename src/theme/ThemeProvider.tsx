import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Appearance } from "react-native";
import { leafThemes, type ThemeColors, type ThemeName } from "./themes";
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
  /** The other side's colours, for the two doors that lead there. */
  opposite: ThemeColors;
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

/**
 * WHICH SET OF COLOURS, ASKED OF THE APP RATHER THAN OF A STORE.
 *
 * This file used to import `modeStore` and read the mode itself. That was
 * fine while there was one app, and it is the single thing that stopped this
 * provider being shared: `modeStore` is the CUSTOMER app's idea — a shopper
 * who is sometimes a rider — and a shopkeeper has one hat. A second app
 * importing this would have dragged a store it has no use for, and a mode it
 * can never be in, along with it.
 *
 * So the dependency is inverted. The provider owns light/dark, the OS
 * listener, the preference and the tokens — everything that is true of any
 * app. WHICH palette is a question only the app around it can answer, so the
 * app answers it.
 *
 * Default `leafThemes`, because an app that does not fork is the shopping
 * side's own colour and because a required prop here would be a breaking
 * change to a provider that is mounted in one place and tested in ten.
 */
export type PaletteFor = (name: ThemeName) => ThemeColors;

export function ThemeProvider({
  children,
  initialPreference = "system",
  onPreferenceChange,
  paletteFor,
  oppositePaletteFor,
}: {
  children: ReactNode;
  /** Restored from storage at boot, so the app doesn't flash the wrong theme. */
  initialPreference?: ThemePreference;
  /** Persist the choice. Kept as a callback so this file owns no storage. */
  onPreferenceChange?: (p: ThemePreference) => void;
  /**
   * The palette this app wears, per theme name. Omit for the shopping side's
   * leaf green — see the note above.
   */
  paletteFor?: PaletteFor;
  /**
   * The OTHER side's, for the two controls whose whole job is to lead there.
   * Omit in an app that has no other side; `useOppositeColors` then answers
   * the same palette, which is the honest answer to "where does this lead"
   * when it leads nowhere.
   */
  oppositePaletteFor?: PaletteFor;
}) {
  const [preference, setPref] = useState<ThemePreference>(initialPreference);
  const [system, setSystem] = useState<SystemScheme>(normalise(Appearance.getColorScheme()));

  // Follow the OS while the app is open — someone flipping their phone to dark
  // at dusk expects this screen to follow without a restart.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(normalise(colorScheme)));
    return () => sub.remove();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const name = resolve(preference, system);
    const colors = paletteFor ? paletteFor(name) : leafThemes[name];

    return {
      name,
      isDark: name === "dark",
      colors,
      // Resolved here, in the provider, rather than by the hook reaching for a
      // store of its own — which is what it used to do, and what kept this
      // file tied to the customer app. An app with no other side gets its own
      // colours back, which is the honest answer to "where does this lead"
      // when it leads nowhere.
      opposite: oppositePaletteFor ? oppositePaletteFor(name) : colors,
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
  }, [preference, system, paletteFor, oppositePaletteFor, onPreferenceChange]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * THE COLOURS OF THE HALF OF THE APP YOU ARE NOT IN.
 *
 * For the two controls whose whole job is to take somebody to the other side:
 * "Deliver with CartZe" on the account page, and the mode switch in the menu.
 * A control that leads somewhere ought to look like where it leads — pressing
 * an orange button and arriving in an orange app is the switch explaining
 * itself before it is pressed.
 *
 * Deliberately narrow. This is not a way for any screen to reach for a second
 * palette; two colours on a page is a page with no accent. Two controls use
 * it, and both of them are doors.
 *
 * It read `modeStore` directly until Phase 0. Now the provider has already
 * worked the answer out — see `oppositePaletteFor` — so this hook knows
 * nothing about modes, and neither does the file it lives in.
 */
export function useOppositeColors(): ThemeColors {
  return useTheme().opposite;
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
