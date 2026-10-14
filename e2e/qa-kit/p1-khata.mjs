// Phase 1 · khata, as the cashier with his drawer open: part of what Ayesha
// owes in cash, a new sale on her khata at the till, then the rest by card.
// The balance, her statement, his drawer and the cashbook are read each time.
import { open, textOf } from "./kit.mjs";

const AYESHA = { name: "Ayesha Khan", phone: "03001234567" };
const qa = await open("bilal@zariclothing.test", { password: "Staff-pass-1", stage: "p1-khata" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
const drawer = async () => { const d = (await qa.ask("/pos/session/report")).data?.drawer; return { cash_in: d?.cash_in, cash_sales: d?.cash_sales, expected: d?.expected_cash, mix: d?.tender_mix }; };
const balance = async () => { const c = ((await qa.ask(`/customers?search=${AYESHA.phone}`)).data ?? [])[0]; return c?.credit_balance ?? c?.balance; };

async function sheet() {
  await page.goto("/tenant/customers");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: AYESHA.name }).first().click();
  const s = page.getByRole("dialog").filter({ hasText: "Credit (khata)" });
  await s.waitFor({ timeout: 15_000 });
  return s;
}
async function repay(amount, method) {
  qa.step(`repay ${amount} ${method}`);
  const s = await sheet();
  out("khata box before", oneLine(await s.getByText("Credit (khata)").locator("..").locator("..").innerText()).slice(0, 200));
  await s.getByPlaceholder("Payment amount").fill(String(amount));
  await s.getByLabel("Paid by").selectOption(method);
  await s.getByRole("button", { name: "Record" }).click();
  await qa.quiet(2000);
  out("khata box after", oneLine(await s.getByText("Credit (khata)").locator("..").locator("..").innerText()).slice(0, 400));
  await qa.shot(`repaid-${amount}`);
  await page.keyboard.press("Escape");
}

try {
  out("start", { balance: await balance(), drawer: await drawer() });
  await repay(1000, "cash");
  out("after cash repayment", { balance: await balance(), drawer: await drawer() });

  qa.step("a new sale on her khata");
  await page.goto("/tenant/pos");
  await qa.quiet(2000);
  await page.getByPlaceholder(/scan barcode or search/i).first().fill("Chiffon Dupatta");
  await qa.quiet(1500);
  await page.locator("[data-pos-item]").filter({ hasText: "Chiffon Dupatta" }).first().click();
  await page.locator("[data-cart-row]").first().waitFor({ timeout: 10_000 });
  await page.getByTitle(/No customer attached|Customer:/).first().click();
  const who = page.getByRole("dialog").filter({ hasText: "Leave blank for a walk-in sale" });
  await who.getByPlaceholder("03xx-xxxxxxx").fill(AYESHA.phone);
  await who.getByRole("button", { name: "Done" }).click();
  await qa.quiet(1500);
  out("till says about her", oneLine(await textOf(page, "main")).match(/Ayesha[^·]{0,80}(·[^·]{0,60}){0,2}/)?.[0] ?? "(her name not on the till)");
  await page.getByRole("button", { name: /Tender \/ Pay/i }).click();
  await page.getByRole("group", { name: "Payment method" }).getByRole("button", { name: /^Khata/ }).click();
  await qa.quiet(800);
  out("tender sheet", oneLine(await page.getByRole("dialog").last().innerText()).slice(0, 300));
  await page.getByRole("button", { name: /^Complete/ }).click();
  await page.getByRole("heading", { name: "Sale complete" }).waitFor({ timeout: 20_000 });
  const inv = await page.locator("[data-sale-invoice]").getAttribute("data-sale-invoice");
  out("khata sale", inv);
  await qa.shot("khata-sale");
  out("after khata sale", { balance: await balance(), drawer: await drawer() });

  await repay(2940, "card");
  out("after card repayment", { balance: await balance(), drawer: await drawer() });

  qa.step("her statement and the cashbook");
  const c = ((await qa.ask(`/customers?search=${AYESHA.phone}`)).data ?? [])[0];
  const full = (await qa.ask(`/customers/${c.id}`)).data;
  out("statement", (full.ledger ?? []).map((e) => `${e.type} ${e.amount} ${e.method ?? ""} → ${e.balance_after ?? ""}`));
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 800));
} finally {
  console.log(qa.report());
  await qa.close();
}
