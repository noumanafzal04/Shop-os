// B01 (owner, 2026-10-14): the cashier starts a refund at their own till, a
// supervisor approves it with their PIN on the cashier's screen, and the cash
// comes out of the cashier's own drawer. Pressed through the screen.
import { open, textOf } from "./kit.mjs";

const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();

// The supervisor's PIN, set the way a supervisor sets it (password as proof).
const hina = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p2-approval-hina", har: false });
const pinSet = await hina.ask("/auth/till-pin", { method: "PUT", data: { current_password: "Staff-pass-1", pin: "2580" } });
out("hina sets her till PIN", pinSet.success ?? pinSet);
const hinaId = (await hina.ask("/auth/me")).data?.id;
await hina.close();

const qa = await open("bilal@zariclothing.test", { password: "Staff-pass-1", stage: "p2-approval" });
const { page } = qa;
try {
  qa.step("bilal rings a dupatta for cash");
  out("hina is the approver id", hinaId);
  const dupatta = ((await qa.ask("/products?search=Dupatta")).data ?? [])[0];
  const before = (await qa.ask("/pos/session/report")).data?.drawer?.expected_cash;
  const sold = await qa.ask("/sales", { method: "POST", data: {
    channel: "pos", items: [{ product_id: dupatta.id, quantity: 1 }], payment_method: "cash", amount_paid: Number(dupatta.selling_price ?? dupatta.price),
  } });
  const sale = sold.data;
  out("sold", { invoice: sale?.invoice_number, total: sale?.total, drawer_before: before, err: sold.message });
  const afterSale = (await qa.ask("/pos/session/report")).data?.drawer?.expected_cash;

  qa.step("bilal opens it and starts the return");
  await page.goto("/tenant/sales");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: sale.invoice_number }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: sale.invoice_number }) });
  await sheet.waitFor({ timeout: 15_000 });
  out("buttons a cashier is offered", (await sheet.getByRole("button").allInnerTexts()).map(oneLine).filter(Boolean));
  await sheet.getByRole("button", { name: "Return / Refund" }).click();
  await sheet.getByLabel(`How many ${dupatta.name} to return`).fill("1");
  await qa.quiet(1000);
  const refund = sheet.getByRole("button", { name: "Refund & restock" });
  out("approval block shown", await sheet.getByTestId("refund-approval").isVisible());
  out("refund pressable before the PIN", await refund.isEnabled());

  qa.step("hina says yes with her PIN on bilal's screen");
  await sheet.getByLabel("Approved by").selectOption({ label: "Hina" }).catch(async () => {
    const opts = await sheet.getByLabel("Approved by").locator("option").allInnerTexts();
    out("approver options", opts);
    await sheet.getByLabel("Approved by").selectOption({ index: opts.findIndex((o) => /hina/i.test(o)) });
  });
  await sheet.getByLabel("Supervisor's PIN").fill("2580");
  out("refund pressable after the PIN", await refund.isEnabled());
  await qa.shot("approval-filled");
  await refund.click();
  await qa.quiet(2500);
  await qa.shot("after-refund");

  qa.step("what the server kept");
  const full = (await qa.ask(`/sales/${sale.id}`)).data;
  const ret = (full.returns ?? [])[0];
  const after = (await qa.ask("/pos/session/report")).data?.drawer?.expected_cash;
  out("result", {
    status: full.status, refund: ret?.refund_total, approved_by_is_hina: ret?.approved_by === hinaId, approved_by: ret?.approved_by,
    drawer: { before_sale: before, after_sale: afterSale, after_refund: after },
  });
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 900));
} finally {
  console.log(qa.report());
  await qa.close();
}
