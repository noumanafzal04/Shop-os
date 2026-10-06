import { expect, test, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";
import { API, ownerAuth } from "./api";
import { openTill } from "./till";
import { TAXED, completeAndFetch, openTender, ring, stockTaxedShelf } from "./taxedShelf";

/**
 * A RECEIPT SET TO A ROLL COMES OUT ON A ROLL.
 *
 *     "Receipt main thermal 80mm select hai to POS screen main print wo size
 *      ni niklta na show hota — A4 size e hota hai."
 *
 * The templates asked for `@page { size: 80mm auto }`, which is not CSS. The
 * browser dropped it and the print dialog opened on an A4 sheet with a narrow
 * column down it.
 *
 * ── What "comes out" means here ──────────────────────────────────────
 *
 * No test can watch paper leave a printer. This goes as far as a browser
 * can be followed: the till is rung and Print is pressed for real; the
 * document it hands to the printer is caught at the moment of `print()`; and
 * that exact document is then printed to a PDF by the same engine, with the
 * page size left to the document's own CSS. The PDF's page is measured.
 */

const MM_PER_PT = 25.4 / 72;

async function setting(request: APIRequestContext, patch?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = patch
    ? await request.put(`${API}/shop/settings`, { headers: ownerAuth(), data: patch })
    : await request.get(`${API}/shop/settings`, { headers: ownerAuth() });
  expect(res.ok(), `shop settings ${patch ? "not saved" : "unreadable"} (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: { settings?: Record<string, unknown> } & Record<string, unknown> }).data;
}

let widthBefore = "standard";

test.beforeAll(async ({ request }) => {
  await stockTaxedShelf(request);
  const now = await setting(request);
  widthBefore = String((now.settings as Record<string, unknown> | undefined)?.receipt_width ?? now.receipt_width ?? "standard");
});

test.afterAll(async ({ request }) => {
  await setting(request, { receipt_width: widthBefore });
});

/** Ring one item, pay cash, press Print, and return the document the printer was handed. */
async function printed(page: import("@playwright/test").Page, request: APIRequestContext): Promise<{ html: string; rules: string[]; roll: string | null }> {
  // In EVERY frame: the receipt is printed from a frame of its own.
  await page.addInitScript(() => {
    window.print = () => {
      const rules: string[] = [];
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule.cssText.startsWith("@page")) rules.push(rule.cssText);
          const inner = (rule as CSSGroupingRule).cssRules;
          if (inner) walk(inner);
        }
      };
      for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
      (window.top as unknown as { __printed?: unknown }).__printed = {
        html: `<!doctype html>${document.documentElement.outerHTML}`,
        // What the BROWSER kept. A rule it could not parse is not in here.
        rules,
        roll: document.documentElement.getAttribute("data-roll-mm"),
      };
    };
  });

  await openTill(page);
  await ring(page, [TAXED.A.name, TAXED.B.name]);
  await openTender(page, "Cash");
  await page.getByRole("button", { name: /^Exact ·/ }).click();
  await completeAndFetch(page, request);

  await page.getByRole("button", { name: /^Print receipt$|^Print again$/ }).click();

  const handle = await page.waitForFunction(() => (window as unknown as { __printed?: unknown }).__printed, null, { timeout: 20_000 });

  return (await handle.jsonValue()) as { html: string; rules: string[]; roll: string | null };
}

/** Print that exact document with the engine's own idea of its page, and measure the page. */
async function pageOf(browser: import("@playwright/test").Browser, html: string): Promise<{ widthMm: number; heightMm: number; pages: number }> {
  const context = await browser.newContext();
  const sheet = await context.newPage();
  await sheet.setContent(html, { waitUntil: "load" });
  const pdf = (await sheet.pdf({ preferCSSPageSize: true })).toString("latin1");
  await context.close();

  const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  expect(boxes.length, "the printed document has no page").toBeGreaterThan(0);

  return {
    widthMm: Math.round(Number(boxes[0][3]) * MM_PER_PT),
    heightMm: Math.round(Number(boxes[0][4]) * MM_PER_PT),
    pages: (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length,
  };
}

for (const [setting_, mm] of [["thermal_80", 80], ["thermal_58", 58]] as const) {
  test(`a shop set to a ${mm}mm roll prints its receipt ${mm}mm wide, on one slip`, async ({ page, request, browser, browserName }) => {
    test.skip(browserName !== "chromium", "page.pdf is Chromium's");
    await setting(request, { receipt_width: setting_ });

    const doc = await printed(page, request);

    // The till says which paper it went to…
    await expect(page.getByText(new RegExp(`${mm}mm roll`))).toBeVisible();
    // …the document says which roll it is for…
    expect(doc.roll).toBe(String(mm));
    // …the browser KEPT a page size for it, and the last word is two lengths.
    const sized = doc.rules.filter((r) => /size:/.test(r));
    expect(sized.length, `no @page size survived parsing: ${doc.rules.join(" | ")}`).toBeGreaterThan(0);
    expect(sized.at(-1)).toMatch(new RegExp(`size: ${mm}mm \\d+mm`));

    // And printed, it IS that wide — one slip, as long as the receipt.
    const out = await pageOf(browser, doc.html);
    expect(out.widthMm, "the receipt did not print at the roll's width").toBe(mm);
    expect(out.pages, "the receipt ran onto a second slip").toBe(1);
    // A two-line receipt is a short slip: not an A4's length of blank roll.
    expect(out.heightMm).toBeLessThan(260);
    expect(out.heightMm).toBeGreaterThan(60);
  });
}

test("a shop set to A4 still prints an A4 sheet", async ({ page, request, browser, browserName }) => {
  test.skip(browserName !== "chromium", "page.pdf is Chromium's");
  await setting(request, { receipt_width: "standard" });

  const doc = await printed(page, request);

  expect(doc.roll).toBeNull();
  const out = await pageOf(browser, doc.html);
  expect([out.widthMm, out.heightMm]).toEqual([210, 297]);
});

test("the receipt template never asks for a size a browser throws away", async ({ request }) => {
  // Kept as a file on the side of the run, so a failure can be opened and read.
  await setting(request, { receipt_width: "thermal_80" });
  const res = await request.get(`${API}/receipts/preview`, { headers: { ...ownerAuth(), Accept: "text/html" } });
  test.skip(!res.ok(), "no preview endpoint at this address");
  const html = await res.text();
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync("test-results/receipt-preview.html", html);

  expect(html).not.toMatch(/size:\s*\d+mm\s+auto/);
});
