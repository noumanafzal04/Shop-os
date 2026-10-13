import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * WHAT THE SHELL NEEDS IS KEPT ON THE DEVICE — a reload does not ask for it.
 *
 * Opening any screen used to ask the server seven things before the screen
 * asked its own: who am I, the shop's settings, its branches, the bell, this
 * till announcing itself, the till's roster and the catalogue's changes. Five
 * reloads were thirty-five requests for answers the device already had, and
 * a person is allowed 240 a minute.
 *
 * They are kept now (`src/common/kept`), and this is the browser's half of
 * the proof — the unit tests count calls to a mocked service; this counts
 * what actually went over the wire:
 *
 *   a reload asks for the screen, and nothing for the shell
 *   a setting saved here is what the next load opens with, unasked
 *   a change made SOMEWHERE ELSE reaches this device on its next request —
 *     the server's stamp, without which "kept" would mean "stale"
 *
 * Counted by the API's whole address. The dev server serves source files
 * whose paths contain the same words (`…/shop/settings…`), and the first
 * count ever made of this kind was of those.
 */

/** What the shell used to ask on every load. */
const SHELL = ["/auth/me", "/shop/settings", "/branches", "/pos/devices", "/pos-devices", "/pos/catalog", "/orders/waiting"];

type Row = Record<string, unknown>;

/** Every API call the page makes from now on, as "GET /path". */
function listen(page: Page): { asked: () => string[]; forget: () => void } {
  let seen: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (url.startsWith(`${API}/`)) seen.push(`${r.method()} ${url.slice(API.length).split("?")[0]}`);
  });

  return { asked: () => [...seen], forget: () => { seen = []; } };
}

const ofTheShell = (asked: string[]) => asked.filter((line) => SHELL.some((path) => line === `GET ${path}` || line === `POST ${path}`));

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

async function settings(request: APIRequestContext, patch?: Row): Promise<Row> {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: ownerAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: ownerAuth() });
  expect(res.ok(), `shop settings ${patch ? "not saved" : "unreadable"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Row }).data;
}

/** What the device is holding, read straight out of its storage. */
const keptOnTheDevice = (page: Page, name: string) =>
  page.evaluate((key) => {
    const raw = localStorage.getItem("shopos-kept");
    const record = raw ? (JSON.parse(raw) as { state: { record: { held: Record<string, { data: unknown }> } | null } }).state.record : null;

    return record?.held[key]?.data ?? null;
  }, name);

test.describe.configure({ mode: "serial" });

test("a reload asks for the screen and nothing for the shell", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "what a device asks does not depend on its width");

  const wire = listen(page);

  // The first opening may ask for anything that is due — a session older than
  // five minutes, a catalogue not pulled since. That is the kept answers
  // doing their job, and it is not what is being counted.
  await page.goto("/tenant/products");
  await expect(page.getByRole("heading", { name: /Products/ }).first()).toBeVisible({ timeout: 20_000 });
  await settle(page);

  for (const screen of ["/tenant/products", "/tenant/customers", "/tenant/sales", "/tenant"]) {
    wire.forget();
    await page.goto(screen);
    await settle(page);

    const asked = wire.asked();
    expect(asked.length, `${screen} asked the server nothing at all — the page is not the app`).toBeGreaterThan(0);
    expect(ofTheShell(asked), `reloading ${screen} asked for what the device already holds`).toEqual([]);
  }

  // The bell still rings on its half minute. Four reloads inside one are not four askings.
  wire.forget();
  for (const screen of ["/tenant/products", "/tenant/customers", "/tenant/sales", "/tenant"]) {
    await page.goto(screen);
    await page.waitForLoadState("networkidle").catch(() => {});
  }
  const bell = wire.asked().filter((line) => line === "GET /notifications").length;
  expect(bell, "every reload asked the bell again").toBeLessThanOrEqual(2);
});

test("a setting saved here is what the next load opens with — and that load does not ask", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "what a device asks does not depend on its width");

  const before = await settings(request);
  const was = String(before.label_stock ?? "50x25");
  const to = was === "38x25" ? "50x25" : "38x25";

  const wire = listen(page);
  await page.goto("/tenant/labels");
  const size = page.getByTestId("label-settings").getByLabel("Sticker size");
  await expect(size).toHaveValue(was, { timeout: 20_000 });
  await settle(page);

  // ── saved here ──────────────────────────────────────────────────────
  wire.forget();
  await size.selectOption(to);
  await expect.poll(async () => (await settings(request)).label_stock, { message: "the sticker size was not saved" }).toBe(to);
  await settle(page);
  expect(wire.asked().filter((line) => line === "GET /shop/settings").length, "a save did not ask for the settings again — the screen is showing its own guess").toBeGreaterThanOrEqual(1);
  expect(((await keptOnTheDevice(page, "shop-settings")) as Row | null)?.label_stock, "the screen has the new size and the device still holds the old one").toBe(to);

  // ── the next load ───────────────────────────────────────────────────
  wire.forget();
  await page.reload();
  await expect(page.getByTestId("label-settings").getByLabel("Sticker size"), "the reload opened with the setting from before the save").toHaveValue(to, { timeout: 20_000 });
  await settle(page);
  expect(ofTheShell(wire.asked()), "the load after a save asked for what the save had just refreshed").toEqual([]);

  await page.getByTestId("label-settings").getByLabel("Sticker size").selectOption(was);
  await expect.poll(async () => (await settings(request)).label_stock).toBe(was);
});

test("a change made somewhere else reaches this device on its next request", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "what a device asks does not depend on its width");

  // Two values nothing else reads: the area the shop says it delivers to.
  const now = String((await settings(request)).service_area ?? "");
  const next = now === "E2E Gulberg" ? "E2E Gulberg and DHA" : "E2E Gulberg";

  const wire = listen(page);
  await page.goto("/tenant/customers");
  await settle(page);
  wire.forget();
  await page.reload();
  await settle(page);
  expect(ofTheShell(wire.asked()), "the device asked before anything had changed").toEqual([]);

  // ── somebody else changes the shop: another device, the office, an admin ──
  await settings(request, { service_area: next });

  // ── and this device does nothing but reload ─────────────────────────
  wire.forget();
  await page.reload();
  await expect
    .poll(async () => ((await keptOnTheDevice(page, "shop-settings")) as Row | null)?.service_area, {
      message: "a change made elsewhere did not reach this device when it reloaded — it is showing what it kept",
      timeout: 15_000,
    })
    .toBe(next);
  await settle(page);
  const asked = wire.asked();
  // Told by the stamp on the screen's own request, it asked once for each
  // kept answer the stamp speaks for — not zero, and not on a loop.
  expect(asked.filter((line) => line === "GET /shop/settings").length).toBe(1);
  expect(asked.filter((line) => line === "GET /auth/me").length).toBe(1);

  // ── after which it is quiet again ───────────────────────────────────
  wire.forget();
  await page.reload();
  await settle(page);
  expect(ofTheShell(wire.asked()), "the device went on asking after it had the change").toEqual([]);
});
