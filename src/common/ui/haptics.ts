import { Platform, Vibration } from "react-native";

/**
 * A twelve-millisecond tick, and it can never be the reason a press fails.
 *
 * `Vibration.vibrate()` throws on Android when `android.permission.VIBRATE`
 * is not declared — and it was not, so the tick on the add button was turning
 * "put this in my basket" into a red screen. The permission is declared now,
 * and this exists because a haptic is a GARNISH: on a device with a broken
 * motor, an emulator without one, or a manifest somebody edits next year, the
 * item still has to go in the basket.
 */
export function tick(): void {
  try {
    Vibration.vibrate(Platform.OS === "android" ? 12 : 10);
  } catch {
    // Nothing to report and nothing to fall back to — the press already
    // happened, and the animation says so on its own.
  }
}
