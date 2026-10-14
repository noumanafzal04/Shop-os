// Phase 1 · exchanges as the manager: a dearer size with no shift of her own
// (she is warned first), then — her own shift open — a cheaper item, the
// difference handed back out of HER drawer.
import { open, textOf } from "./kit.mjs";

const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p1-exchange" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();

async function exchange(invoice, backLabel, search, pick) {
  qa.step(`exchange ${invoice}`);
  await page.goto("/tenant/sales");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await sheet.waitFor({ timeout: 15_000 });
  await sheet.getByRole("button", { name: "Exchange" }).click();
  await sheet.getByLabel(backLabel).fill("1");
  await sheet.getByPlaceholder("Search products…").fill(search);
  await qa.quiet(1500);
  await sheet.getByRole("button", { name: pick }).first().click();
  await qa.quiet(1500);
  out(`${invoice} sums`, oneLine(await sheet.getByTestId("exchange-sums").innerText()));
  out(`${invoice} warned first`, (await sheet.getByTestId("exchange-no-drawer").count()) ? oneLine(await sheet.getByTestId("exchange-no-drawer").innerText()) : "no");
  await qa.shot(`${invoice}-before`);
  await sheet.getByRole("button", { name: "Complete exchange" }).click();
  await qa.quiet(2500);
  out(`${invoice} failed?`, (await sheet.getByText(/Exchange failed/).count()) ? oneLine(await sheet.innerText()).slice(0, 300) : "no");
  await qa.shot(`${invoice}-after`);
  await page.keyboard.press("Escape");
}

// `node p1-exchange.mjs down` walks only the cheaper swap (her shift already open).
const onlyDown = process.argv[2] === "down";
try {
  if (!onlyDown) await exchange("INV-000008", "How many Men's Cotton Kurta (White / L) to hand back", "Cotton Kurta", /White \/ XL/);

  if (!onlyDown) { qa.step("open her own shift");
  await page.goto("/tenant/pos");
  await qa.quiet(2000);
  await page.getByRole("button", { name: "Open shift" }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Open shift" }) });
  await sheet.getByRole("spinbutton").first().fill("3000");
  await sheet.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByText(/Shift open/).first().waitFor({ timeout: 15_000 });
  out("shift", "open, float 3,000"); }

  await exchange("INV-000001", "How many Men's Cotton Kurta (White / M) to hand back", "Kids Shalwar", /4-5Y/);

  qa.step("what the server kept");
  const mine = (await qa.ask("/pos/session/report")).data?.drawer;
  out("Hina's drawer", { cash_refunds: mine?.cash_refunds, cash_sales: mine?.cash_sales, expected_cash: mine?.expected_cash, sales_count: mine?.sales_count });
  for (const inv of ["INV-000008", "INV-000001"]) {
    const s = ((await qa.ask(`/sales?search=${inv}`)).data ?? []).find((x) => x.invoice_number === inv);
    const full = (await qa.ask(`/sales/${s.id}`)).data;
    out(inv, { status: full.status, returns: (full.returns ?? []).map((r) => ({ no: r.return_number, refund: r.refund_total, method: r.refund_method, drawer: r.cash_session_id ? "yes" : "none" })) });
  }
  const latest = ((await qa.ask("/sales?per_page=3")).data ?? []).map((x) => `${x.invoice_number} ${x.total} paid ${x.amount_paid} ${x.payment_method} drawer:${x.cash_session_id ? "yes" : "none"}`);
  out("newest sales", latest);
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 800));
} finally {
  console.log(qa.report());
  await qa.close();
}
