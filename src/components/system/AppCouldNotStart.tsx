import { Component, type ErrorInfo, type ReactNode } from "react";

import { PRODUCT } from "../../common/brand";

/**
 * THE APP NEVER SHOWS A WHITE PAGE.
 *
 * Two holes were left after the screen-level catch (ScreenCouldNotOpen):
 *
 *   a crash OUTSIDE a layout — the sign-in page, a provider, the landing
 *   page — reached nothing that could draw a word, and the page went white
 *   with no button to press;
 *
 *   a deploy removes the last build's hashed files, and a tab still holding
 *   the old page asks for one of them: the import fails. Inside a layout
 *   that is said; outside one it was white too.
 *
 * Caught here, around everything. A missing file is mended by itself — one
 * reload fetches the new build — at most once per tab in five minutes and
 * never offline, under the same key the boot watchdog in index.html uses, so
 * the two can never take turns reloading. Anything else says so, with Reload.
 */
const MENDED = "shopos-boot-mended";
const FIVE_MINUTES = 5 * 60 * 1000;

/** Chrome, Firefox and Safari each word a file that would not download their own way. */
export const NOT_DOWNLOADED = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Unable to preload CSS/i;

/** Reload once for a fresh copy of the app. False when it must not: offline, or done a moment ago. */
export function reloadOnceForAFreshCopy(reload: () => void = () => window.location.reload(), now: number = Date.now()): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  try {
    const last = Number(window.sessionStorage.getItem(MENDED) || 0);
    if (now - last < FIVE_MINUTES) return false;
    window.sessionStorage.setItem(MENDED, String(now));
  } catch {
    return false;
  }
  reload();

  return true;
}

export class AppCouldNotStart extends Component<{ children: ReactNode; reload?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    if (NOT_DOWNLOADED.test(error.message)) reloadOnceForAFreshCopy(this.props.reload);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    const update = NOT_DOWNLOADED.test(this.state.error.message);

    return (
      <div role="alert" data-app-could-not-start className="flex min-h-dvh items-center justify-center bg-white px-4 dark:bg-gray-900">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            {update ? `${PRODUCT.name} was updated` : `${PRODUCT.name} could not open this page`}
          </h1>
          <p className="mt-2 text-theme-sm text-gray-500 dark:text-gray-400">
            Reload to {update ? "open the new version" : "try again"} — nothing you saved is lost.
          </p>
          <button
            type="button"
            onClick={() => (this.props.reload ?? (() => window.location.reload()))()}
            className="mt-5 min-h-10 rounded-lg bg-brand-500 px-5 text-theme-sm font-semibold text-white hover:bg-brand-600"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
