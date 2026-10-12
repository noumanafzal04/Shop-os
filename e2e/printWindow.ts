import fs from "node:fs";
import { test as base, expect, type Browser, type CDPSession, type Page } from "@playwright/test";

/**
 * A BROWSER WITH A PRINT WINDOW IN IT.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 *     "Print works once. Then no button can be pressed — not Print, not Fire
 *      to kitchen, not Settle, not Refund — and no screen opens."
 *
 * Every other spec here runs headless, and a headless browser has no print
 * window: `print()` returns at once and nothing is held. Most of them go
 * further and replace `window.print` with a recorder, to read what was
 * printed. Both are right for what they check, and between them the one thing
 * a cashier does with a print — look at a window, close it, carry on — had
 * never happened in a test. For six days a print left the whole app dead and
 * every run was green.
 *
 * So these specs run in a browser you can see, with its real print window,
 * and close that window the way a person does.
 *
 * ── One window, at the side ──────────────────────────────────────────
 *
 * Set PRINT_WINDOW_CDP (say http://127.0.0.1:9333) and the specs open a TAB in
 * a browser that is already up, and leave it up; nothing appears over what
 * somebody is working on. Without it, one window is opened for the run, at the
 * right-hand edge of the screen.
 *
 *     "…/Google Chrome for Testing" --remote-debugging-port=9333 \
 *         --user-data-dir=/some/scratch/dir --window-position=892,38 --window-size=620,900 about:blank
 */

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const ATTACH = process.env.PRINT_WINDOW_CDP ?? "";
const SCREEN = { width: 1366, height: 768 };

export interface PrintWindow {
  /** Wait for the print window; false if none came. */
  comesUp(timeout?: number): Promise<boolean>;
  /** Close it as a person does (Escape), and wait until it has gone. */
  close(): Promise<void>;
  /** One came up and was closed — the whole of "printed it and carried on". */
  seenAndClosed(what: string, timeout?: number): Promise<void>;
  /** Close whatever is up, if anything is. For the end of a test that failed with a window open. */
  closeAny(): Promise<void>;
  /** How many are up now. */
  count(): Promise<number>;
}

interface Target { targetId: string; url: string }

const nap = (ms: number) => new Promise((turn) => setTimeout(turn, ms));

function printWindowOf(cdp: CDPSession): PrintWindow {
  let asked = 0;
  const up = async (): Promise<Target[]> =>
    ((await cdp.send("Target.getTargets")) as { targetInfos: Target[] }).targetInfos.filter((t) => t.url.startsWith("chrome://print"));

  const comesUp = async (timeout = 20_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if ((await up()).length > 0) return true;
      await nap(150);
    }

    return false;
  };

  const close = async () => {
    const [target] = await up();
    if (!target) return;
    // The window's own page is asked, not the shop's: while it is up the
    // shop's page is held still and answers nobody.
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false })) as { sessionId: string };
    // Long enough to have drawn its preview — a person does not close it in
    // the same frame it opened in.
    await nap(1_200);
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id: ++asked, method: "Input.dispatchKeyEvent", params: { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 } }),
      });
    }
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      if ((await up()).length === 0) return;
      await nap(150);
    }
    throw new Error("the print window would not close");
  };

  return {
    comesUp,
    close,
    count: async () => (await up()).length,
    seenAndClosed: async (what, timeout) => {
      expect(await comesUp(timeout), `${what}: no print window came up`).toBe(true);
      await close();
    },
    closeAny: async () => {
      for (let i = 0; i < 4 && (await up()).length > 0; i++) await close().catch(() => {});
    },
  };
}

interface Fixtures { page: Page; printWindow: PrintWindow }
interface Options { signedInAs: string }
interface WorkerFixtures { seenBrowser: Browser }

