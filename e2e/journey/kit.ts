import { expect, test as base, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import { API } from "../api";

/**
 * THE JOURNEY'S KIT.
 *
 * One business, lived through in order — see docs/qa/journey/CASES.md. Every
 * stage is a spec file and every case a test, and three things are shared
 * between all of them:
 *
 *   the RECORD   what this run made (the business, its owner, the ids), kept
 *                in a file so stage three knows what stage one created.
 *   the SESSION  a signed-in browser for the admin and for the owner, renewed
 *                before it can expire: a token lives an hour and a journey
 *                lives longer.
 *   the WATCH    every case is listened to. A response the server refused,
 *                or an error the page threw, FAILS the case unless the case
 *                said beforehand that it expected it. "It looked fine" is
 *                not a pass when a request behind it was turned away.
 */

export const TRADE = process.env.JOURNEY_TRADE ?? "mart";

const DIR = "e2e/.journey";
const RECORD = `${DIR}/${TRADE}.json`;

export const ADMIN_EMAIL = process.env.E2E_ADMIN ?? "admin@shopos.test";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

/** What the admin's "Business type" dropdown calls each trade. */
export const TRADE_LABEL: Record<string, string> = {
  food: "Food & Restaurant",
  online: "Online Store",
  mart: "Mart & Grocery",
  pharmacy: "Pharmacy & Medical",
  retail: "Retail Store",
  services: "Services",
  automotive: "Auto & Tyre",
  finance: "Finance Manager",
  petroleum: "Petroleum & Energy",
};

// ── the record ───────────────────────────────────────────────────────

export interface Record_ {
  stamp: string;
  trade: string;
  business: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  phone: string;
  tenantId?: string;
  [key: string]: unknown;
}

export function record(): Record_ {
  if (!fs.existsSync(RECORD)) {
    throw new Error(`No journey record for ${TRADE} — stage 01 (the admin creates the business) has not run.`);
  }

  return JSON.parse(fs.readFileSync(RECORD, "utf8")) as Record_;
}

export function remember(patch: Partial<Record_>): Record_ {
  fs.mkdirSync(DIR, { recursive: true });
  const now = fs.existsSync(RECORD) ? (JSON.parse(fs.readFileSync(RECORD, "utf8")) as Record_) : ({} as Record_);
  const next = { ...now, ...patch } as Record_;
  fs.writeFileSync(RECORD, JSON.stringify(next, null, 2));

  return next;
}

/** Start a NEW journey: forgets the last one of this trade. */
export function begin(): Record_ {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  // To the SECOND. A stamp to the minute made two runs inside one minute the
  // same business, and the second was refused as a duplicate.
  const stamp = `${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  fs.mkdirSync(DIR, { recursive: true });
  const fresh: Record_ = {
    stamp,
    trade: TRADE,
    business: `QA ${TRADE[0].toUpperCase()}${TRADE.slice(1)} ${stamp}`,
    ownerName: `QA ${TRADE} owner`,
    ownerEmail: `qa-${TRADE}-${stamp}@qa.test`,
    ownerPassword: "Journey-pass-1",
    // Its own number: a business's phone is unique across the platform.
    phone: `03${stamp.replace(/\D/g, "").slice(-9)}`,
  };
  fs.writeFileSync(RECORD, JSON.stringify(fresh, null, 2));

  return fresh;
}

// ── the session ──────────────────────────────────────────────────────

const stateFile = (who: "admin" | "owner") => `${DIR}/${TRADE}-${who}.json`;

/** The saved sign-in for `test.use({ storageState })`. */
export const ADMIN_STATE = stateFile("admin");
export const OWNER_STATE = stateFile("owner");

/**
 * Sign in THROUGH THE FORM, as a person does.
 *
 * `throttle:auth` is five a minute per address, and it is the product
 * working. A refused attempt waits out the minute and tries again; it is not
 * a finding.
 */
export async function signIn(page: Page, email: string, password: string, lands: RegExp): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await page.goto("/signin");
    await page.getByPlaceholder("you@business.com").fill(email);
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    try {
      await expect(page).toHaveURL(lands, { timeout: 20_000 });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      await page.waitForTimeout(62_000);
    }
  }
}

/**
 * A saved session that is young enough to finish a stage on.
 *
 * Tokens live sixty minutes; anything over thirty-five is renewed here, at
 * the START of a stage, so no case can cross the line halfway through and
 * spend the rest of the file testing the sign-in page.
 */
export async function session(browser: Browser, who: "admin" | "owner"): Promise<string> {
  const file = stateFile(who);
  const young = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 35 * 60_000;
  // Young is not the same as alive. A session is ended from the server's side
  // by things the journey does on purpose — a shop suspended, a till handed
  // over by PIN — and a file that is ten minutes old then holds a dead token.
  if (young && (await alive(who))) return file;

  // An EMPTY session, said out loud. Inside a test, `browser.newContext()`
  // inherits the file's own `storageState` — which is the very file this
  // function exists to create, and does not exist yet.
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4173",
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  if (who === "admin") {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/admin/);
  } else {
    const r = record();
    await signIn(page, r.ownerEmail, r.ownerPassword, /\/tenant/);
  }
  await context.storageState({ path: file });
  await context.close();

  return file;
}

/** Does the server still honour the saved sign-in? */
async function alive(who: "admin" | "owner"): Promise<boolean> {
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { Accept: "application/json", Authorization: `Bearer ${tokenOf(who)}` } });

    return res.ok;
  } catch {
    // No answer is not "no": the stage will say so itself if the server is down.
    return true;
  }
}

/** The bearer token inside a saved session — for asking the API the same question the screen asked. */
function tokenOf(who: "admin" | "owner"): string {
  const state = JSON.parse(fs.readFileSync(stateFile(who), "utf8")) as {
    origins: Array<{ localStorage: Array<{ name: string; value: string }> }>;
  };
  for (const origin of state.origins) {
    const auth = origin.localStorage.find((i) => i.name === "shopos-auth");
    if (auth) return (JSON.parse(auth.value) as { state: { accessToken: string } }).state.accessToken;
  }
  throw new Error(`the saved ${who} session holds no token`);
}

/**
 * Ask the server directly, as the same person.
 *
 * Never used to DO anything a case is about — the journey acts through the
 * screen. This is the second opinion: the screen says Rs 4,956, and this is
 * what the server says it holds.
 */
export async function ask<T = unknown>(
  request: APIRequestContext,
  who: "admin" | "owner",
  path: string,
): Promise<T> {
  const res = await request.get(`${API}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${tokenOf(who)}` },
  });
  expect(res.ok(), `GET ${path} as ${who} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

// ── the watch ────────────────────────────────────────────────────────

export class Watch {
  readonly refused: string[] = [];
  readonly thrown: string[] = [];
  private readonly expected: RegExp[] = [];

  constructor(page: Page) {
    page.on("response", async (res) => {
      if (res.status() < 400 || !res.url().includes("/api/")) return;
      const body = (await res.json().catch(() => null)) as {
        message?: string; meta?: { error_code?: string }; errors?: Record<string, string[]>;
      } | null;
      const where = new URL(res.url()).pathname.replace(/^\/api\/v1/, "");
      // The FIELD, when it was a validation refusal: "the given data was
      // invalid" says nothing about which of thirty boxes was wrong.
      const fields = Object.entries(body?.errors ?? {}).map(([k, v]) => `${k}: ${v[0]}`).join("; ");
      this.refused.push(
        `${res.status()} ${res.request().method()} ${where} — ${body?.meta?.error_code ?? ""} ${body?.message ?? ""} ${fields}`.trim(),
      );
    });
    page.on("pageerror", (err) => this.thrown.push(String(err).split("\n")[0]));
  }

  /** Say BEFOREHAND that a refusal is the point of the case. */
  expect(pattern: RegExp): void {
    this.expected.push(pattern);
  }

  unexpected(): string[] {
    return this.refused.filter((line) => !this.expected.some((p) => p.test(line)));
  }
}

/**
 * Every journey case is watched, without asking.
 *
 * `auto` — a case that forgets to look is still looked at.
 */
export const test = base.extend<{ watch: Watch }>({
  watch: [
    async ({ page }, use) => {
      const watch = new Watch(page);
      await use(watch);
      // Let the last requests land before judging.
      await page.waitForTimeout(400).catch(() => {});
      expect(watch.unexpected(), "the server refused something this case did not expect").toEqual([]);
      expect(watch.thrown, "the page threw an error").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ── small things every stage needs ───────────────────────────────────

/** "Rs 14,023.94" → 14023.94 */
export function rupees(text: string): number {
  const m = text.replace(/,/g, "").match(/-?[0-9]+(?:\.[0-9]+)?/);

  return m ? Number(m[0]) : NaN;
}

/** Wait for the app to stop asking the server things. */
export async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Pick the option whose text matches — a dropdown's labels carry prices and counts that change. */
export async function choose(select: import("@playwright/test").Locator, text: RegExp): Promise<string> {
  const options = select.locator("option:not([disabled])");
  await expect.poll(async () => options.count(), { message: "the dropdown never filled" }).toBeGreaterThan(0);
  const labels = await options.allTextContents();
  const label = labels.find((l) => text.test(l));
  expect(label, `no option matching ${text} among: ${labels.join(" | ")}`).toBeTruthy();
  await select.selectOption({ label: label! });

  return label!;
}
