// Pass-4/5 fixes in the trades they were found in, pressed through the
// screen: B62 (an ingredient kept, not sold), B58 (the kitchen's status
// line), B60 (a packet's opening lot), B61 (a medicine received without its
// expiry), B54 (fuel on the reorder list). Run one with ONLY=b62 etc.
import { open } from "./kit.mjs";

const ONLY = process.env.ONLY;
const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();
const field = (page, label) => page.locator(`xpath=//label[starts-with(normalize-space(.), "${label}")]/following::input[1]`).first();
const run = async (key, fn) => {
  if (ONLY && ONLY !== key) return;
  console.log(`\n══ ${key}`);
  try { await fn(); } catch (e) { console.log(`STOPPED ${key}:`, String(e).slice(0, 500)); }
};

await run("b62", async () => {
  const qa = await open("restaurant@loadtest.test", { stage: "p5-b62" });
  const { page } = qa;
  try {
    qa.step("an ingredient, carded as for sale");
    const name = "QA Walk Flour kg";
    let flour = ((await qa.ask(`/products?search=${encodeURIComponent(name)}`)).data ?? []).find((p) => p.name === name);
    if (!flour) flour = (await qa.ask("/products", { method: "POST", data: { name, item_type: "physical_product", price: 0, cost: 120, track_inventory: true, stock_quantity: 10, for_sale: true } })).data;
    else await qa.ask(`/products/${flour.id}`, { method: "PUT", data: { for_sale: true } });
    out("made", { id: flour.id, for_sale: flour.for_sale });

    qa.step("switched to not sold on its form");
    await page.goto(`/tenant/products/${flour.id}/edit`);
    await qa.quiet(1500);
    const sw = page.getByRole("button", { name: /Sold to customers/ });
    out("switch before", await sw.getAttribute("aria-pressed"));
    await sw.click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await qa.quiet(2000);
    const after = (await qa.ask(`/products/${flour.id}`)).data;
    out("stored", { for_sale: after.for_sale, online: after.visible_in_marketplace });

    qa.step("the products list says so");
    await page.goto(`/tenant/products?search=${encodeURIComponent(name)}`);
    await qa.quiet(1500);
    out("list row", oneLine(await page.getByRole("row").filter({ hasText: name }).first().innerText()).slice(0, 160));

    qa.step("take order searches for it");
    await page.goto("/tenant/orders/new");
    await qa.quiet(1500);
    await page.getByPlaceholder("Search products…").fill("QA Walk Flour");
    await qa.quiet(1500);
    out("take order offers it", await page.getByText(name, { exact: true }).count());
    const asked = qa.rows.filter((r) => r.phase === "take order searches for it" && r.path.startsWith("/products?"));
    out("take order asked", asked.map((r) => r.path.slice(0, 120)));

    qa.step("the till's own sync");
    const items = (await qa.ask("/pos/catalog")).data?.products?.items ?? [];
    const row = items.find((i) => i.id === flour.id);
    out("till catalog row", row ? (row.deleted ? "tombstone" : "OFFERED") : "(not on this page of the sync)");

    qa.step("a sale naming it");
    const sale = await qa.ask("/sales", { method: "POST", data: { channel: "pos", items: [{ product_id: flour.id, quantity: 1 }], payment_method: "cash", amount_paid: 0 } });
    out("sale refused", { status: sale.status, code: sale.meta?.error_code, message: sale.message });
  } finally {
    console.log(qa.report());
    await qa.close();
  }
});

await run("b58", async () => {
  const owner = await open("restaurant@loadtest.test", { stage: "p5-b58-owner", har: false });
  const staff = (await owner.ask("/staff?per_page=100")).data ?? [];
  await owner.close();
  out("staff", staff.map((s) => `${s.email} [${(s.permissions ?? []).join(",")}]`).slice(0, 12));
  // Nobody here holds kitchen.manage alone; the stock keeper cannot accept an
  // order either, which is the rule being checked.
  const cook = staff.find((s) => (s.permissions ?? []).includes("kitchen.manage") && !(s.permissions ?? []).includes("orders.manage") && !(s.permissions ?? []).includes("sales.manage"))
    ?? staff.find((s) => /stock_keeper/.test(s.email));
  out("kitchen person", cook ? { email: cook.email, permissions: cook.permissions } : "(none)");
  if (!cook) return;
  const qa = await open(cook.email, { stage: "p5-b58" });
  try {
    await qa.page.goto("/tenant");
    await qa.quiet(2500);
    const dash = (await qa.ask("/dashboard")).data;
    out("pending orders the server counts", dash?.pending_orders);
    out("hero says", oneLine(await qa.page.locator("main header").first().innerText()).slice(0, 220));
    await qa.shot("dashboard", { full: false });
  } finally {
    console.log(qa.report());
    await qa.close();
  }
});

