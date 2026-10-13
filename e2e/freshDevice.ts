import fs from "node:fs";

import type { BrowserContext, Page } from "@playwright/test";

/**
 * A SAVED SIGN-IN IS A SESSION — NOT A DEVICE THAT HAS BEEN HERE BEFORE.
 *
 * The panel keeps a few answers on the device so a reload does not ask for
 * them again: the shop's settings, its branches, the bell, and how old its
 * copy of "who am I" is (`src/common/kept`). A browser context's storage
 * state holds all of that, so a sign-in saved once and handed to every test
 * handed each of them a device that "remembered" the shop as it stood when
 * the suite began.
 *
 * Specs change the shop behind the page's back — a setting through the API,
 * a module from the admin's side — and then open a screen expecting to see
 * it. The app does catch up (the server's stamp, on its first answer), but a
 * moment AFTER the first paint: a sheet opened in that moment was drawn with
 * the old date format and thrown away when the new one arrived. The first
 * spec to meet it failed on "element not found", about a date box that had
 * been on screen.
 *
 * So what is saved is the session and nothing the device kept. Every test
 * opens as a device's first visit: it asks, as it always did, and what it
 * shows is what the server holds. Keeping has its own spec
 * (`kept-on-the-device.spec.ts`), which reloads inside one context — where
 * the kept answers are real.
 */

/**
 * Storage keys that are a device's memory of a shop, not a person's session.
 *
 * The date format is one of them, and it was the first to bite: a device that
 * "remembers" one format while the shop has since chosen another draws the
 * page in the old one, then again in the new — and a sheet opened in between
 * is thrown away. A first visit has nothing to remember, so the page waits
 * the fraction of a second for the shop's settings and is drawn once.
 */
const KEPT_ON_A_DEVICE = ["shopos-kept", "shopos-orders-waiting", "shopos-dates"];

interface SavedState {
  cookies: unknown[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/** The state as a device's first visit would have it. Pure, so it can be tested without a browser. */
export function asAFirstVisit(state: SavedState): SavedState {
  return {
    ...state,
    origins: state.origins.map((origin) => ({
      ...origin,
      localStorage: origin.localStorage
        .filter((entry) => !KEPT_ON_A_DEVICE.includes(entry.name))
        .map((entry) => (entry.name === "shopos-auth" ? { ...entry, value: withNoAge(entry.value) } : entry)),
    })),
  };
}

/** The session, with no claim about how recently the server described this person. */
function withNoAge(value: string): string {
  try {
    const stored = JSON.parse(value) as { state?: Record<string, unknown> };
    if (stored.state) {
      stored.state.userAt = null;
      stored.state.userUnder = null;
    }

    return JSON.stringify(stored);
  } catch {
    return value;
  }
}

/** Save this context's sign-in for other tests to start from. Use it instead of `context.storageState({ path })`. */
export async function keepSession(context: BrowserContext, path: string): Promise<void> {
  const state = (await context.storageState()) as SavedState;
  fs.mkdirSync(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(asAFirstVisit(state), null, 2));
}

/**
 * For a spec that ANSWERS FOR THE SERVER — a route that hands the page a
 * different shop than the real one.
 *
 * Such a spec changes what a kept answer would be without the server knowing,
 * so nothing tells the device to ask again: no save was made here, and the
 * server's stamp has not moved. The page would open from what it kept and
 * never see the answer the spec wrote for it.
 *
 * This device forgets before every load, so each one asks. It is the spec's
 * own doing, said in the spec — not a way the product behaves.
 */
export async function aDeviceThatKeepsNothing(page: Page): Promise<void> {
  await page.addInitScript((keys: string[]) => {
    for (const key of keys) localStorage.removeItem(key);
  }, KEPT_ON_A_DEVICE);
}
