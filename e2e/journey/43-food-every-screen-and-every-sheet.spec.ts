import fs from "node:fs";
import type { Locator, Page } from "@playwright/test";

import { everyRule, nothingIsWrittenUnderAButton, type Finding } from "../rules";
import { KEPT_AS, OWNER_STATE, TRADE, expect, record, roomForACase, session, settled, test } from "./kit";

/**
 * STAGE Z — EVERY SCREEN, AND EVERY SHEET A SCREEN CAN OPEN.
 *
 * ── The ask ──────────────────────────────────────────────────────────
 *
 *     "aik complete flow bnao jis main hr page, hr module, hr modal — sb kuch
 *      test ho … kuch b na rahy kisi page ka."
 *     "abhi testing krty waqt ye b dekhna hai: app slow to ni, request time
 *      main issue to ni aye ga."
 *
 * The other stages LIVE a restaurant — a dish, a table, a bill. They open the
 * sheets their story needs and no others, and three faults the owner found by
 * hand were in sheets no story had opened, or had opened once and never
 * pressed twice. This stage is the walk with no story: every entry in the
 * menu, and on each screen every button that opens a form.
 *
 *   Z1  every screen opens on its own address, draws, breaks no layout rule,
 *       is refused nothing — and what it asked the server, and how long each
 *       answer took, is written down
 *   Z2  every sheet opens whole: nothing written under a button, nothing off
 *       the screen; it closes on its ✕ and it closes on Escape; and the screen
 *       under it still answers afterwards
 *
 * What it writes: `e2e/.journey/<record>-screens.json` — per screen the
 * requests and their times, per sheet what was found.
 *
 * Run after the stages that fill the restaurant (01, 02, 20, 21 and the house
 * stages), so the lists it walks have rows in them.
 */

// NOT serial, unlike every other stage. The sheets are walked from the list
// the screens' walk WROTE, not from its verdict — and a fault on one screen
// must not mean that no sheet anywhere is opened.
test.skip(TRADE !== "food", "a restaurant's stage — run with JOURNEY_TRADE=food");
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

const REPORT = `e2e/.journey/${KEPT_AS}-screens.json`;
const API = /\/api\/v1(\/[^?]*)(\?.*)?/;

/** A request slower than this, on a laptop with the database beside it, is worth a look. */
const SLOW_MS = 800;
/** …and slower than this is a fault whatever the reason. */
const TOO_SLOW_MS = 4_000;
/** A screen that asks the server more than this many things to draw itself once. */
const TOO_MANY_CALLS = 30;

/** Screens no menu entry leads to, reached from a button on another screen. */
const BESIDE_THE_MENU = ["/tenant/sales/new", "/tenant/orders/new"];

interface Call { method: string; path: string; asked: string; status: number; ms: number }
interface Screen {
  href: string;
  title: string;
  settledMs: number;
  calls: Call[];
  findings: Finding[];
  sheets: Array<{ opener: string; title: string; findings: Finding[]; closes: string[] }>;
}

/** `/products/9f2c…/edit` and `/products/1a77…/edit` are one question. */
const shape = (path: string) => path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":id").replace(/\/\d+(?=\/|$)/g, "/:n");

/** Everything the page asks the API from now on, with how long each answer took. */
function listen(page: Page): { calls: Call[]; errors: string[] } {
  const heard = { calls: [] as Call[], errors: [] as string[] };
  page.on("requestfinished", async (req) => {
    const hit = API.exec(req.url());
    if (!hit) return;
    const res = await req.response().catch(() => null);
    const t = req.timing();
    heard.calls.push({
      method: req.method(),
      path: shape(hit[1]),
      // The whole question. `/products?page=1` and `/products?is_active=1` are
      // two lists; only the same one asked twice is a waste.
      asked: `${req.method()} ${hit[1]}${hit[2] ?? ""}`,
      status: res?.status() ?? 0,
      // From the request leaving to the last byte arriving.
      ms: t.responseEnd >= 0 && t.requestStart >= 0 ? Math.round(t.responseEnd - t.requestStart) : -1,
    });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // A refused request is reported by the watch, by its own name.
    if (/Failed to load resource/.test(text)) return;
    heard.errors.push(text.split("\n")[0].slice(0, 200));
  });

  return heard;
}

/** Each different thing the console said, once, with how often it said it. */
function said(errors: string[]): string[] {
  const counted = new Map<string, number>();
  for (const e of errors) counted.set(e, (counted.get(e) ?? 0) + 1);

  return [...counted].map(([text, n]) => (n > 1 ? `${text} (×${n})` : text));
}

