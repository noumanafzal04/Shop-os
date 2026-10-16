// L14: a khata payment by transfer is seen on Day & banking and in Reports,
// beside the sales and never in them. Rings one credit sale (the till's own
// path), takes part of it by transfer on the customer's card, reads both screens.
import { open } from "./kit.mjs";

const WHO = { name: "QA Khata Walk", phone: "03009990001" };
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-khata-collected", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const today = new Date().toISOString().slice(0, 10);
const figures = async () => {
  const day = (await qa.ask("/pos/day")).data;
  const rep = (await qa.ask(`/reports/summary?period=custom&from=${today}&to=${today}`)).data;
  return { day_sales: day?.running?.sales_total, day_collected: day?.collections?.total, report_revenue: rep?.totals?.revenue, report_collected: rep?.collections?.total };
};

try {
  qa.step("a sale on khata");
  const session = (await qa.ask("/pos/session")).data;
  const item = ((await qa.ask("/products?search=Dupatta&per_page=5")).data ?? [])[0];
  const sale = await qa.ask("/sales", { method: "POST", data: {
    channel: "pos", cash_session_id: session?.id, customer_name: WHO.name, customer_phone: WHO.phone,
    payment_method: "credit", amount_paid: Number(item.price), items: [{ product_id: item.id, quantity: 1 }],
  } });
  out("credit sale", { status: sale.status, invoice: sale.data?.invoice_number, total: sale.data?.total });
  const before = await figures();
  out("before the payment", before);

  qa.step("600 by transfer on the card");
  await page.goto("/tenant/customers");
  await page.getByRole("row").filter({ hasText: WHO.name }).first().getByText(WHO.name).click();
  const box = page.getByRole("dialog").getByTestId("khata-box");
  await box.waitFor({ timeout: 15_000 });
  out("owes", flat(await box.getByTestId("khata-standing").innerText()));
  await box.getByRole("spinbutton", { name: "Payment amount" }).fill("600");
  await box.getByLabel("Paid by").selectOption("bank_transfer");
  await box.getByRole("button", { name: "Take payment" }).click();
  await box.getByTestId("khata-statement").getByText(/Paid · Transfer/).first().waitFor({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  const after = await figures();
  out("after the payment", after);
  out("sales unchanged", { day: after.day_sales === before.day_sales, report: after.report_revenue === before.report_revenue });
  out("collected grew by 600", { day: Math.round(((after.day_collected ?? 0) - (before.day_collected ?? 0)) * 100) / 100, report: Math.round(((after.report_collected ?? 0) - (before.report_collected ?? 0)) * 100) / 100 });

  qa.step("Day & banking");
  await page.goto("/tenant/day");
  const strip = page.getByTestId("khata-collected");
  await strip.waitFor({ timeout: 20_000 });
  out("day strip", flat(await strip.innerText()).slice(0, 300));
  await strip.scrollIntoViewIfNeeded();
  await qa.shot("day");

  qa.step("Reports");
  await page.goto("/tenant/reports");
  const rstrip = page.getByTestId("khata-collected");
  await rstrip.waitFor({ timeout: 20_000 });
  out("report strip", flat(await rstrip.innerText()).slice(0, 200));
  await rstrip.scrollIntoViewIfNeeded();
  await qa.shot("reports");

  qa.step("the name opens the customer");
  await page.goto("/tenant/day");
  await page.getByTestId("khata-collected").getByRole("link", { name: WHO.name }).first().click();
  await page.waitForURL(/\/tenant\/customers\?q=/, { timeout: 10_000 });
  await page.getByRole("row").filter({ hasText: WHO.name }).first().waitFor({ timeout: 10_000 });
  out("opened", page.url().replace(/^https?:\/\/[^/]+/, ""));

  console.log(qa.report());
} catch (e) {
  await qa.shot("failed");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await qa.close?.();
}
