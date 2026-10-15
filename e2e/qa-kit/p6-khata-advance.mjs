// L13/L15: paying MORE than a customer owes. The box asks first (keep the extra
// as an advance, or take only what is owed); an advance reads "Advance", the
// statement says "Paid · Transfer", and a credit sale's bill opens from it.
import { open } from "./kit.mjs";

const AYESHA = { name: "QA Khata Walk", phone: "03009990001" };
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-khata-advance", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const balance = async () => Number(((await qa.ask(`/customers?search=${AYESHA.phone}`)).data ?? [])[0]?.credit_balance);

try {
  if (!(await balance() > 0)) {
    // A credit sale on the till's own path, on Sana's shift — what any cashier does.
    qa.step("a sale on her khata");
    const session = (await qa.ask("/pos/session")).data;
    const item = ((await qa.ask("/products?search=Dupatta&per_page=5")).data ?? [])[0];
    const sale = await qa.ask("/sales", { method: "POST", data: {
      channel: "pos", cash_session_id: session?.id, customer_name: AYESHA.name, customer_phone: AYESHA.phone,
      payment_method: "credit", amount_paid: Number(item.price), items: [{ product_id: item.id, quantity: 1 }],
    } });
    out("credit sale", { status: sale.status, invoice: sale.data?.invoice_number, total: sale.data?.total, message: sale.message });
  }
  const before = await balance();
  out("balance before", before);
  if (!(before > 0)) throw new Error("she owes nothing — the walk needs a balance to overpay");
  const paying = Math.round((before + 50) * 100) / 100;

  qa.step("her card");
  await page.goto("/tenant/customers");
  await page.getByRole("row").filter({ hasText: AYESHA.name }).first().getByText(AYESHA.name).click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: AYESHA.name }) });
  const box = sheet.getByTestId("khata-box");
  await box.waitFor({ timeout: 15_000 });
  out("standing", flat(await box.getByTestId("khata-standing").innerText()));

  qa.step("pay 50 more than she owes, by transfer");
  await box.getByRole("spinbutton", { name: "Payment amount" }).fill(String(paying));
  await box.getByLabel("Paid by").selectOption("bank_transfer");
  await box.getByRole("button", { name: "Take payment" }).click();
  const ask = box.getByTestId("khata-overpay");
  await ask.waitFor({ timeout: 5_000 });
  out("asked", flat(await ask.innerText()));
  out("balance while asking (unchanged)", await balance());
  await qa.shot("overpay-asked");

  await ask.getByRole("button", { name: /^Keep .* as advance$/ }).click();
  await box.getByTestId("khata-standing").filter({ hasText: "Advance" }).waitFor({ timeout: 15_000 });
  out("standing after", flat(await box.getByTestId("khata-standing").innerText()));
  out("statement top", flat(await box.getByTestId("khata-statement").innerText()).slice(0, 220));
  out("balance after", await balance());
  await qa.shot("advance-kept");

  qa.step("a credit sale's bill opens from the statement");
  const bill = box.getByTestId("khata-statement").getByRole("link").first();
  const inv = await bill.innerText();
  await bill.click();
  await page.waitForURL(/\/tenant\/sales\?q=/, { timeout: 10_000 });
  out("url", page.url().replace(/^https?:\/\/[^/]+/, ""));
  const saleSheet = page.getByRole("dialog").filter({ hasText: inv });
  await saleSheet.waitFor({ timeout: 15_000 });
  out("sale sheet opened on", inv);
  await qa.shot("sale-opened");

  out("ended", { before, paying, after: await balance(), inv });
  console.log(qa.report());
} catch (e) {
  await qa.shot("failed");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await qa.close?.();
}