function load(): Screen[] {
  return fs.existsSync(REPORT) ? (JSON.parse(fs.readFileSync(REPORT, "utf8")) as Screen[]) : [];
}
const save = (screens: Screen[]) => fs.writeFileSync(REPORT, JSON.stringify(screens, null, 2));

/**
 * `JOURNEY_DUMP=<folder>` also writes what each screen and each sheet SAYS —
 * its roles and names, as a screen reader would be told them. For reading by
 * whoever is writing the next stage; nothing is asserted about it.
 */
const DUMP = process.env.JOURNEY_DUMP;
async function dump(of: Locator, name: string): Promise<void> {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  const said = await of.ariaSnapshot({ timeout: 5_000 }).catch((e: unknown) => `could not be read: ${String(e).split("\n")[0]}`);
  fs.writeFileSync(`${DUMP}/${name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.yml`, said);
}

const heading = async (page: Page) =>
  ((await page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 2_000 }).catch(() => "")) ?? "").trim();

test("Z1 · every screen opens on its own address, draws, and breaks no rule — and what it asked the server is written down", async ({ page, request }) => {
  test.setTimeout(1_500_000);
  const screens = [...new Set([...(record().screens as string[]), ...BESIDE_THE_MENU])];
  expect(screens.length, "stage B2 found a long menu, and this walk is given a short one").toBeGreaterThanOrEqual(30);

  const heard = listen(page);
  const walked: Screen[] = [];
  const bounced: string[] = [];
  const blank: string[] = [];

  for (const [at, href] of screens.entries()) {
    if (at > 0 && at % 8 === 0) await roomForACase(request);
    heard.calls.length = 0;

    const began = Date.now();
    await page.goto(href);
    await settled(page);
    const settledMs = Date.now() - began;
    await page.waitForTimeout(350);

    const here = new URL(page.url()).pathname.replace(/\/$/, "");
    if (here !== href.replace(/\/$/, "")) bounced.push(`${href} → ${here}`);
    if ((await page.locator("body").innerText()).trim().length < 40) blank.push(href);

    await dump(page.locator("body"), `screen ${href}`);
    walked.push({
      href,
      title: await heading(page),
      settledMs,
      calls: [...heard.calls],
      findings: await everyRule(page),
      sheets: [],
    });
  }
  save(walked);

  // ── the times, written down whatever else is found ─────────────────
  const all = walked.flatMap((s) => s.calls.map((c) => ({ ...c, on: s.href })));
  const slow = all.filter((c) => c.ms > SLOW_MS).sort((a, b) => b.ms - a.ms);
  const repeated = walked.flatMap((s) => {
    const asked = new Map<string, number>();
    // Reads only: the same thing may honestly be POSTed twice.
    for (const c of s.calls) if (c.method === "GET") asked.set(c.asked, (asked.get(c.asked) ?? 0) + 1);

    return [...asked].filter(([, n]) => n > 1).map(([what, n]) => `${s.href} asked ${what.slice(0, 120)} ${n} times to draw once`);
  });
  console.log(`\n${walked.length} screens · ${all.length} requests · slowest ${Math.max(...all.map((c) => c.ms))} ms · ${Math.round(all.length / walked.length)} requests a screen`);
  for (const c of slow.slice(0, 15)) console.log(`  slow  ${String(c.ms).padStart(5)} ms  ${c.method} ${c.path}   (on ${c.on})`);

  // ── and everything that is wrong, said together ────────────────────
  // One at a time, the first thing found hid the rest: a console error on
  // the till stopped the walk from saying anything about forty-eight screens.
  const wrong = [
    ...bounced.map((b) => `did not open on its own address: ${b}`),
    ...blank.map((b) => `drew nothing: ${b}`),
    ...said(heard.errors).map((e) => `the browser's console: ${e}`),
    ...walked.flatMap((s) => s.findings.map((f) => `${s.href} — ${f.what}: ${f.detail}`)),
    ...all.filter((c) => c.status >= 400).map((c) => `${c.on} was refused ${c.status} ${c.method} ${c.path}`),
    ...all.filter((c) => c.ms > TOO_SLOW_MS).map((c) => `nobody should wait ${c.ms} ms for ${c.method} ${c.path} (on ${c.on})`),
    ...walked.filter((s) => s.calls.length > TOO_MANY_CALLS).map((s) => `${s.href} asked ${s.calls.length} things to draw once`),
    ...repeated,
  ];
  expect(wrong, "what the walk found").toEqual([]);
});

