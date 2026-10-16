// F1: goods go home on installments. Started from Quotations & advances, one
// installment taken on the plan (pressed twice), one taken from the customer's
// card (asked "is this an installment?"), and after every step the server's
// records are read back: the sale, the khata, the income, the plan, the drawer,
// the day and the report — so a wrong entry shows as a FAIL line.
import { open } from "./kit.mjs";

const WHO = { name: "QA Qist Walk", phone: "03007770001" };
const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-installments", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const n = (v) => Math.round(Number(v) * 100) / 100;
let failed = 0;
const check = (what, ok, saw) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` — saw ${JSON.stringify(saw)}`}`); };
// The shop's calendar day (Karachi, turning at 05:00) — never the UTC date.
const today = async () => new Date(Date.now() - 5 * 3_600_000).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const money = async () => {
  const d = await today();
  const day = (await qa.ask("/pos/day")).data;
  const rep = (await qa.ask(`/reports/summary?period=custom&from=${d}&to=${d}`)).data;
  const drawer = (await qa.ask("/pos/session/report")).data?.drawer;
  return { revenue: n(rep?.totals?.revenue ?? 0), other: n(rep?.totals?.other_income ?? 0), collected: n(rep?.collections?.total ?? 0), day_collected: n(day?.collections?.total ?? 0), drawer: n(drawer?.expected_cash ?? 0) };
};

try {
  qa.step("today's shift");
  let s = (await qa.ask("/pos/session")).data;
  if (s?.from_an_earlier_day) {
    const rep = (await qa.ask("/pos/session/report")).data;
    const closed = await qa.ask("/pos/session/close", { method: "POST", data: { counted_cash: rep.drawer.expected_cash, notes: "QA walk: counted to what it should hold" } });
    out("closed the earlier day's shift", { status: closed.status, counted: rep.drawer.expected_cash, message: closed.message });
    s = null;
  }
  if (!s) {
    const opened = await qa.ask("/pos/session/open", { method: "POST", data: { opening_float: 5000 } });
    out("opened today's shift", { status: opened.status, message: opened.message });
  }
  const before = await money();
  out("money before", before);

  const owedBefore = n(((await qa.ask(`/customers?search=${WHO.phone}`)).data ?? [])[0]?.credit_balance ?? 0);
  out("khata before", owedBefore);

  qa.step("sell on installments");
  await page.goto("/tenant/documents");
  await page.getByRole("button", { name: "On installments", exact: true }).click();
  await page.getByTestId("installments").waitFor({ timeout: 15_000 });
  await qa.quiet(800);
  await page.getByRole("button", { name: "Sell on installments" }).click();
  const pick = page.getByRole("dialog").filter({ hasText: "Pick what goes home" });
  await pick.getByPlaceholder("Search products…").fill("Silk Scarf");
  await qa.quiet(1200);
  await pick.getByTestId("document-offers").getByRole("button").filter({ hasNot: page.locator("[disabled]") }).first().click();
  await pick.getByRole("button", { name: "One more Silk Scarf" }).click();
  out("picked", flat(await pick.getByTestId("document-lines").innerText()));
  await pick.getByRole("button", { name: "Next" }).click();

  const form = page.getByRole("dialog").filter({ hasText: "The goods go home today" });
  await form.locator("#ins-name").fill(WHO.name);
  await form.locator("#ins-phone").fill(WHO.phone);
  await form.locator("#ins-markup").fill("10");
  await form.locator("#ins-months").fill("3");
  await form.locator("#ins-advance").fill("500");
  await form.locator("#ins-method").selectOption("card");
  await qa.quiet(500);
  const preview = flat(await form.getByTestId("installment-preview").innerText());
  out("preview", preview);
  await qa.shot("start-form");
  await form.getByRole("button", { name: "Hand over & start plan" }).click();
  const sheet = page.getByTestId("installment-plan");
  await sheet.waitFor({ timeout: 15_000 });
  await qa.quiet(1000);
  out("plan sheet", flat(await sheet.innerText()).slice(0, 420));
  await qa.shot("plan-started");

  qa.step("what was written");
  const plan = ((await qa.ask(`/installment-plans?status=all&search=${WHO.phone}`)).data ?? [])[0];
  const p = (await qa.ask(`/installment-plans/${plan.id}`)).data;
  out("plan", { number: p.number, cash: p.cash_price, markup: p.markup, total: p.total, advance: p.advance, financed: p.financed, months: p.months, monthly: p.monthly, last: p.last_month, first_due: p.first_due_on, left: p.standing.left });
  const sale = (await qa.ask(`/sales/${p.sale_id}`)).data;
  const cust = (await qa.ask(`/customers/${p.customer_id}`)).data;
  const income = ((await qa.ask(`/incomes?search=${p.number}`)).data ?? []).filter((i) => i.reference === p.number);
  out("sale", { invoice: sale.invoice_number, total: sale.total, payments: (sale.payments ?? []).map((x) => [x.method, x.amount]), notes: sale.notes });
  out("khata", { balance: cust.credit_balance, ledger: (cust.ledger ?? []).slice(0, 3).map((e) => [e.type, e.amount, e.note ?? e.method, e.sale?.invoice_number]) });
  out("income", income.map((i) => [i.description, i.amount]));
  check("the preview's sum is the plan's", preview.includes(`2 × Rs ${Number(p.monthly).toLocaleString("en-US")}`) && preview.includes(`= Rs ${Number(p.total).toLocaleString("en-US")}`), preview);
  check("the sale is the cash price", n(sale.total) === n(p.cash_price), [sale.total, p.cash_price]);
  check("advance + months = the bill", n(n(p.advance) + n(p.monthly) * (p.months - 1) + n(p.last_month)) === n(p.total), p);
  check("the khata grew by what is financed", n(n(cust.credit_balance) - owedBefore) === n(p.financed), [owedBefore, cust.credit_balance, p.financed]);
  check("one income, the installment charge", income.length === 1 && n(income[0].amount) === n(p.markup), income);
  check("the plan names its bill on the sheet", (await sheet.innerText()).includes(sale.invoice_number), sale.invoice_number);
  const afterStart = await money();
  check("the sale counts once in today's sales", n(afterStart.revenue - before.revenue) === n(p.cash_price), [before.revenue, afterStart.revenue]);
  check("the charge is other income", n(afterStart.other - before.other) === n(p.markup), [before.other, afterStart.other]);
  check("the card advance is not cash in the drawer", afterStart.drawer === before.drawer, [before.drawer, afterStart.drawer]);

  qa.step("one month in cash, pressed twice");
  // One month's amount — the chip says "Up to date" when that is the same figure.
  await sheet.getByRole("group", { name: "Fill the amount" }).getByRole("button", { name: new RegExp(`· Rs ${Number(p.monthly).toLocaleString("en-US")}$`) }).first().click();
  out("says before the press", flat(await sheet.getByTestId("installment-after").innerText()));
  await sheet.getByLabel("Paid by").selectOption("cash");
  await sheet.getByRole("button", { name: "Take installment" }).dblclick();
  await qa.quiet(1800);
  const p1 = (await qa.ask(`/installment-plans/${plan.id}`)).data;
  out("months", (p1.standing.rows ?? []).map((r) => `${r.n}:${r.state}:${r.paid}/${r.amount}`));
  out("payments", (p1.payments ?? []).map((x) => [x.method, x.amount, x.taken_by]));
  check("one press, one installment", (p1.payments ?? []).length === 1, p1.payments);
  check("it filled the first month", p1.standing.rows[0].state === "paid" && p1.standing.months_paid === 1, p1.standing.rows[0]);
  check("left = financed − paid", n(p1.standing.left) === n(n(p.financed) - n(p.monthly)), p1.standing.left);
  const owed1 = n((await qa.ask(`/customers/${p.customer_id}`)).data.credit_balance);
  check("the khata came down by the same", n(owed1 - owedBefore) === n(p1.standing.left), [owedBefore, owed1, p1.standing.left]);
  const afterCash = await money();
  check("the cash is in the drawer", n(afterCash.drawer - afterStart.drawer) === n(p.monthly), [afterStart.drawer, afterCash.drawer]);
  check("the day lists it as collected", n(afterCash.day_collected - afterStart.day_collected) === n(p.monthly), [afterStart.day_collected, afterCash.day_collected]);
  check("it is not a second sale", afterCash.revenue === afterStart.revenue, [afterStart.revenue, afterCash.revenue]);
  check("the sheet shows it", (await sheet.getByTestId("installment-months").innerText()).includes("Paid"), "");
  await qa.shot("one-month-paid");
  await sheet.getByRole("button", { name: "Close" }).click();

  qa.step("the list");
  const tab = page.getByTestId("installments");
  await qa.quiet(1000);
  out("tiles", flat(await tab.locator("> div").first().innerText()));
  out("chips", flat(await page.getByTestId("installment-filters").innerText()));
  const row = tab.locator("tbody tr").filter({ hasText: p.number });
  out("row", flat(await row.innerText()));
  out("to collect", flat(await row.getByTestId("to-collect").innerText()));
  for (const chip of ["Due this month", "Due this week", "Late", "All plans"]) {
    await page.getByTestId("installment-filters").getByRole("button", { name: new RegExp(`^${chip}`) }).click();
    await qa.quiet(900);
    out(`${chip} rows`, await tab.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => `[${tr.dataset.state}] ${tr.innerText.replace(/\s+/g, " ").slice(0, 90)}`)));
  }
  await tab.getByLabel("Search plans").fill("silk");
  await qa.quiet(1200);
  check("found by what went home", (await tab.locator("tbody tr").filter({ hasText: p.number }).count()) === 1, "");
  await tab.getByLabel("Search plans").fill("");
  const sum = (await qa.ask("/installment-plans/summary")).data;
  out("summary", sum);
  await qa.shot("list");

  qa.step("from the customer's card, by transfer");
  await page.goto(`/tenant/customers?show=installments`);
  await page.getByRole("row").filter({ hasText: WHO.name }).first().getByText(WHO.name).click();
  const card = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: WHO.name }) });
  await card.getByTestId("customer-plans").waitFor({ timeout: 15_000 });
  out("plans on the card", flat(await card.getByTestId("customer-plans").innerText()));
  const box = card.getByTestId("khata-box");
  await box.getByRole("spinbutton", { name: "Payment amount" }).fill("500");
  await box.getByLabel("Paid by").selectOption("bank_transfer");
  await box.getByRole("button", { name: "Take payment" }).click();
  const asked = box.getByTestId("khata-installment");
  await asked.waitFor({ timeout: 5_000 });
  out("asked", flat(await asked.innerText()));
  await qa.shot("asked-on-card");
  await asked.getByRole("button", { name: `Yes — on ${p.number}` }).click();
  await qa.quiet(1800);
  const p2 = (await qa.ask(`/installment-plans/${plan.id}`)).data;
  const entry = (p2.payments ?? []).at(-1);
  check("it went on the plan", (p2.payments ?? []).length === 2 && entry?.method === "bank_transfer" && n(entry.amount) === 500, p2.payments);
  check("left after both", n(p2.standing.left) === n(n(p.financed) - n(p.monthly) - 500), p2.standing.left);
  const owed2 = n((await qa.ask(`/customers/${p.customer_id}`)).data.credit_balance);
  check("the khata agrees with the plan", n(owed2 - owedBefore) === n(p2.standing.left), [owedBefore, owed2, p2.standing.left]);
  const afterCard = await money();
  check("a transfer is not cash in the drawer", afterCard.drawer === afterCash.drawer, [afterCash.drawer, afterCard.drawer]);
  check("the report counts both as collected, neither as sales", n(afterCard.collected - afterStart.collected) === n(n(p.monthly) + 500) && afterCard.revenue === afterStart.revenue, [afterStart, afterCard]);
  out("card after", flat(await card.getByTestId("customer-plans").innerText()));
  const statement = flat(await card.getByTestId("khata-statement").innerText());
  out("statement", statement.slice(0, 300));
  check("the statement names the plan on its lines", statement.includes(`Installment · Transfer · ${p.number}`) && statement.includes(`Installment charge · ${p.number}`) && statement.includes(`On installments · ${p.number}`), statement.slice(0, 200));
  await qa.shot("after-card");

  qa.step("day & banking");
  await page.goto("/tenant/day");
  await page.getByTestId("khata-collected").waitFor({ timeout: 15_000 }).catch(() => {});
  out("collected strip", flat(await page.getByTestId("khata-collected").innerText().catch(() => "(no strip)")).slice(0, 300));
  await qa.shot("day");

  console.log(`\n${failed === 0 ? "ALL CHECKS PASS" : `${failed} CHECK(S) FAILED`}`);
  console.log(qa.report());
} catch (e) {
  console.log("WALK STOPPED:", String(e).slice(0, 600));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
