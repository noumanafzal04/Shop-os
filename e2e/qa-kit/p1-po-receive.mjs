// Phase 1 · purchasing, part 2: the stock keeper receives the newest order with
// the details sheet — quantities given per line on the command line:
//   node p1-po-receive.mjs "Men's Waistcoat=5" "Chiffon Dupatta=10"
import { open, textOf } from "./kit.mjs";

const want = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")).map(([k, v]) => [k, v]));
const qa = await open("usman@zariclothing.test", { password: "Staff-pass-1", stage: "p1-po-receive" });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
const shelf = async () => {
  const rows = {};
  for (const p of (await qa.ask("/products?per_page=100")).data ?? []) {
    if (!Object.keys(want).some((w) => w.startsWith(p.name))) continue;
    rows[p.name] = { stock: p.stock_quantity, cost: p.cost, sizes: Object.fromEntries((p.variants ?? []).map((v) => [v.name, `${Number(v.stock_quantity)} @${v.cost ?? "—"}`])) };
  }
  return rows;
};
try {
  out("shelf before", await shelf());
  qa.step("receive");
  await page.goto("/tenant/purchases");
  await qa.quiet(1500);
  // PO=PO-000002 names the order; otherwise the newest one still open.
  await page.getByRole("row").filter({ hasText: process.env.PO ?? /ordered|partially/i }).first().click();
  const detail = page.getByRole("dialog").filter({ hasText: /Receive/ });
  await detail.waitFor({ timeout: 15_000 });
  out("order sheet", oneLine(await detail.innerText()).slice(0, 400));
  await detail.getByRole("button", { name: "Receive with details…" }).click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Receive → stock in" }).last();
  await sheet.waitFor({ timeout: 10_000 });
  for (const [line, qty] of Object.entries(want)) {
    const row = sheet.locator("div.rounded-lg").filter({ hasText: line }).first();
    await row.getByRole("spinbutton").fill(qty);
  }
  out("receive sheet", oneLine(await sheet.innerText()).slice(0, 400));
  await qa.shot("receive-sheet");
  await sheet.getByRole("button", { name: "Receive → stock in" }).click();
  await qa.quiet(2500);
  out("after", oneLine(await textOf(page, "body")).match(/(received|Received|Couldn't receive)[^.]{0,160}/)?.[0] ?? "(no message)");
  out("shelf after", await shelf());
  const pos = (await qa.ask("/purchase-orders?per_page=5")).data ?? [];
  out("orders", pos.map((p) => ({ po: p.po_number, status: p.status, total: p.total, received_total: p.received_total })));
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(oneLine(await textOf(page, "body")).slice(0, 600));
} finally {
  console.log(qa.report());
  await qa.close();
}