await run("b60", async () => {
  const qa = await open("grocery@loadtest.test", { stage: "p5-b60" });
  const { page } = qa;
  try {
    qa.step("a yogurt carded with its lot");
    await page.goto("/tenant/products/new");
    await qa.quiet(1500);
    await page.getByRole("button", { name: /Product/ }).first().click().catch(() => {});
    const name = "QA Walk Yogurt 500g";
    await field(page, "Name").fill(name);
    await field(page, "Price").fill("180");
    await qa.quiet(500);
    await field(page, "Opening stock").fill("24");
    await field(page, "Opening batch number").fill("YG-WALK");
    await field(page, "Opening batch expiry").fill("2026-10-25").catch(async () => {
      await field(page, "Opening batch expiry").click();
      await page.keyboard.type("25 Oct 2026");
    });
    await page.locator("textarea").first().fill("Plain yogurt, 500 g tub.");
    await qa.shot("form-filled");
    await page.getByRole("button", { name: "Create item" }).click();
    await qa.quiet(2500);
    const made = ((await qa.ask(`/products?search=${encodeURIComponent(name)}`)).data ?? []).find((p) => p.name === name);
    out("made", made ? { id: made.id, stock: made.stock_quantity } : "(not made)");
    if (made) {
      const lots = (await qa.ask(`/inventory/products/${made.id}/batches`)).data ?? [];
      out("lots", lots.map((l) => ({ number: l.batch_number, expiry: l.expiry_date, qty: l.quantity })));
    }
  } finally {
    console.log(qa.report());
    await qa.close();
  }
});

await run("b61", async () => {
  const qa = await open("pharmacy@loadtest.test", { stage: "p5-b61" });
  const { page } = qa;
  try {
    const pos = (await qa.ask("/purchase-orders?per_page=50")).data ?? [];
    let target = null;
    for (const po of pos.filter((p) => ["ordered", "partially_received"].includes(p.status))) {
      const full = (await qa.ask(`/purchase-orders/${po.id}`)).data;
      if ((full.items ?? []).some((i) => i.product?.item_type === "medicine" && Number(i.quantity_ordered) > Number(i.quantity_received))) { target = full; break; }
    }
    out("open medicine order", target ? { po: target.po_number, lines: target.items.length } : "(none)");
    if (!target) return;
    await page.goto("/tenant/purchases");
    await qa.quiet(1500);
    await page.getByRole("row").filter({ hasText: target.po_number }).first().click();
    await qa.quiet(1500);
    await page.getByRole("button", { name: /Receive with details/ }).click();
    await qa.quiet(800);
    const dialog = page.getByRole("dialog").last();
    const receive = dialog.getByRole("button", { name: /Receive/ }).last();
    out("receive pressable with every expiry empty", await receive.isEnabled());
    out("lines saying the expiry is needed", await dialog.getByText("Needed before this delivery can be received.").count());
    const dates = dialog.locator("input[type=date], input[placeholder*='2026'], input[inputmode]");
    out("date boxes", await dates.count());
    await qa.shot("receive-empty");
    await page.keyboard.press("Escape");
  } finally {
    console.log(qa.report());
    await qa.close();
  }
});

await run("b54", async () => {
  const qa = await open("petrol@loadtest.test", { stage: "p5-b54" });
  const { page } = qa;
  const put = [];
  try {
    const tanks = (await qa.ask("/fuel/tanks")).data ?? (await qa.ask("/fuel/setup")).data?.tanks ?? [];
    const fuelId = tanks[0]?.product_id;
    const fuel = fuelId ? (await qa.ask(`/products/${fuelId}`)).data : null;
    const others = ((await qa.ask("/products?per_page=50&type=product")).data ?? []).filter((p) => p.track_inventory && !tanks.some((t) => t.product_id === p.id));
    const lube = others[0];
    out("fuel / lube", { fuel: fuel?.name, stock: fuel?.stock_quantity, lube: lube?.name, lubeStock: lube?.stock_quantity });
    if (!fuel || !lube) return;
    for (const p of [fuel, lube]) {
      put.push({ id: p.id, was: p.low_stock_threshold });
      await qa.ask(`/products/${p.id}`, { method: "PUT", data: { low_stock_threshold: Math.ceil(Number(p.stock_quantity)) + 5 } });
    }
    await page.goto("/tenant/inventory?filter=low");
    await qa.quiet(2500);
    out("fuel row", oneLine(await page.getByRole("row").filter({ hasText: fuel.name }).first().innerText()).slice(0, 200));
    const btn = page.getByRole("button", { name: /^Order these/ });
    out("button", (await btn.count()) ? await btn.innerText() : "(none)");
    const low = (await qa.ask("/inventory/low-stock")).data ?? [];
    out("list", { rows: low.length, fuel_rows: low.filter((r) => r.by_tanker).map((r) => r.name) });
    await qa.shot("reorder");
  } finally {
    for (const p of put) await qa.ask(`/products/${p.id}`, { method: "PUT", data: { low_stock_threshold: p.was } });
    out("alert levels put back", put.length);
    console.log(qa.report());
    await qa.close();
  }
});
