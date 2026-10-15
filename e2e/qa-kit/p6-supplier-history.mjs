// A part payment's history — when, how much, how — on the supplier and on the
// order (the user, 2026-10-15). Pays Faisalabad Mills 2,000 by bank on account.
import { open } from "./kit.mjs";

const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-supplier", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const REF = "QA-HIST-1";
try {
  qa.step("history before");
  await page.goto("/tenant/suppliers");
  const row = page.getByRole("row").filter({ hasText: "Faisalabad Mills" });
  await row.getByRole("button", { name: "History" }).click();
  const box = page.getByTestId("supplier-history");
  await box.waitFor({ timeout: 15_000 });
  out("before", flat(await box.innerText()).slice(0, 700));
  await qa.shot("history-before");
  await page.keyboard.press("Escape");

  qa.step("pay on account");
  const already = ((await qa.ask("/suppliers/" + (await qa.ask("/suppliers?per_page=5")).data.find((s) => s.name === "Faisalabad Mills").id)).data.payments ?? []).some((p) => p.reference === REF);
  if (!already) {
    await row.getByRole("button", { name: "Pay" }).click();
    const pay = page.getByRole("dialog").filter({ hasText: "Pay Faisalabad Mills" });
    await pay.locator("#pay-amount").fill("2000");
    await pay.getByLabel("Payment method").selectOption("bank_transfer");
    await pay.locator("#pay-ref").fill(REF);
    await pay.getByRole("button", { name: "Record payment" }).click();
    await pay.waitFor({ state: "hidden", timeout: 15_000 });
  }
  out("paid already before this run", already);

  qa.step("history after");
  await row.getByRole("button", { name: "History" }).click();
  await box.waitFor({ timeout: 15_000 });
  await qa.quiet(800);
  out("after", flat(await box.innerText()).slice(0, 900));
  await qa.shot("history-after");
  await page.keyboard.press("Escape");

  qa.step("the orders");
  await page.goto("/tenant/purchases");
  for (const po of ["PO-000001", "PO-000002"]) {
    await page.getByRole("row").filter({ hasText: po }).first().click();
    const panel = page.getByTestId("order-payments");
    await panel.waitFor({ timeout: 15_000 });
    out(po, flat(await panel.innerText()));
    await qa.shot(`order-${po}`);
    await page.keyboard.press("Escape");
    await qa.quiet(500);
  }
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
