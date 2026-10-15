// Pass-4 fixes on the Zari clothing shop, pressed through the screen:
// B55 (plan price to staff), B56 (subscription typed in), B53 (pills that
// never fill), B52 (exchange asks with no items).
import { open, textOf } from "./kit.mjs";

const out = (k, v) => console.log(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const oneLine = (t) => t.replace(/\s+/g, " ").trim();

// ── B55: who is sent the plan's price ───────────────────────────────
for (const [who, password] of [["sana@zariclothing.test", "Zari-pass-1"], ["bilal@zariclothing.test", "Staff-pass-1"]]) {
  const qa = await open(who, { password, stage: `p5-b55-${who.split("@")[0]}`, har: false });
  const me = (await qa.ask("/auth/me")).data;
  const shop = (await qa.ask("/shop")).data;
  out(`B55 ${who}`, {
    me_plan_price: me?.tenant?.plan?.price ?? "(absent)", me_package: me?.tenant?.package ? "sent" : "(absent)",
    shop_plan_price: shop?.plan?.price ?? "(absent)", shop_package: shop?.package ? "sent" : "(absent)",
    banner_state: me?.tenant?.subscription_state,
  });
  await qa.close();
}

// ── B56: the subscription screen typed in by a cashier ──────────────
{
  const qa = await open("bilal@zariclothing.test", { password: "Staff-pass-1", stage: "p5-b56" });
  qa.step("bilal types /tenant/subscription");
  await qa.page.goto("/tenant/subscription");
  await qa.quiet(1500);
  out("B56 bilal lands on", new URL(qa.page.url()).pathname);
  out("B56 subscription asked", qa.rows.filter((r) => r.path.startsWith("/shop/subscription")).map((r) => r.status));
  console.log(qa.report());
  await qa.close();
}

// ── B53: the hero's pills for someone sent no takings ───────────────
for (const who of ["usman@zariclothing.test", "bilal@zariclothing.test"]) {
  const qa = await open(who, { password: "Staff-pass-1", stage: `p5-b53-${who.split("@")[0]}` });
  qa.step("dashboard");
  await qa.page.goto("/tenant");
  await qa.quiet(2500);
  const hero = qa.page.locator("main header").first();
  out(`B53 ${who} pulsing in hero after load`, await hero.locator(".animate-pulse").count());
  out(`B53 ${who} hero says`, oneLine(await hero.innerText()).slice(0, 220));
  await qa.shot("dashboard", { full: false });
  await qa.close();
}

// ── B52: an exchange asks only with a line in it ────────────────────
{
  const qa = await open("hina@zariclothing.test", { password: "Staff-pass-1", stage: "p5-b52" });
  const { page } = qa;
  try {
    qa.step("find a paid sale");
    const sales = (await qa.ask("/sales?per_page=30")).data ?? [];
    const sale = sales.find((s) => s.status === "completed" && Number(s.total) > 0) ?? sales[0];
    out("B52 sale", { invoice: sale?.invoice_number, status: sale?.status });
    await page.goto("/tenant/sales");
    await qa.quiet(1500);
    await page.getByRole("row").filter({ hasText: sale.invoice_number }).first().click();
    const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: sale.invoice_number }) });
    await sheet.waitFor({ timeout: 15_000 });
    qa.step("exchange: hand one back, pick a replacement");
    await sheet.getByRole("button", { name: /Exchange/ }).click();
    const first = (await qa.ask(`/sales/${sale.id}`)).data.items[0];
    await sheet.getByLabel(`How many ${first.product_name} to hand back`).fill("1");
    await qa.quiet(800);
    await sheet.getByPlaceholder("Search products…").fill("a");
    await qa.quiet(1500);
    await sheet.getByTestId("exchange-offers").getByRole("button").filter({ hasNot: qa.page.locator("[disabled]") }).first().click();
    await qa.quiet(2500);
    await qa.shot("exchange-sheet");
    const worth = qa.rows.filter((r) => r.path.startsWith("/sales/worth"));
    out("B52 /sales/worth asked", worth.map((r) => ({ status: r.status, empty: /"items":\[\]/.test(r.sent) })));
    await page.keyboard.press("Escape");
  } catch (e) {
    console.log("STOPPED:", String(e).slice(0, 400));
    await qa.shot("stopped");
  } finally {
    console.log(qa.report());
    await qa.close();
  }
}