export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  /** Whose session the tab opens with — a file under e2e/.auth. */
  signedInAs: ["e2e/.auth/owner.json", { option: true }],

  seenBrowser: [async ({ playwright }, hand) => {
    const browser = ATTACH
      ? await playwright.chromium.connectOverCDP(ATTACH)
      : await playwright.chromium.launch({ headless: false, args: ["--window-position=892,38", "--window-size=620,900"] });
    await hand(browser);
    // A browser somebody else opened is theirs to close.
    if (!ATTACH) await browser.close();
  }, { scope: "worker" }],

  printWindow: async ({ seenBrowser }, hand) => {
    const cdp = await seenBrowser.newBrowserCDPSession();
    const window = printWindowOf(cdp);
    await hand(window);
    await window.closeAny();
    await cdp.detach().catch(() => {});
  },

  page: async ({ seenBrowser, signedInAs, printWindow }, hand, info) => {
    const state = JSON.parse(fs.readFileSync(signedInAs, "utf8")) as { origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
    // The session is the person's, not the address's: a panel served from
    // another port (a copy, say, with a change being tried in it) is signed in
    // with the same one.
    const origin = new URL(BASE).origin;
    const kept = (state.origins.find((o) => o.origin === origin) ?? state.origins.find((o) => o.localStorage.some((e) => e.name === "shopos-auth")))?.localStorage ?? [];
    expect(kept.length, `no saved session in ${signedInAs} — auth.setup.ts did not run`).toBeGreaterThan(0);

    let page: Page;
    let closeContext: (() => Promise<void>) | null = null;
    if (ATTACH) {
      // A tab beside the others, in the browser's own profile — so what the
      // last shop left on this device is cleared before this one signs in.
      page = await seenBrowser.contexts()[0].newPage();
      await page.goto(`${BASE}/favicon.png`);
      await page.evaluate(async (entries) => {
        localStorage.clear();
        sessionStorage.clear();
        for (const db of await indexedDB.databases()) {
          if (!db.name) continue;
          await new Promise<void>((gone) => {
            const asked = indexedDB.deleteDatabase(db.name as string);
            asked.onsuccess = asked.onerror = asked.onblocked = () => gone();
          });
        }
        for (const { name, value } of entries) localStorage.setItem(name, value);
      }, kept);
      // The built-in fixture gives a page its base address; a tab in somebody
      // else's browser has none, and every helper here says "/tenant/…".
      const go = page.goto.bind(page);
      page.goto = (url, options) => go(url.startsWith("/") ? `${BASE}${url}` : url, options);
    } else {
      const context = await seenBrowser.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [{ origin, localStorage: kept }] } });
      page = await context.newPage();
      closeContext = () => context.close();
    }
    await page.setViewportSize(SCREEN);

    await hand(page);

    // A window left up holds the page still: nothing below can be asked of it
    // until it is closed.
    await printWindow.closeAny();
    if (info.status !== info.expectedStatus) {
      const shot = await Promise.race([page.screenshot().catch(() => null), nap(5_000).then(() => null)]);
      if (shot) await info.attach("the screen when it failed", { body: shot, contentType: "image/png" });
    }
    await page.close().catch(() => {});
    if (closeContext) await closeContext().catch(() => {});
  },
});

export { expect };

/**
 * The screen is still a screen: something React has to draw gets drawn.
 *
 * Asked by pressing a link in the menu and seeing the address change WITHOUT
 * the page loading again — a reload would revive a dead app and hide exactly
 * the failure this is here for.
 */
export async function expectTheAppStillAnswers(page: Page, link: string | RegExp, address: RegExp): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __sameVisit?: boolean }).__sameVisit = true; });
  await page.getByRole("link", { name: link, exact: typeof link === "string" }).first().click({ timeout: 10_000 });
  await expect(page, "pressing a menu entry went nowhere").toHaveURL(address, { timeout: 10_000 });
  expect(
    await page.evaluate(() => (window as unknown as { __sameVisit?: boolean }).__sameVisit === true),
    "the screen only changed because the page was loaded again",
  ).toBe(true);
}
