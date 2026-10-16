// L17: the On advance list says what is paid, what is left, when the customer
// last paid in, and which one is paid up and waiting to be handed over.
// Makes one advance paid in full (card), reads the list and its filters.
import { open } from "./kit.mjs";

const qa = await open("sana@zariclothing.test", { password: "Zari-pass-1", stage: "p6-advances", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const flat = (t) => t.replace(/\s+/g, " ").trim();
const rows = () => page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => `[${tr.dataset.state ?? "-"}] ${tr.innerText.replace(/\s+/g, " ").trim()}`));

try {
  let sum = (await qa.ask("/sale-documents/summary")).data;
  if (!(sum?.layaway_counts?.paid_up > 0)) {
    qa.step("an advance paid in full");
    const item = ((await qa.ask("/products?search=Dupatta&per_page=5")).data ?? [])[0];
    const made = await qa.ask("/sale-documents", { method: "POST", data: {
      kind: "layaway", customer_name: "QA Paid Up", customer_phone: "03009990002",
      items: [{ product_id: item.id, quantity: 1 }], deposit: { amount: Number(item.price), method: "card" },
    } });
    out("held", { status: made.status, number: made.data?.number, total: made.data?.total, paid: made.data?.deposit_paid, message: made.message });
    sum = (await qa.ask("/sale-documents/summary")).data;
  }
  out("summary (API)", sum?.layaway_counts);

  qa.step("the list");
  await page.goto("/tenant/documents");
  await page.getByRole("button", { name: "On advance", exact: true }).click();
  const chips = page.getByTestId("document-filters");
  await chips.getByRole("button", { name: /^Paid up — hand over/ }).waitFor({ timeout: 15_000 });
  await page.locator("tbody tr").first().waitFor({ timeout: 15_000 });
  await qa.quiet(800);
  out("chips", flat(await chips.innerText()));
  out("open rows", await rows());
  await qa.shot("open");

  qa.step("paid up — hand over");
  await chips.getByRole("button", { name: /^Paid up — hand over/ }).click();
  await qa.quiet(1200);
  out("paid-up rows", await rows());
  const go = page.locator("tbody").getByRole("link", { name: "Paid up — hand over" }).first();
  out("hand-over link", await go.getAttribute("href"));

  qa.step("the tiles open their lists");
  await page.getByRole("button", { name: /Open quotations/ }).click();
  await qa.quiet(1000);
  out("after Open quotations tile", { kindTab: flat(await page.locator("button.bg-brand-500").first().innerText()), pressed: flat(await chips.locator("[aria-pressed=true]").innerText()) });
  await page.getByRole("button", { name: /Still to collect/ }).click();
  await qa.quiet(1000);
  out("after Still to collect tile", { kindTab: flat(await page.locator("button.bg-brand-500").first().innerText()), pressed: flat(await chips.locator("[aria-pressed=true]").innerText()) });

  qa.step("hand it over");
  await chips.getByRole("button", { name: /^Paid up — hand over/ }).click();
  await qa.quiet(1000);
  await page.locator("tbody").getByRole("link", { name: "Paid up — hand over" }).first().click();
  await page.waitForURL(/\/tenant\/documents\/[0-9a-f-]+$/, { timeout: 10_000 });
  out("opened", flat(await page.locator("main").innerText()).slice(0, 160));

  console.log(qa.report());
} catch (e) {
  await qa.shot("failed");
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await qa.close?.();
}
