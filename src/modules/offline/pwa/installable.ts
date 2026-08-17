/**
 * Can this device put ShopOS on its home screen, and how.
 *
 * ── Two completely different answers ────────────────────────────────────
 *
 * Chrome, Edge and Android fire `beforeinstallprompt`, which we catch and hold
 * so the shop is asked at a moment we choose rather than one the browser picks.
 *
 * **Safari fires nothing at all.** There is no event, no API, no way to
 * trigger the sheet — an iPad can only be installed by a person tapping Share
 * and then "Add to Home Screen". That matters more here than it looks: a
 * counter tablet is very often an iPad, so the device the shop most wants the
 * icon on is exactly the one no code can ask.
 *
 * So this file answers "which conversation are we having", and the prompt
 * component has two shapes: a button, or a sentence telling somebody where to
 * tap.
 */

export type InstallRoute =
  /** Already on the home screen. Nothing to offer. */
  | "installed"
  /** `beforeinstallprompt` fired; we can ask directly. */
  | "prompt"
  /** Safari. Only a person can do it, so we say how. */
  | "manual"
  /** A desktop browser with no install path worth mentioning. */
  | "none";

/**
 * Is the app already running from the home screen?
 *
 * `display-mode: standalone` is the standard answer. `navigator.standalone` is
 * Safari's own, non-standard and iOS-only — and it is the ONLY one that works
 * there, so both have to be asked.
 */
export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * An iPhone or an iPad.
 *
 * The second half of this test is not paranoia. **iPadOS 13 and later report
 * themselves as `MacIntel`** — an iPad tells you it is a desktop Mac. A plain
 * user-agent check therefore misses precisely the device this whole feature
 * exists for. A Mac with a touchscreen would be a false positive; there is no
 * such Mac.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return true;

  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** What to offer, given whether the browser handed us a deferred prompt. */
export function installRoute(hasDeferredPrompt: boolean): InstallRoute {
  if (isInstalled()) return "installed";
  if (hasDeferredPrompt) return "prompt";
  if (isIOS()) return "manual";

  return "none";
}
