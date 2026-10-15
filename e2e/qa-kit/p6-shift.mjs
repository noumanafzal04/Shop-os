// A shop that asks for shifts: a shift left open since an earlier day is no
// shift. The till says so in a banner, every other counter screen says so and
// will not take the money, and closing it and opening today's lets the sale through.
import { open, textOf } from "./kit.mjs";

const DESIGN = "Lawn 3-Piece Unstitched";
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-shift", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const notice = async () => ((await page.getByTestId("shift-needed").count()) ? flat(await page.getByTestId("shift-needed").first().innerText()) : "(no notice)");
try {
  qa.step("server says");
  const s0 = await qa.ask("/pos/session");
  out("session before", { id: s0.data?.id, status: s0.data?.status, opened_on: s0.data?.opened_on, earlier: s0.data?.from_an_earlier_day });
  out("pos_require_shift", (await qa.ask("/shop/settings")).data?.pos_require_shift);

  const resume = s0.data?.status !== "open";
  if (!resume) {
  qa.step("till, stale shift");
  await page.goto("/tenant/pos");
  await page.getByTestId("shift-banner").waitFor({ timeout: 30_000 });
  out("banner at once", flat(await page.getByTestId("shift-banner").innerText()));
  await qa.quiet(1500);
  const banner = page.getByTestId("shift-banner");
  out("banner", flat(await banner.innerText()));
  out("banner red", /bg-error/.test(await banner.getAttribute("class")));
  await page.getByPlaceholder(/scan barcode or search/i).first().fill(DESIGN);
  await qa.quiet(1200);
  await page.locator("[data-pos-item]").filter({ hasText: DESIGN }).first().click();
  await page.locator('[data-pos-size="Teal"]').click();
  await page.locator("[data-cart-row]").first().waitFor({ timeout: 10_000 });
  out("Tender / Pay enabled with a stale shift", await page.getByRole("button", { name: /Tender \/ Pay/i }).isEnabled());
  await qa.shot("till-stale");

  qa.step("new sale, stale");
  await page.goto("/tenant/sales/new");
  await qa.quiet(1500);
  out("new sale notice", await notice());
  await qa.shot("new-sale-stale");

  qa.step("exchange, stale");
  const sales = (await qa.ask("/sales?per_page=10&status=completed")).data ?? [];
  const one = sales.find((x) => x.status === "completed");
  await page.goto(`/tenant/sales?q=${encodeURIComponent(one.invoice_number)}`);
  await page.getByText(one.invoice_number).first().click();
  await page.getByRole("button", { name: "Exchange", exact: true }).click();
  await qa.quiet(1000);
  out("exchange notice", await notice());
  out("Complete exchange enabled", await page.getByRole("button", { name: "Complete exchange" }).isEnabled());
  await qa.shot("exchange-stale");

  qa.step("bill a quotation, stale");
  const docs = (await qa.ask("/sale-documents?per_page=20")).data ?? [];
  const quote = docs.find((d) => d.number === "QUO-000001") ?? docs.find((d) => d.type === "quotation");
  await page.goto(`/tenant/documents/${quote.id}`);
  await page.getByRole("button", { name: /Bill & hand over/ }).click();
  await qa.quiet(800);
  out("bill notice", await notice());
  out("Bill it enabled", await page.getByRole("button", { name: "Bill it" }).isEnabled());
  await qa.shot("bill-stale");

  qa.step("close the old shift");
  const z = (await qa.ask(`/pos/sessions/${s0.data.id}/z-report`)).data;
  const expected = z?.summary?.expected_cash ?? z?.expected_cash;
  out("expected in the drawer", expected);
  await page.goto("/tenant/pos");
  await page.getByTestId("shift-banner").getByRole("button", { name: "Close shift" }).click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Counted" });
  await dlg.waitFor({ timeout: 10_000 });
  if (await dlg.locator("#counted-cash").count()) await dlg.locator("#counted-cash").fill(String(Number(expected)));
  else out("close dialog (counted by note)", flat(await dlg.innerText()).slice(0, 300));
  await qa.shot("close-dialog");
  await dlg.getByRole("button", { name: "Close shift" }).click();
  await page.getByTestId("shift-banner").filter({ hasText: /Open a shift/i }).waitFor({ timeout: 20_000 }).catch(() => {});
  out("banner after close", flat(await page.getByTestId("shift-banner").innerText().catch(() => "(none)")));
  await qa.shot("no-shift");
  } else { await page.goto("/tenant/pos"); await page.getByTestId("shift-banner").waitFor({ timeout: 30_000 }); out("banner (resumed)", flat(await page.getByTestId("shift-banner").innerText())); }

  qa.step("open today's");
  await page.getByTestId("shift-banner").getByRole("button", { name: "Open shift" }).click();
  const od = page.getByRole("dialog").filter({ hasText: "Opening cash float" });
  await od.locator('input[type="number"]').first().fill("5000");
  await od.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByTestId("shift-banner").waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
  out("banner after open", await page.getByTestId("shift-banner").count());
  const s1 = await qa.ask("/pos/session");
  out("session after", { id: s1.data?.id, opened_on: s1.data?.opened_on, earlier: s1.data?.from_an_earlier_day, float: s1.data?.opening_float });
  

  qa.step("sell on today's shift");
  if ((await page.locator("[data-cart-row]").count()) === 0) {
    await page.getByPlaceholder(/scan barcode or search/i).first().fill(DESIGN);
    await qa.quiet(1200);
    await page.locator("[data-pos-item]").filter({ hasText: DESIGN }).first().click();
    await page.locator('[data-pos-size="Teal"]').click();
    await page.locator("[data-cart-row]").first().waitFor({ timeout: 10_000 });
  }
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Cash/ }).click();
  out("amount due", await page.getByTestId("tender-amount-due").innerText());
  await page.getByRole("button", { name: /^Complete/ }).click();
  await page.getByRole("heading", { name: "Sale complete" }).waitFor({ timeout: 20_000 });
  const invoice = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  out("invoice", invoice);
  await qa.shot("sold");
  const found = ((await qa.ask(`/sales?search=${encodeURIComponent(invoice)}&per_page=5`)).data ?? []).find((x) => x.invoice_number === invoice);
  const full = (await qa.ask(`/sales/${found.id}`)).data;
  out("sale kept", { total: full.total, session: full.cash_session_id ?? full.session_id, on_new_shift: (full.cash_session_id ?? full.session_id) === s1.data?.id, business_day: full.business_day_id, completed_at: full.completed_at ?? full.created_at });
  const s2 = await qa.ask("/pos/session");
  out("drawer after", { cash_sales: s2.data?.cash_sales, sales_count: s2.data?.sales_count });

  qa.step("other screens, today's shift");
  await page.goto("/tenant/sales/new");
  await qa.quiet(1500);
  out("new sale notice now", await notice());
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
