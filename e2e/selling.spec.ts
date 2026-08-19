import { test, expect } from "@playwright/test";

import { API, ownerAuth } from "./api";
import { openTill, fillCart } from "./till";

/**
 * A SALE. THE WHOLE WAY THROUGH, IN A BROWSER.
 *
 * Two thousand backend tests ring sales over HTTP and a thousand panel tests
 * exercise the pieces in jsdom, and between them **no sale has ever been rung
 * through the actual screen**. Every one of them starts after the part a
 * cashier does: finding the product, tapping it, opening the tender panel,
 * pressing Complete.
 *
 * The rule this file is written to: **the till saying "Sale complete" is an
 * envelope, not a sale.** Every test here ends by asking the SERVER what it
 * has, because a modal that appears when the request failed is precisely the
 * shape of bug that survives a green suite.
 */

test("a cash sale rung on the till reaches the server", async ({ page, request }) => {
  const auth = ownerAuth();

  const before = await stockTotal(request, auth);

  await openTill(page);
  const lines = await fillCart(page, 2);
  expect(lines, "nothing went into the cart").toBe(2);

  // What the screen is about to charge. Read from the screen, so that the
  // figure being checked is the one the customer was shown.
  const shown = await page.locator("text=Grand Total").locator("..").innerText();
  const total = money(shown);
  expect(total, `the till showed no total (read "${shown}")`).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await expect(page.getByRole("heading", { name: "Tender / Pay" })).toBeVisible();

  await page.getByRole("button", { name: /^Complete sale/ }).click();

  // ── the envelope ─────────────────────────────────────────────────────
  await expect(page.getByRole("heading", { name: "Sale complete" })).toBeVisible({
    timeout: 20_000,
  });
  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  expect(invoice, "the receipt showed no invoice number").toBeTruthy();

  // ── the sale ─────────────────────────────────────────────────────────
  const res = await request.get(`${API}/sales?per_page=20`, { headers: auth });
  expect(res.ok(), `sales unreadable (${res.status()})`).toBeTruthy();
  const rows = ((await res.json()) as { data: Array<Record<string, unknown>> }).data;

  const sale = rows.find((r) => r.invoice_number === invoice);
  expect(
    sale,
    `the till said ${invoice} but the server's last ${rows.length} sales are ` +
      rows.map((r) => r.invoice_number).join(", "),
  ).toBeTruthy();

  expect(Number(sale!.total), "the server charged a different total than the screen showed")
    .toBeCloseTo(total, 2);

  // ── and the shelf ────────────────────────────────────────────────────
  //
  // The denominator that makes the rest mean something: a sale that posts but
  // takes nothing off the shelf is the one that shows up as a stock loss three
  // weeks later.
  const after = await stockTotal(request, auth);
  expect(before - after, "the sale posted but the shelf did not move").toBe(lines);
});

/** Every tracked product's stock, summed. */
async function stockTotal(
  request: import("@playwright/test").APIRequestContext,
  auth: Record<string, string>,
): Promise<number> {
  const res = await request.get(`${API}/products?per_page=100`, { headers: auth });
  const body = (await res.json()) as { data: Array<{ stock_quantity?: string | number }> };
  return body.data.reduce((s, p) => s + Number(p.stock_quantity ?? 0), 0);
}

/** "Grand Total Rs 1,234.00" → 1234 */
function money(text: string): number {
  const m = text.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/g);
  if (!m) return 0;
  return Math.max(...m.map(Number));
}

/**
 * SELLING WITH THE LINE DOWN.
 *
 * This has never once run in a browser. jsdom reports `navigator.onLine ===
 * true` and nothing can change it, so every offline test in this repo has
 * exercised the offline path *while the app believed it was online* — and the
 * one thing that actually breaks is TanStack Query, which **pauses** every
 * query and mutation the moment `onLine` goes false. A paused mutation does not
 * fail. It simply never resolves, and the cashier watches a spinner.
 *
 * `context.setOffline(true)` is the only thing in this project that can put the
 * app in that state.
 */
