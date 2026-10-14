// Phase 1 · purchasing, part 1: the manager carded a supplier and raises an
// order — what does the form offer for a design that comes in sizes?
import { open, textOf } from "./kit.mjs";

const SUPPLIER = { name: "Faisalabad Mills", contact: "Asif", phone: "03211234567" };
const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p1-po-raise" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
try {
  qa.step("supplier");
  await page.goto("/tenant/suppliers");
  await qa.quiet(1500);
  if (!(await page.getByRole("row").filter({ hasText: SUPPLIER.name }).count())) {
    await page.getByRole("button", { name: "+ New supplier" }).click();
    const form = page.getByRole("dialog", { name: "New supplier" });
    out("supplier form fields", (await form.getByRole("textbox").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.id))));
    await form.getByRole("textbox", { name: "Supplier / company name *" }).fill(SUPPLIER.name);
    await form.getByRole("textbox", { name: "Contact person" }).fill(SUPPLIER.contact);
    await form.getByRole("textbox", { name: "Phone" }).fill(SUPPLIER.phone);
    await form.getByRole("button", { name: "Save" }).click();
    await qa.quiet(1500);
  }
  out("supplier row", oneLine(await page.getByRole("row").filter({ hasText: SUPPLIER.name }).first().innerText()));

  qa.step("order");
  await page.goto("/tenant/purchases");
  await qa.quiet(1500);
  await page.getByRole("button", { name: "+ New purchase order" }).click();
  const form = page.getByRole("dialog", { name: "New purchase order" });
  await form.getByLabel("Supplier", { exact: true }).selectOption({ label: SUPPLIER.name });
  await form.getByPlaceholder("Search products to add…").fill("Waistcoat");
  await qa.quiet(1500);
  const offered = await form.locator("button").filter({ hasText: /Waistcoat/ }).allInnerTexts();
  out("the form offers, for a design in sizes", offered.map(oneLine));
  await qa.shot("offered");
  await form.locator("button").filter({ hasText: /Waistcoat/ }).first().click();
  await form.getByLabel("Quantity of Men's Waistcoat").fill("5");
  await form.getByLabel("Cost each for Men's Waistcoat").fill("2700");
  await form.getByPlaceholder("Search products to add…").fill("Chiffon Dupatta");
  await qa.quiet(1500);
  await form.locator("button").filter({ hasText: /Chiffon Dupatta/ }).first().click();
  await form.getByLabel("Quantity of Chiffon Dupatta").fill("10");
  await form.getByLabel("Cost each for Chiffon Dupatta").fill("600");
  out("order form", oneLine(await form.innerText()).slice(0, 500));
  await qa.shot("order-form");
  await form.getByRole("button", { name: "Place order" }).click();
  await qa.quiet(2000);
  const pos = (await qa.ask("/purchase-orders?per_page=5")).data ?? [];
  out("orders", pos.map((p) => ({ po: p.po_number, status: p.status, total: p.total })));
  const full = (await qa.ask(`/purchase-orders/${pos[0].id}`)).data;
  out("lines", (full.items ?? []).map((i) => `${i.product_name}${i.variant_name ? " / " + i.variant_name : ""} ×${i.quantity_ordered} @${i.unit_cost}`));
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 600));
} finally {
  console.log(qa.report());
  await qa.close();
}
