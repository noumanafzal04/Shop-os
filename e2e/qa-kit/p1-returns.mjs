// Phase 1 · returns: the manager hands money back for a whole line, and for a
// line that carried a discount. Each refund figure is read BEFORE the press.
import { open, textOf } from "./kit.mjs";

const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p1-returns" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();

async function openSale(invoice) {
  await page.goto("/tenant/sales");
  await qa.quiet(1500);
  await page.getByRole("row").filter({ hasText: invoice }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: invoice }) });
  await sheet.waitFor({ timeout: 15_000 });
  return sheet;
}

async function giveBack(invoice, label, qty) {
  qa.step(`return ${invoice}`);
  const sheet = await openSale(invoice);
  out(`${invoice} buttons`, (await sheet.getByRole("button").allInnerTexts()).map(oneLine).filter(Boolean));
  await sheet.getByRole("button", { name: "Return / Refund" }).click();
  await sheet.getByLabel(label).fill(String(qty));
  await qa.quiet(800);
  out(`${invoice} refund shown before the press`, oneLine(await sheet.getByTestId("refund-worth").innerText()));
  await qa.shot(`${invoice}-before`);
  await sheet.getByRole("button", { name: "Refund & restock" }).click();
  await qa.quiet(2000);
  out(`${invoice} after`, oneLine(await sheet.innerText()).slice(0, 400));
  await qa.shot(`${invoice}-after`);
  await page.keyboard.press("Escape");
}

try {
  await giveBack("INV-000010", "How many Lawn 3-Piece Unstitched (Teal) to return", 1);
  await giveBack("INV-000005", "How many Men's Cotton Kurta (White / S) to return", 1);
  qa.step("what the server kept");
  for (const inv of ["INV-000010", "INV-000005"]) {
    const s = ((await qa.ask(`/sales?search=${inv}`)).data ?? []).find((x) => x.invoice_number === inv);
    const full = (await qa.ask(`/sales/${s.id}`)).data;
    out(inv, { status: full.status, total: full.total, returns: (full.returns ?? []).map((r) => ({ refund: r.refund_total, method: r.refund_method ?? r.method, by: r.created_by?.name ?? r.user?.name })) });
  }
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 800));
} finally {
  console.log(qa.report());
  await qa.close();
}