// ── the sheets ───────────────────────────────────────────────────────

/** A button that opens a form to fill in. */
const OPENS = /^(\+ ?|add\b|new\b|create\b|import\b|groups\b|record\b|adjust\b|transfer\b|book\b|invite\b|take\b|open\b|log\b|set\b|count\b|start\b)/i;
/** …and words that mean a press DOES something. Never pressed by a walk with no story. */
const DOES = /(delete|remove|sign ?out|log ?out|close (off|the)|cancel|void|refund|fire|send|pay\b|receive|print|export|download|approve|reject|clear|reset|suspend|end\b|finish|save|confirm|apply|discard|open (the )?(shift|day|till|drawer|counter)|start (the )?(shift|day)|take order|new sale|full view|simple view)/i;

/**
 * …and what a ROW offers. "Pay" on a supplier and "Edit" on a customer open a
 * sheet about that row; pressed on the first row only. Named exactly — "Pay"
 * here is a sheet, and a walk must not learn to press everything called pay.
 */
const ON_A_ROW = ["Edit", "Pay", "View", "Details", "Batches", "History", "Adjust"];

const sheet = (page: Page): Locator => page.locator('.modal [role="dialog"]').last();

/**
 * Not the page: the menu down the side, the app's bar across the top, and a
 * sheet that is open.
 *
 * A work screen — the floor, a tab — has a bar of its OWN, with "Edit floor"
 * and "+ Takeaway" on it, and it is a <header> too. The first version of this
 * left every <header> out, so the floor was walked and nothing on it pressed.
 * The app's bar sits above the page; a page's own bar is inside it.
 */
const NOT_THE_PAGE = "aside, nav, [role='dialog'], header:not(main header)";

/** The buttons on this screen worth pressing: named like an opener, and on the page — not the menu, not the bar across the top. */
async function openers(page: Page): Promise<string[]> {
  const names = await page.locator("button, [role='button']").evaluateAll((els, outside) =>
    els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled && !el.closest(outside);
      })
      .map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ")),
    NOT_THE_PAGE,
  );

  return [...new Set(names)].filter((n) => n.length > 0 && n.length <= 40 && ((OPENS.test(n) && !DOES.test(n)) || ON_A_ROW.includes(n)));
}

/** The first row of the first list on the screen that has anything in it. */
const firstRow = (page: Page): Locator =>
  page.locator(`tbody tr:has(td):not(:has(td[colspan]))`).and(page.locator(`:not(:is(${NOT_THE_PAGE}) *)`)).first();

/** That button, on the page — the menu has an "Orders" and a "Settings" of its own. */
const onThePage = (page: Page, name: string): Locator =>
  page.getByRole("button", { name, exact: true }).and(page.locator(`:not(:is(${NOT_THE_PAGE}) *)`)).first();

/** What the sheet is called: its own heading, or the name it gives a screen reader. */
async function titleOf(dialog: Locator): Promise<string> {
  const own = await dialog.getByRole("heading").first().textContent({ timeout: 1_500 }).catch(() => null);

  return (own ?? (await dialog.getAttribute("aria-label")) ?? "").trim().replace(/\s+/g, " ");
}

