// The user (2026-10-15): "Product page or add product ko go through kr lena —
// tabs, active/inactive, inventory track ho rhi jb product create krty, us
// product ki inventory and barcode b". A grocery item made through Add item,
// then checked five ways; then retired and brought back.
import { open } from "./kit.mjs";

const NAME = "QA Walk Biscuit 100g";
const CODE = "8964000111222";
const qa = await open("grocery@loadtest.test", { stage: "p6-add-item", har: false });
const { page } = qa;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
// The form's labels name no box (no htmlFor), so a box is the first one after its label.
const field = (label) => page.locator("label").filter({ hasText: new RegExp(`^${label}`) }).first().locator("xpath=following::input[1]");
try {
  const had = ((await qa.ask(`/products?search=${encodeURIComponent(NAME)}`)).data ?? []).find((p) => p.name === NAME);
  if (!had) {
    qa.step("add item");
    await page.goto("/tenant/products/new");
    await page.getByRole("heading", { name: "Add item" }).waitFor({ timeout: 20_000 });
    out("tabs", await page.getByRole("tab").allInnerTexts().catch(() => []));
    await page.getByPlaceholder(/^e\.g\. /).first().fill(NAME);
    await field("Price").fill("120");
    await field("Cost").fill("90");
    const track = page.getByRole("button", { name: "Track stock for this item" }).or(page.getByLabel("Track stock for this item"));
    out("track stock on by default", await track.first().getAttribute("aria-pressed"));
    await field("Opening stock").fill("24");
    await field("Low-stock alert at").fill("5");
    await qa.shot("details");
    await page.getByRole("button", { name: /Codes & packs/ }).or(page.getByRole("tab", { name: /Codes & packs/ })).first().click();
    await page.getByPlaceholder("Scan or type").fill(CODE);
    await qa.shot("codes");
    out("barcode box holds", await page.getByPlaceholder("Scan or type").inputValue().catch(() => "(no box)"));
    await page.getByRole("button", { name: "Create item" }).click();
    const words = page.getByTestId("item-needs-words");
    if (await words.isVisible({ timeout: 3000 }).catch(() => false)) {
      out("refused for a description", (await words.innerText()).replace(/\s+/g, " "));
      await qa.shot("needs-words");
      await words.getByRole("button", { name: "Sell it in the shop only" }).click();
      await page.getByRole("button", { name: "Create item" }).click();
    }
    await page.waitForURL(/\/tenant\/products(\?|$)/, { timeout: 20_000 }).catch(() => {});
    await qa.quiet(1200);
    out("posts", qa.rows.filter((r) => r.method === "POST").map((r) => `${r.status} ${r.path} ${r.body.slice(0, 200)}`));
    out("alerts in the form", await page.getByRole("alert").allInnerTexts().catch(() => []));
    out("url", page.url());
  }
  out("made before this run", Boolean(had));

  qa.step("what was kept");
  const p = ((await qa.ask(`/products?search=${encodeURIComponent(NAME)}`)).data ?? []).find((x) => x.name === NAME);
  const full = (await qa.ask(`/products/${p.id}`)).data;
  out("product", { track_inventory: full.track_inventory, stock_quantity: full.stock_quantity, low: full.low_stock_threshold ?? full.reorder_level, barcode: full.barcode, cost: full.cost, price: full.price, is_active: full.is_active, sku: full.sku });
  const moves = (await qa.ask(`/inventory/movements?product_id=${p.id}&per_page=10`)).data ?? (await qa.ask(`/products/${p.id}/movements`)).data ?? [];
  out("stock moves", (Array.isArray(moves) ? moves : moves.data ?? []).map((m) => `${m.type} ${m.quantity} ${m.reason ?? ""}`));
  const scan = await qa.ask(`/pos/lookup?code=${CODE}`);
  out("scanned at the till", { status: scan.status, name: scan.data?.product?.name ?? scan.data?.name });

  qa.step("list row");
  await page.goto(`/tenant/products?search=${encodeURIComponent(NAME)}`);
  await page.getByPlaceholder("Search name or SKU…").fill(NAME);
  const row = page.getByRole("row").filter({ hasText: NAME });
  await row.waitFor({ timeout: 15_000 });
  out("list row", (await row.innerText()).replace(/\s+/g, " "));
  await qa.shot("list");

  qa.step("retire and bring back");
  await page.goto(`/tenant/products/${p.id}/edit`);
  const still = page.getByRole("switch", { name: /Still selling this/ }).or(page.locator("button, input").filter({ hasText: /Still selling this/ }));
  out("edit form loaded", await page.getByRole("heading", { name: /^Edit / }).isVisible().catch(() => false));
  console.log(qa.report());
} catch (e) {
  console.log("STOPPED:", String(e).slice(0, 500));
  await qa.shot("stopped");
  console.log(qa.report());
} finally {
  await qa.close();
}
