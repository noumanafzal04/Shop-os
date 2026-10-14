// Phase 1 · purchasing, part 4: the manager closes the rest of the first order
// and pays the supplier — some from her drawer in cash, the rest by transfer.
import { open, textOf } from "./kit.mjs";

const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p1-supplier-pay" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
const owed = async () => ((await qa.ask("/suppliers?search=Faisalabad")).data ?? []).map((s) => ({ balance: s.balance, owed: s.owed ?? s.payable }))[0];
const drawer = async () => { const d = (await qa.ask("/pos/session/report")).data?.drawer; return { cash_out: d?.cash_out, expected: d?.expected_cash }; };
try {
  qa.step("cancel the rest of PO-000001");
  await page.goto("/tenant/purchases");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: "PO-000001" }).first().click();
  const d1 = page.getByRole("dialog").filter({ hasText: "PO-000001" });
  await d1.waitFor({ timeout: 15_000 });
  await d1.getByRole("button", { name: "Cancel PO" }).click();
  const ask = page.getByRole("dialog").filter({ hasText: "Cancel this purchase order?" });
  out("confirm says", oneLine(await ask.innerText()));
  await ask.getByRole("button", { name: "Cancel PO" }).click();
  await qa.quiet(1500);
  out("orders", ((await qa.ask("/purchase-orders?per_page=5")).data ?? []).map((p) => `${p.po_number} ${p.status} total ${p.total} recv ${p.received_total} paid ${p.amount_paid}`));
  await page.keyboard.press("Escape");

  out("owed before", await owed());
  out("her drawer before", await drawer());
  for (const [amount, method] of [[1500, "cash"], [15000, "bank_transfer"]]) {
    qa.step(`pay ${amount} ${method}`);
    await page.goto("/tenant/suppliers");
    await qa.quiet(1500);
    await page.getByRole("row").filter({ hasText: "Faisalabad Mills" }).first().getByRole("button", { name: "Pay" }).click();
    const sheet = page.getByRole("dialog").filter({ hasText: "Record payment" });
    await sheet.waitFor({ timeout: 10_000 });
    out("pay sheet", oneLine(await sheet.innerText()).slice(0, 500));
    await sheet.locator("#pay-amount").fill(String(amount));
    await sheet.getByLabel("Payment method").selectOption(method);
    await qa.shot(`pay-${method}`);
    await sheet.getByRole("button", { name: "Record payment" }).click();
    await qa.quiet(2000);
    out(`after ${method}`, { owed: await owed(), drawer: await drawer() });
  }
  const cb = (await qa.ask("/cashbook")).data;
  out("cashbook today", (cb.days ?? []).find((d) => d.date === "2026-10-13"));
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 600));
} finally {
  console.log(qa.report());
  await qa.close();
}