test("Z2 · every sheet opens whole, closes on its ✕ and on Escape, and leaves the screen answering", async ({ page, request }) => {
  test.setTimeout(2_400_000);
  const walked = load();
  expect(walked.length, "Z1 has not walked the screens yet").toBeGreaterThanOrEqual(30);

  const heard = listen(page);
  const wrong: string[] = [];
  let pressed = 0;

  for (const [at, screen] of walked.entries()) {
    if (at > 0 && at % 5 === 0) await roomForACase(request);
    screen.sheets = [];

    await page.goto(screen.href);
    await settled(page);
    await page.waitForTimeout(300);
    const names = await openers(page);

    for (const name of names) {
      // From a clean screen every time: the sheet before may have left a filter set or a tab changed.
      if (new URL(page.url()).pathname.replace(/\/$/, "") !== screen.href.replace(/\/$/, "") || (await sheet(page).isVisible().catch(() => false))) {
        await page.goto(screen.href);
        await settled(page);
      }
      const button = onThePage(page, name);
      if (!(await button.isVisible().catch(() => false))) continue;

      pressed++;
      await button.click();
      const dialog = sheet(page);
      const opened = await dialog.waitFor({ state: "visible", timeout: 2_500 }).then(() => true).catch(() => false);
      if (!opened) continue; // it went somewhere, or opened a menu: not a sheet
      await settled(page);
      await page.waitForTimeout(250);

      const entry = { opener: name, title: await titleOf(dialog), findings: [] as Finding[], closes: [] as string[] };
      await dump(dialog, `sheet ${screen.href} ${entry.title || name}`);
      entry.findings = [...(await nothingIsWrittenUnderAButton(page)), ...(await everyRule(page))];

      // ── it closes on its ✕ ────────────────────────────────────────
      const cross = dialog.getByRole("button", { name: "Close", exact: true }).first();
      if (await cross.isVisible().catch(() => false)) {
        await cross.click();
        if (await dialog.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true).catch(() => false)) entry.closes.push("✕");
      }

      // ── and, opened again, on Escape ──────────────────────────────
      if (!(await sheet(page).isVisible().catch(() => false))) {
        await button.click().catch(() => {});
        if (await sheet(page).waitFor({ state: "visible", timeout: 2_500 }).then(() => true).catch(() => false)) {
          await page.keyboard.press("Escape");
          if (await sheet(page).waitFor({ state: "hidden", timeout: 3_000 }).then(() => true).catch(() => false)) entry.closes.push("Escape");
          else wrong.push(`${screen.href} · "${entry.title || name}" opens a second time and will not close on Escape`);
        } else {
          // The fault the owner found by hand: a button that works once.
          wrong.push(`${screen.href} · "${name}" opened its sheet once and would not open it again`);
        }
      }

      screen.sheets.push(entry);
      for (const f of entry.findings) wrong.push(`${screen.href} · "${entry.title || name}" — ${f.what}: ${f.detail}`);
      if (!entry.closes.includes("✕")) wrong.push(`${screen.href} · "${entry.title || name}" does not close on its ✕`);
    }
    // ── and the first row of its list, pressed like a row ───────────
    // A sale, an order, a purchase order: its sheet opens from the row.
    if (new URL(page.url()).pathname.replace(/\/$/, "") !== screen.href.replace(/\/$/, "") || (await sheet(page).isVisible().catch(() => false))) {
      await page.goto(screen.href);
      await settled(page);
    }
    const row = firstRow(page);
    if (await row.isVisible().catch(() => false)) {
      pressed++;
      // On the row's first cell: its last usually holds buttons of its own.
      await row.locator("td").first().click().catch(() => {});
      const dialog = sheet(page);
      if (await dialog.waitFor({ state: "visible", timeout: 2_500 }).then(() => true).catch(() => false)) {
        await settled(page);
        await page.waitForTimeout(250);
        const entry = { opener: "the first row", title: await titleOf(dialog), findings: [] as Finding[], closes: [] as string[] };
        await dump(dialog, `sheet ${screen.href} row ${entry.title}`);
        entry.findings = [...(await nothingIsWrittenUnderAButton(page)), ...(await everyRule(page))];
        const cross = dialog.getByRole("button", { name: "Close", exact: true }).first();
        if (await cross.isVisible().catch(() => false)) {
          await cross.click();
          if (await dialog.waitFor({ state: "hidden", timeout: 3_000 }).then(() => true).catch(() => false)) entry.closes.push("✕");
        }
        screen.sheets.push(entry);
        for (const f of entry.findings) wrong.push(`${screen.href} · "${entry.title}" (a row's sheet) — ${f.what}: ${f.detail}`);
        if (!entry.closes.includes("✕")) wrong.push(`${screen.href} · "${entry.title}" (a row's sheet) does not close on its ✕`);
      }
    }
    save(walked);
  }

  const sheets = walked.flatMap((s) => s.sheets.map((x) => `${s.href} · ${x.title || x.opener}`));
  console.log(`\n${pressed} buttons pressed · ${sheets.length} sheets opened`);
  for (const line of sheets) console.log(`  ${line}`);

  // A walk that finds no sheets passes every check it has. These are the
  // sheets every restaurant has, by the names on them.
  const titles = walked.flatMap((s) => s.sheets.map((x) => x.title));
  for (const known of ["New supplier", "New purchase order", "Add customer", "New coupon", "New promotion", "Add expense", "Add income"]) {
    expect(titles, `the walk did not open "${known}" — it is not finding the sheets`).toContain(known);
  }

  expect([...said(heard.errors).map((e) => `the browser's console: ${e}`), ...wrong], "what the walk found in the sheets").toEqual([]);
});
