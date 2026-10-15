// A quotation's paper is the shop's own setting (default A4), not the till
// roll's; its page asks with that already picked. Sets 80mm, checks, puts A4 back.
import { open } from "./kit.mjs";

const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-paper", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
try {
  const s0 = (await qa.ask("/shop/settings")).data;
  out("settings before", { receipt_width: s0.receipt_width, document_paper: s0.document_paper });

  qa.step("settings");
  await page.goto("/tenant/settings");
  await page.getByRole("tab", { name: "Receipt" }).or(page.getByRole("button", { name: "Receipt", exact: true })).first().click();
  const field = page.locator("div").filter({ has: page.getByText("Quotations & advances print on", { exact: true }) }).locator("select").last();
  await field.waitFor({ timeout: 15_000 });
  out("field shows", await field.locator("option:checked").innerText());
  await field.selectOption("thermal_80");
  await page.getByRole("button", { name: "Save preferences" }).first().click();
  await qa.quiet(1200);
  out("saved", (await qa.ask("/shop/settings")).data.document_paper);
  await qa.shot("settings");

  qa.step("print from the page");
  const docs = (await qa.ask("/sale-documents?per_page=20")).data ?? [];
  const quote = docs.find((d) => d.number === "QUO-000001");
  await page.goto(`/tenant/documents/${quote.id}`);
  await page.getByRole("button", { name: "Print", exact: true }).click();
  const box = page.getByRole("dialog").filter({ hasText: "Print on" });
  await box.waitFor();
  out("picked", flat(await box.getByRole("radio", { checked: true }).innerText()));
  await qa.shot("print-box");
  await box.getByRole("radio", { name: /58mm roll/ }).click();
  out("note", flat(await box.locator("p").last().innerText()));
  const asked = page.waitForRequest((r) => r.url().includes(`/sale-documents/${quote.id}/print`), { timeout: 15_000 });
  await box.getByRole("button", { name: "Print", exact: true }).click();
  out("asked for", (await asked).url().split("/api/v1")[1]);
  await qa.quiet(1500);

  qa.step("put back");
  await qa.ask("/shop/settings", { method: "PUT", data: { document_paper: "standard" } });
  out("settings after", (await qa.ask("/shop/settings")).data.document_paper);
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