test("the till sells with the line down, and the queue drains when it returns", async ({
  page,
  context,
  request,
}) => {
  const auth = ownerAuth();

  // ── ONE DEVICE ID PER PROJECT ────────────────────────────────────────
  //
  // The offline slip is `OFF-<register>-<4 chars of the device id>-<counter>`,
  // and the counter lives in IndexedDB while the device id lives in
  // localStorage. Playwright's projects share the saved localStorage but each
  // gets a FRESH IndexedDB — so all four "devices" carried one device id and
  // each restarted its counter at 000001. The second project's first offline
  // sale was then a slip the server had already recorded, and the shop's real
  // unique index refused it: every project after the first failed with "the
  // queue never drained".
  //
  // Four tills sharing one device id is not a thing that happens; four tills
  // with four ids is. Stamped before any of the app's own scripts run.
  await page.addInitScript((id: string) => {
    localStorage.setItem("shopos-device-id", id);
  }, deviceIdFor(test.info().project.name));

  await openTill(page);
  // The till's own copy of the catalog is what it sells from offline. Give the
  // boot pull a moment; without it the offline pane is empty and this test
  // fails for a reason that is about timing, not about selling.
  await page.waitForTimeout(3000);

  const before = await invoices(request, auth);

  // ── the line drops ───────────────────────────────────────────────────
  await context.setOffline(true);
  expect(
    await page.evaluate(() => navigator.onLine),
    "the browser did not actually go offline — every assertion below would be about an online till",
  ).toBe(false);
  await page.waitForTimeout(2000);

  const lines = await fillCart(page, 2);
  expect(lines, "the offline till could not put anything in the cart").toBe(2);

  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("button", { name: /^Complete sale/ }).click();

  await expect(
    page.getByRole("heading", { name: "Sale complete" }),
    "the till never completed the sale offline — a paused mutation never fails, it just never resolves",
  ).toBeVisible({ timeout: 25_000 });

  const slip = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  expect(slip, "an offline sale must carry its own slip number, not a server invoice")
    .toMatch(/^OFF-/);

  // ── the denominator: it really was offline ───────────────────────────
  //
  // Playwright's `request` fixture is its own context and is NOT taken offline
  // with the page, so the server can still be asked. If the sale were on it
  // already, everything above would have been an ordinary online sale wearing
  // an offline test's name.
  const during = await invoices(request, auth);
  expect(
    during.length,
    `the server gained a sale while the till was offline (${during.length} vs ${before.length})`,
  ).toBe(before.length);

  await page.getByRole("button", { name: "New sale" }).click();

  // ── the line comes back ──────────────────────────────────────────────
  await context.setOffline(false);
  await page.waitForTimeout(1500);

  // Nudge it the way a cashier would, where the control is on screen.
  const pill = page.getByRole("button", { name: /Offline|No server|saved here|Online|Sending/ }).first();
  if (await pill.isVisible().catch(() => false)) await pill.click();

  // NOT `after.length === before.length + 1`. `/sales` is PAGED — fifty rows —
  // so once a shop has fifty sales the length never changes again and the check
  // reads "the queue never drained" for ever, about a queue that drained in
  // eight seconds. Compare the numbers themselves.
  const known = new Set(before);
  let arrived: string | undefined;
  for (let i = 0; i < 12 && !arrived; i++) {
    await page.waitForTimeout(2500);
    arrived = (await invoices(request, auth)).find((n) => n && !known.has(n));
  }

  // If it did not arrive, say what the ROW says. "The queue never drained" is
  // a symptom; the row carries the cause — how many attempts, what the server
  // answered, whether it was in fact acked and only the badge was wrong.
  const row = arrived
    ? null
    : await page.evaluate(
        async () =>
          await new Promise<string>((resolve) => {
            const req = indexedDB.open("shopos-till");
            req.onsuccess = () => {
              const g = req.result.transaction("outbox", "readonly").objectStore("outbox").getAll();
              g.onsuccess = () =>
                resolve(
                  JSON.stringify(
                    g.result.map((r: Record<string, unknown>) => ({
                      status: r.status,
                      attempts: r.attempts,
                      error: r.error,
                      invoiceNumber: r.invoiceNumber,
                      offlineNumber: r.offlineNumber,
                    })),
                  ),
                );
              g.onerror = () => resolve("[unreadable]");
            };
            req.onerror = () => resolve("[no database]");
          }),
      );

  expect(
    arrived,
    `the queue never drained — the sale is still only on the device. Outbox: ${row}`,
  ).toBeTruthy();

  // ── and the till must SAY so ─────────────────────────────────────────
  //
  // The sale reaching the server is not the end of this. The pill is what a
  // shopkeeper reads to answer "is my day safe?", and it went "Sending 1 of 1"
  // → "1 still to send" and stayed there: the queue was empty and the badge
  // said it was not, at the one moment the badge exists for.
  await expect
    .poll(
      async () =>
        (await page.locator("button").filter({ hasText: /still to send|saved here/ }).count()),
      {
        message:
          "the sale is on the server and the till still says it is waiting to be sent",
        timeout: 20_000,
      },
    )
    .toBe(0);
});

