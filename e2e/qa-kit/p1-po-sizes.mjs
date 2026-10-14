// Phase 1 · purchasing, part 3: the manager closes what is left of the first
// order, and orders SIZES — the form now offers them one by one.
import { open, textOf } from "./kit.mjs";

const LINES = [["Men's Waistcoat / M", 5, 2700], ["Men's Waistcoat / L", 5, 2700], ["Men's Cotton Kurta / Black / XL", 4, 1750]];
const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p1-po-sizes" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
try {
  qa.step("close the rest of PO-000001");
  await page.goto("/tenant/purchases");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: "PO-000001" }).first().click();
  const d1 = page.getByRole("dialog").filter({ hasText: "PO-000001" });
  await d1.waitFor({ timeout: 15_000 });
  out("PO-000001 buttons", (await d1.getByRole("button").allInnerTexts()).map(oneLine).filter(Boolean));
  const cancel = d1.getByRole("button", { name: /Cancel (the rest|order|remaining)|^Cancel$/ }).first();
  if (await cancel.count()) {
    page.once("dialog", (dlg) => dlg.accept());
    await cancel.click();
    await qa.quiet(800);
    const confirm = page.getByRole("dialog").filter({ hasText: /cancel/i }).getByRole("button", { name: /Cancel order|Yes|Confirm/ });
    if (await confirm.count()) await confirm.first().click();
    await qa.quiet(1500);
  }
  out("PO-000001 now", ((await qa.ask("/purchase-orders?per_page=5")).data ?? []).map((p) => `${p.po_number} ${p.status} recv ${p.received_total}`));
  await page.keyboard.press("Escape");

  qa.step("order sizes");
  await page.goto("/tenant/purchases");
  await qa.quiet(1500);
  await page.getByRole("button", { name: "+ New purchase order" }).click();
  const form = page.getByRole("dialog", { name: "New purchase order" });
  await form.getByLabel("Supplier", { exact: true }).selectOption({ label: "Faisalabad Mills" });
  for (const [label, qty, cost] of LINES) {
    const [design] = label.split(" / ");
    await form.getByPlaceholder("Search products to add…").fill(design);
    await qa.quiet(1200);
    if (label === LINES[0][0]) out("offered for the waistcoat", (await form.locator("button").filter({ hasText: design }).allInnerTexts()).map(oneLine));
    await form.locator("button").filter({ hasText: label }).first().click();
    await form.getByLabel(`Quantity of ${label}`).fill(String(qty));
    await form.getByLabel(`Cost each for ${label}`).fill(String(cost));
  }
  out("form", oneLine(await form.innerText()).slice(0, 400));
  await qa.shot("sized-order");
  await form.getByRole("button", { name: "Place order" }).click();
  await qa.quiet(2000);
  const po = ((await qa.ask("/purchase-orders?per_page=5")).data ?? [])[0];
  const full = (await qa.ask(`/purchase-orders/${po.id}`)).data;
  out("new order", { po: full.po_number, status: full.status, total: full.total, date: full.order_date, lines: (full.items ?? []).map((i) => `${i.product_name} / ${i.variant_name} ×${Number(i.quantity_ordered)} @${i.unit_cost}`) });
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 600));
} finally {
  console.log(qa.report());
  await qa.close();
}
