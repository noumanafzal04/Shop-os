// The hand-QA kit: one person, one browser, and everything they ask the server
// written down. Used by docs/qa/SYSTEM-TEST.md. Not a spec — Playwright does
// not run it; a walk is a small script that imports it and is run with node.
//
//   BASE    the panel        (default http://localhost:5177)
//   API     the API          (default http://localhost:8000/api/v1)
//   QA_OUT  shots, HARs, saved sign-ins (default panel/test-results/qa — ignored by git)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.BASE ?? "http://localhost:5177";
export const API = process.env.API ?? "http://localhost:8000/api/v1";
export const OUT = process.env.QA_OUT ?? path.resolve(HERE, "../../test-results/qa");
for (const dir of ["shots", "har", "states"]) fs.mkdirSync(`${OUT}/${dir}`, { recursive: true });

/** A signed-in browser state for one person, made through the sign-in screen and reused for 45 minutes. Sign-in allows 5 a minute. */
export async function stateFor(email, password = "password") {
  const file = `${OUT}/states/${email.replace(/[^a-z0-9]+/gi, "_")}.json`;
  if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 45 * 60_000) return file;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ baseURL: BASE })).newPage();
  for (let attempt = 1; ; attempt++) {
    await page.goto("/signin");
    await page.getByPlaceholder("you@business.com").fill(email);
    await page.getByPlaceholder("Enter your password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try { await page.waitForURL(/\/(tenant|admin)/, { timeout: 20_000 }); break; } catch {
      if (attempt >= 4) { await browser.close(); throw new Error(`could not sign in as ${email}: ${(await page.locator("body").innerText()).slice(0, 200)}`); }
      await page.waitForTimeout(61_000);
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.context().storageState({ path: file });
  await browser.close();
  return file;
}

/**
 * Open the panel as one person. Every API call the page makes is kept in
 * `rows` (status, time, size, what was sent, the body of a refusal);
 * `step(name)` marks where one thing ends and the next begins; `ask(path)`
 * asks the server directly as this person; `report()` lists refusals,
 * console errors, repeated, slow and heavy requests.
 */
export async function open(who, { password = "password", viewport = { width: 1440, height: 900 }, stage = "qa", har = true, mobile = false, fresh = false } = {}) {
  const state = fresh ? undefined : await stateFor(who, password);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    baseURL: BASE, storageState: state, viewport, hasTouch: mobile, isMobile: mobile,
    ...(har ? { recordHar: { path: `${OUT}/har/${stage}.har`, urlFilter: /\/api\/v1\// } } : {}),
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("shopos-install-dismissed", String(Date.now())); } catch { /* blocked */ } });
  const page = await ctx.newPage();
  const rows = []; const errors = []; const pending = new Map();
  let phase = "start"; let n = 0;
  page.on("request", (r) => { if (r.url().includes("/api/v1/")) pending.set(r, Date.now()); });
  const done = async (r, failed) => {
    if (!pending.has(r)) return;
    const ms = Date.now() - pending.get(r); pending.delete(r);
    const res = failed ? null : await r.response().catch(() => null);
    let body = ""; let bytes = 0;
    try { const buf = res ? await res.body() : null; bytes = buf ? buf.length : 0; if (res && res.status() >= 400 && buf) body = buf.toString("utf8").slice(0, 400); } catch { /* gone */ }
    rows.push({ phase, method: r.method(), path: r.url().split("/api/v1")[1], status: res ? res.status() : `FAILED ${r.failure()?.errorText ?? ""}`, ms, bytes, body, sent: r.method() === "GET" ? "" : (r.postData() ?? "").slice(0, 600) });
  };
  page.on("requestfinished", (r) => void done(r, false));
  page.on("requestfailed", (r) => void done(r, true));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${phase}] ${m.text().slice(0, 300)}`); });
  page.on("pageerror", (e) => errors.push(`[${phase}] PAGE ERROR ${String(e).slice(0, 300)}`));

  const quiet = async (ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
  const step = (name) => { phase = name; };
  const shot = async (name, { full = true } = {}) => {
    n += 1; const file = `${OUT}/shots/${stage}-${String(n).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: file, fullPage: full }).catch((e) => console.log("shot failed", String(e).slice(0, 100)));
    return file;
  };
  // From the page once it is open; before that (about:blank has no storage), from the saved sign-in.
  const saved = () => {
    for (const o of JSON.parse(fs.readFileSync(state, "utf8")).origins) for (const kv of o.localStorage) if (kv.name === "shopos-auth") return JSON.parse(kv.value).state.accessToken;
    return undefined;
  };
  const token = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem("shopos-auth") ?? "{}").state?.accessToken).catch(() => undefined)) ?? (state ? saved() : undefined);
  const ask = async (p, init = {}) => {
    const res = await ctx.request.fetch(`${API}${p}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json", ...(init.headers ?? {}) } });
    const json = await res.json().catch(() => ({}));
    return { status: res.status(), data: json.data, meta: json.meta, message: json.message, errors: json.errors };
  };
  const report = ({ all = false } = {}) => {
    const out = [];
    const bad = rows.filter((r) => typeof r.status !== "number" || r.status >= 400);
    out.push(`requests: ${rows.length} · not ok: ${bad.length} · console errors: ${errors.length}`);
    for (const r of bad) out.push(`  ✗ [${r.phase}] ${r.status} ${r.method} ${r.path.slice(0, 90)}  ${r.body.replace(/\s+/g, " ").slice(0, 220)}`);
    for (const e of [...new Set(errors)].slice(0, 15)) out.push(`  ! ${e}`);
    const by = {}; for (const r of rows) { const k = `${r.phase} ‖ ${r.method} ${r.path}`; by[k] = (by[k] ?? 0) + 1; }
    for (const [k, c] of Object.entries(by)) if (c > 1) out.push(`  ×${c} same request in one step: ${k.slice(0, 150)}`);
    for (const r of rows) if (r.ms > 1200) out.push(`  slow ${r.ms}ms [${r.phase}] ${r.method} ${r.path.slice(0, 90)}`);
    for (const r of rows) if (r.bytes > 300_000) out.push(`  heavy ${Math.round(r.bytes / 1024)}KB [${r.phase}] ${r.method} ${r.path.slice(0, 90)}`);
    if (all) { let p = ""; for (const r of rows) { if (r.phase !== p) { p = r.phase; out.push(`── ${p}`); } out.push(`   ${String(r.status).padEnd(4)} ${r.method.padEnd(6)} ${String(r.ms).padStart(5)}ms ${String(r.bytes).padStart(8)}b ${r.path.slice(0, 100)}`); } }
    return out.join("\n");
  };
  const close = async () => { await ctx.close(); await browser.close(); };
  return { browser, ctx, page, rows, errors, quiet, step, shot, ask, report, close, state };
}

/** What a screen says, as text — for reading a table without squinting at a picture. */
export async function textOf(page, selector = "main") {
  const el = page.locator(selector).first();
  return (await el.count()) ? (await el.innerText()).replace(/\n{2,}/g, "\n").trim() : `(nothing matched ${selector})`;
}