test("a cashier can always tell the till has lost the line", async ({ page, context }) => {
  // The pill is the ONLY thing on this screen that reflects the connection, and
  // it is `hidden … sm:flex`. On a phone that leaves a till which has silently
  // stopped reaching the server looking exactly like one that has not — while
  // sales pile up on the device.
  await openTill(page);
  await context.setOffline(true);
  await page.waitForTimeout(2500);

  const said = await page.evaluate(() => {
    const words = /offline|no server|saved here|not connected|no connection/i;
    const seen: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      // The element's OWN words, not `textContent`, and not "leaves only".
      //
      // The first version of this skipped anything with an element child, and
      // the pill it was written to find is `<button><span dot/>Offline</button>`
      // — a button with one child. So the rule reported that the till said
      // nothing about being offline while the word "Offline" sat on screen in
      // red. Ask each element what IT says.
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent ?? "").trim())
        .join(" ")
        .trim();
      if (!own || !words.test(own)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      seen.push(own.slice(0, 60));
    }
    return seen;
  });

  expect(
    said.length,
    "with the line down the till said nothing a cashier could see — " +
      "sales will queue on this device with no sign of it",
  ).toBeGreaterThan(0);
});

/** Every invoice/slip number the server currently holds, newest first. */
async function invoices(
  request: import("@playwright/test").APIRequestContext,
  auth: Record<string, string>,
): Promise<string[]> {
  const res = await request.get(`${API}/sales?per_page=50`, { headers: auth });
  if (!res.ok()) return [];
  const body = (await res.json()) as { data: Array<{ invoice_number?: string }> };
  return body.data.map((r) => r.invoice_number ?? "");
}

/**
 * A device id that is new for every project AND every run.
 *
 * Only four characters of it reach the slip (`DEVICE_SEGMENT = 4`), so ids that
 * merely differ somewhere are not enough — "tablet-landscape" and
 * "tablet-portrait" would both come out `TABL`.
 *
 * And it must be new per RUN, not merely per project. Each test gets a fresh
 * IndexedDB, so the slip counter restarts at `000001` every time; a device
 * segment that stayed the same between runs meant the second run's first
 * offline sale was a slip the server already had, and the shop's unique index
 * refused it — the till then retried that number for ever.
 *
 * **That is a real defect, not a test artifact**: the counter lives in
 * IndexedDB and the device id in localStorage, so a shop whose IndexedDB is
 * evicted lands in exactly this state and can never send another offline sale.
 * It is written up in `docs/qa/FINDINGS.md` and left for a decision, because
 * the slip is printed, handed to a customer and is the handle a refund is found
 * by. A fresh id per run keeps THIS spec about selling offline rather than
 * about numbering.
 */
function deviceIdFor(project: string): string {
  let h = 0;
  for (const ch of `${project}:${Date.now()}:${Math.random()}`) {
    h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  }
  const tag = h.toString(16).padStart(8, "0").slice(0, 4);

  return `${tag}0000-e2e0-4000-8000-00000000e2e0`;
}
