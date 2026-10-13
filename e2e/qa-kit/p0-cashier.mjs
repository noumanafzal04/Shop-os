// Phase 0 by hand, as the cashier: the dashboard keeps profit and expenses
// from her, and a size on sale rings up at the sale price — then is held under
// a label, resumed and paid, and the label is not the sale's customer.
import { open, textOf } from "./kit.mjs";

const DESIGN = "Lawn 3-Piece Unstitched";
const LABEL = "QA blue shirt";
const qa = await open("bilal@zariclothing.test", { password: "Staff-pass-1", stage: "p0-cashier" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
try {
  qa.step("dashboard");
  const dash = page.waitForResponse((r) => r.url().includes("/api/v1/dashboard"), { timeout: 30_000 });
  await page.goto("/tenant");
  const d = (await (await dash).json()).data;
  await qa.quiet(1500);
  out("dashboard.sees", d.sees);
  out("dashboard.today", { revenue: d.today.revenue, profit: d.today.profit, expenses: d.today.expenses });
  const main = await textOf(page);
  out("screen says Profit", /Profit/.test(main));
  out("screen says Expenses", /Expenses/.test(main));
  await qa.shot("dashboard");

  qa.step("till");
  await page.goto("/tenant/pos");
  await qa.quiet(2000);
  const search = page.getByPlaceholder(/scan barcode or search/i).first();
  await search.fill(DESIGN);
  await qa.quiet(1500);
  const tile = page.locator("[data-pos-item]").filter({ hasText: DESIGN }).first();
  out("tile", (await tile.innerText()).replace(/\s+/g, " "));
  await tile.click();
  await page.locator("[data-pos-size]").first().waitFor({ timeout: 10_000 });
  out("size sheet", (await page.locator("[data-pos-size]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")));
  await qa.shot("sizes");
  await page.locator('[data-pos-size="Teal"]').click();
  await page.locator("[data-cart-row]").first().waitFor({ timeout: 10_000 });
  out("cart line", (await page.locator("[data-cart-row]").first().innerText()).replace(/\s+/g, " "));
  out("grand total", (await page.locator("text=Grand Total").locator("..").innerText()).replace(/\s+/g, " "));

  qa.step("hold");
  await page.getByRole("button", { name: /^Hold\b/ }).click();
  out("hold prompt", (await page.getByRole("dialog").innerText()).replace(/\s+/g, " ").slice(0, 300));
  await page.getByPlaceholder(/blue shirt/).fill(LABEL);
  await qa.shot("hold-prompt");
  await page.getByRole("button", { name: "Hold ticket" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-cart-row]").length === 0, null, { timeout: 15_000 });

  qa.step("resume");
  await page.getByRole("button", { name: /Drafts/ }).first().click();
  const ticket = page.locator("li, tr, div").filter({ hasText: LABEL }).filter({ has: page.getByRole("button", { name: "Resume" }) }).last();
  await ticket.getByRole("button", { name: "Resume" }).click();
  await page.locator("[data-cart-row]").first().waitFor({ timeout: 15_000 });
  out("after resume, customer box", await page.locator("input[placeholder*='ustomer' i]").first().inputValue().catch(() => "(no box)"));

  qa.step("pay");
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  out("amount due", await page.getByTestId("tender-amount-due").innerText());
  await page.getByRole("button", { name: /^Complete/ }).click();
  await page.getByRole("heading", { name: "Sale complete" }).waitFor({ timeout: 20_000 });
  out("corrected by the server", await page.getByTestId("tender-corrected").count());
  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  out("invoice", invoice);
  await qa.shot("sale-complete");

  qa.step("what the server kept");
  const found = await qa.ask(`/sales?search=${encodeURIComponent(invoice)}&per_page=5`);
  const sale = (found.data ?? []).find((s) => s.invoice_number === invoice);
  out("sale", { status: found.status, total: sale?.total, customer_name: sale?.customer_name ?? "(absent)", has_field: sale ? "customer_name" in sale : false });
  const full = await qa.ask(`/sales/${sale.id}`);
  out("lines", (full.data?.items ?? []).map((l) => `${l.product_name} ${l.variant_name} @ ${l.unit_price}`));
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 400));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
