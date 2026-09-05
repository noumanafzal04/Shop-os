import * as Keychain from "react-native-keychain";
import type { ThemePreference } from "../../theme";

/**
 * Small, non-secret settings that have to survive a relaunch.
 *
 * ── Why the Keychain, which is for secrets ───────────────────────────
 *
 * Because this app has no key-value store at all. React Native ships none,
 * AsyncStorage is a native module and adding it means a rebuild, and the only
 * persistence already linked here is `react-native-keychain`.
 *
 * A theme choice is not a secret, so this is a misuse — a deliberate and
 * documented one. It buys a setting that survives a relaunch today without
 * asking anyone to rebuild the app, and it is one file to replace when a real
 * store arrives: nothing outside this module knows where the value lives.
 *
 * It uses its own SERVICE so it can never collide with the session. Clearing
 * preferences must not sign anybody out.
 */
const SERVICE = "shopos.prefs";

interface Prefs {
  theme?: ThemePreference;
  /** Whether the introduction has been through once. */
  onboarded?: boolean;
}

async function read(): Promise<Prefs> {
  try {
    const found = await Keychain.getGenericPassword({ service: SERVICE });
    if (!found) return {};
    return JSON.parse(found.password) as Prefs;
  } catch {
    // A corrupt or unavailable entry is not an error worth showing anybody —
    // it means "no preference saved", which is the same as a first launch.
    return {};
  }
}

async function write(next: Prefs): Promise<void> {
  try {
    await Keychain.setGenericPassword("prefs", JSON.stringify(next), { service: SERVICE });
  } catch {
    // Failing to remember a theme is not worth interrupting anyone over. The
    // choice still applies for this run.
  }
}

export const prefs = {
  /**
   * Everything at once.
   *
   * One read, because the app blocks its first paint on this and two awaits
   * against the Keychain is two round trips to hold a blank screen for.
   */
  async all(): Promise<Prefs> {
    return read();
  },

  async setTheme(theme: ThemePreference): Promise<void> {
    await write({ ...(await read()), theme });
  },

  async setOnboarded(): Promise<void> {
    await write({ ...(await read()), onboarded: true });
  },
};
