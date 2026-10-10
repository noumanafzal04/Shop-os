import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * A PLAN SAYS WHAT IT INCLUDES; AN ADD-ON IS ON THE SHOP, AND ON ITS BILL.
 *
 * Three questions the owner asked, walked through the screens:
 *
 *   "Plan k andr modules set kr skty?"            a plan's list is ticked on
 *                                                 the plan, and a new shop of
 *                                                 a trade starts with it
 *   "jis business type ki wohi module show hon"   a mart is not asked about a
 *                                                 kitchen
 *   "add-on ly lia, kaise pta chaly ga is sy      it is on the shop's page as
 *    extra charges lene?"                         a line of its bill, and the
 *                                                 shop is still on Basic
 *
 * One fixture shop, made once and reset each run; the add-on price and the
 * plan's list are put back as they were found.
 */

const SHOP = { name: "E2E Plan Packages Mart", owner: "e2e-plan-packages@qa.test" };

type Plan = { id: string; code: string; name: string; modules: string[]; modules_own: boolean; is_custom?: boolean };
type Tenant = { id: string; business_name: string; plan?: { code: string } | null; package?: { addons: string[]; bill: { total: number } } };

const admin = () => tradeAuth("admin");

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: admin() });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

async function put(request: APIRequestContext, path: string, data: unknown): Promise<void> {
  const res = await request.put(`${API}${path}`, { headers: admin(), data });
  expect(res.ok(), `PUT ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
}

const BASIC_FOR_A_MART = { products: true, pos: true, inventory: true, labels: true };

/** The fixture shop, on Basic with exactly what Basic gives a mart. */
async function theShop(request: APIRequestContext, basic: Plan): Promise<string> {
  const found = (await get<Tenant[]>(request, `/admin/tenants?search=${encodeURIComponent(SHOP.name)}`)).find((t) => t.business_name === SHOP.name);
  let id = found?.id;

  if (!id) {
    const made = await request.post(`${API}/admin/tenants`, {
      headers: admin(),
      data: {
        business_name: SHOP.name,
        business_type: "mart",
        plan_id: basic.id,
        modules: BASIC_FOR_A_MART,
        owner: { name: "E2E Plan Packages", email: SHOP.owner, password: "password123" },
      },
    });
    expect(made.ok(), `the fixture shop could not be made (${made.status()} ${await made.text()})`).toBeTruthy();
    id = ((await made.json()) as { data: { id: string } }).data.id;
  }

  // As a run finds it: Basic's own set, nothing added, no price of its own.
  const everything = await get<Array<{ key: string }>>(request, "/admin/modules");
  await put(request, `/admin/tenants/${id}/modules`, {
    modules: Object.fromEntries(everything.map((m) => [m.key, m.key in BASIC_FOR_A_MART])),
    addon_prices: {},
  });

  return id;
}

// One signed-in admin, 240 requests a minute: wait for the minute to turn
// rather than be refused half-way through a test. See roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("a plan's modules are ticked on the plan, a mart is offered only a mart's, and an add-on is on the shop's bill", async ({ page, request }) => {
  const plans = await get<Plan[]>(request, "/admin/plans");
  const basic = plans.find((p) => p.code === "basic")!;
  expect(basic, "there is no Basic plan to test with").toBeTruthy();
  const pricesBefore = await get<Record<string, number>>(request, "/admin/modules/prices");

  // The ground this run stands on. The price list is somebody's real list:
  // this prices ONE module on it and hands that one back — it used to save
  // the whole list as it found it, which undid anything priced meanwhile.
  await put(request, `/admin/plans/${basic.id}`, { modules: null });
  const shop = await theShop(request, basic);

  try {
    await put(request, "/admin/modules/prices", { changes: { customers: 500 } });

    // ── the plan says what it includes ────────────────────────────────
    await page.goto("/admin/plans");
    const card = page.locator('[data-plan="basic"]');
    await expect(card.getByTestId("plan-modules")).toContainText("the usual set", { timeout: 20_000 });
    for (const included of ["Products", "Point of Sale (POS)", "Barcode Labels"]) {
      await expect(card.getByTestId("plan-modules")).toContainText(included);
    }
    await expect(card.getByTestId("plan-modules")).not.toContainText("Customers & Khata");

    await card.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Edit Basic" }) });
    await dialog.getByRole("tab", { name: /Modules/ }).click();
    const editor = dialog.getByTestId("plan-modules-editor");
    // Checkboxes, and the four Basic has are the four that are ticked.
    await expect(editor.getByRole("checkbox", { name: /^Products/ })).toBeChecked();
    await expect(editor.getByRole("checkbox", { name: /^Barcode Labels/ })).toBeChecked();
    await expect(editor.getByRole("checkbox", { name: /^Customers & Khata/ })).not.toBeChecked();
    await expect(editor.getByRole("checkbox", { name: /^Kitchen Tickets/ })).not.toBeChecked();
    // A tick brings what it needs: Suppliers & Purchases cannot be in a plan without Inventory.
    await editor.getByRole("checkbox", { name: /^Suppliers & Purchases/ }).check();
    await expect(editor.getByRole("checkbox", { name: /^Inventory/ }), "a plan can include Purchases without the Inventory it needs").toBeChecked();
    await expect(editor.getByRole("status")).toContainText("Also ticked: Inventory");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await expect(card.getByTestId("plan-modules"), "the plan card does not show what was just ticked").toContainText("Suppliers & Purchases", { timeout: 15_000 });
    await expect(card.getByTestId("plan-modules")).not.toContainText("the usual set");
    const saved = (await get<Plan[]>(request, "/admin/plans")).find((p) => p.code === "basic")!;
    expect(saved.modules_own).toBe(true);
    expect(saved.modules).toEqual(expect.arrayContaining(["purchasing", "inventory", "labels"]));

    // The shop that was already on Basic did not move: what changed is the label.
    const after = await get<Tenant & { features: Record<string, boolean> }>(request, `/admin/tenants/${shop}`);
    expect(after.features.purchasing, "re-thinking a plan switched a module on for a shop that never asked").toBeFalsy();

    // …and back to its rung, which is how a run leaves it.
    await put(request, `/admin/plans/${basic.id}`, { modules: null });

    // ── the add-on's price is set on this same page ───────────────────
    await page.reload();
    const prices = page.getByTestId("addon-prices");
    await expect(prices.getByLabel("Customers & Khata: price a month")).toHaveValue("500", { timeout: 20_000 });

    // ── a mart is offered a mart's modules ────────────────────────────
    await page.goto("/admin/tenants/new");
    await page.getByLabel("Business type *", { exact: true }).selectOption("mart");
    await page.getByLabel("Plan *", { exact: true }).selectOption(basic.id);

    const included = page.getByTestId("modules-included");
    await expect(included).toContainText("In Basic", { timeout: 20_000 });
    await expect(included.getByRole("switch")).toHaveCount(4);
    for (const on of ["Products", "Point of Sale (POS)", "Inventory", "Barcode Labels"]) {
      await expect(included.getByRole("switch", { name: on, exact: true }), `${on} is not switched on with Basic`).toBeChecked();
    }
    // Nobody setting up a grocer is asked about a kitchen or a fuel tank.
    await expect(page.getByRole("switch", { name: "Kitchen Tickets (KOT)", exact: true }), "a mart is offered a kitchen pass").toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Fuel Management", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("modules-other")).toContainText("Not usual for a mart");

    // An add-on says what it costs, and the amount to take says what it comes to.
    const addons = page.getByTestId("modules-addons");
    await expect(addons.locator('[data-module="customers"]')).toContainText("Rs 500 / mo");
    await addons.getByRole("switch", { name: "Customers & Khata", exact: true }).click();
    await expect(page.getByTestId("modules-addons-total")).toContainText("1 add-on · Rs 500 a month on top of the plan");
    await expect(page.getByTestId("create-due"), "the opening payment does not include the add-on").toContainText("= Rs 2,999");

    // ── and on a shop that already exists, it is a line of its bill ───
    await page.goto(`/admin/tenants/${shop}`);
    const bill = page.getByTestId("shop-bill");
    await expect(bill).toContainText("Basic", { timeout: 20_000 });
    await expect(bill).toContainText("Rs 2,499");
    await expect(bill).not.toContainText("Add-on");

    await page.getByTestId("modules-addons").getByRole("switch", { name: "Customers & Khata", exact: true }).click();
    await page.getByRole("button", { name: "Save modules" }).click();

    await expect(bill, "the add-on is not on the shop's bill").toContainText("Customers & Khata", { timeout: 15_000 });
    await expect(bill).toContainText("Add-on");
    await expect(bill).toContainText("Rs 2,999");
    // Still on Basic. No plan was made for it, by anybody or by anything.
    const now = await get<Tenant>(request, `/admin/tenants/${shop}`);
    expect(now.plan?.code).toBe("basic");
    expect(now.package?.addons).toEqual(["customers"]);
    expect((await get<Plan[]>(request, "/admin/plans")).length, "a plan appeared from somewhere").toBe(plans.length);

    // This one shop is given its own price for it.
    await page.getByLabel("Customers & Khata: this shop's own price a month").fill("300");
    await page.getByRole("button", { name: "Save modules" }).click();
    await expect(bill).toContainText("Rs 2,799", { timeout: 15_000 });
    await expect(bill).toContainText("usually Rs 500");

    // Switched off, and it is off the bill.
    await page.getByTestId("modules-addons").getByRole("switch", { name: "Customers & Khata", exact: true }).click();
    await page.getByRole("button", { name: "Save modules" }).click();
    await expect(bill).not.toContainText("Customers & Khata", { timeout: 15_000 });
    await expect(bill).toContainText("Rs 2,499");
  } finally {
    await put(request, `/admin/plans/${basic.id}`, { modules: null });
    await put(request, "/admin/modules/prices", { changes: { customers: pricesBefore.customers ?? null } });
  }
});

type Reach = Record<string, { plans: string[]; shops: number; named: string[] }>;

/** Which of its three answers a module's figures call for. */
const answerFor = (r: Reach[string]) => (r.plans.length > 0 ? "somewhere" : r.shops === 0 ? "never" : "anyway");

test("the add-on price list says where each price can ever be charged — and that a plan's price is not added up from them", async ({ page, request }) => {
  // Asked in so many words: "do I set the add-on prices first? Is the plan's
  // price worked out from them? I put Rs 25,000 on Products and nothing
  // changed." The screen had no way of answering — and the first answer it
  // was given was wrong on the very database it was asked about: "in every
  // plan, so charged to nobody", while a business that only keeps books had
  // been given Products and was being billed the 25,000.
  const basic = (await get<Plan[]>(request, "/admin/plans")).find((p) => p.code === "basic")!;
  const shop = await theShop(request, basic);
  const everything = await get<Array<{ key: string }>>(request, "/admin/modules");
  const asBasic = Object.fromEntries(everything.map((m) => [m.key, m.key in BASIC_FOR_A_MART]));
  const pricesBefore = await get<Record<string, number>>(request, "/admin/modules/prices");
  const owed = async () => (await get<Tenant>(request, `/admin/tenants/${shop}`)).package!.bill.total;

  try {
    let reach = await get<Reach>(request, "/admin/modules/reach");

    await page.goto("/admin/plans");
    const prices = page.getByTestId("addon-prices");
    await expect(prices).toBeVisible({ timeout: 20_000 });
    await expect(prices).toContainText("never added up from these");

    // Every module has its line — none is left as a bare box — and each line
    // is the one the server's own figures call for.
    await expect(prices.locator("[data-reach]").first()).toBeVisible({ timeout: 15_000 });
    await expect(prices.locator("[data-reach]")).toHaveCount(await prices.locator("[data-testid^='addon-price-']").count());
    for (const [key, r] of Object.entries(reach)) {
      const line = prices.getByTestId(`addon-price-${key}`);
      await expect(line.locator("[data-reach]"), `${key}: ${r.plans.length} plans leave it out and ${r.shops} shops have it past theirs`)
        .toHaveAttribute("data-reach", answerFor(r));
      // Nobody is charged only when nobody is.
      if (r.shops > 0) await expect(line, `${key} is past ${r.shops} shops' plans and is called charged to nobody`).not.toContainText("charged to nobody");
      else if (r.plans.length === 0) await expect(line).toContainText("a price here is charged to nobody");
    }

    // Past a plan: which plans, and how many shops have it today.
    const [past, somewhere] = Object.entries(reach).find(([, r]) => r.plans.length > 0)!;
    const pastLine = prices.getByTestId(`addon-price-${past}`);
    await expect(pastLine).toContainText(`An add-on on ${somewhere.plans[0]}`);
    await expect(pastLine).toContainText(
      somewhere.shops === 0 ? "no shop has taken it yet" : `${somewhere.shops.toLocaleString("en-US")} ${somewhere.shops === 1 ? "shop has" : "shops have"} it as an add-on now`,
    );

    // ── in every plan on offer, and on a bill all the same ────────────
    // A pump is in every plan for a filling station and usual for nobody
    // else, so no plan on offer leaves it out. Give one to a mart: it is
    // past that mart's plan, and whatever is typed beside it is on its bill.
    const outside = ["fuel", "kitchen"].find((k) => reach[k]?.plans.length === 0);
    expect(outside, "neither a pump nor a kitchen is in every plan any more — this case needs another module").toBeTruthy();
    const key = outside!;
    const before = reach[key].shops;

    await put(request, `/admin/tenants/${shop}/modules`, { modules: { ...asBasic, [key]: true }, addon_prices: {} });
    reach = await get<Reach>(request, "/admin/modules/reach");
    expect(reach[key].plans, "giving one shop a module changed what the plans include").toEqual([]);
    expect(reach[key].shops, "a shop given a module outside its trade is not counted as having it past its plan").toBe(before + 1);

    await page.reload();
    const line = prices.getByTestId(`addon-price-${key}`);
    await expect(line.locator("[data-reach]")).toHaveAttribute("data-reach", "anyway", { timeout: 20_000 });
    await expect(line).toContainText("In every plan on offer, yet");
    // Named while all of them can be; counted once they cannot.
    const all = reach[key].named.length === reach[key].shops;
    expect(all ? reach[key].named : [SHOP.name], "the shop is not among those the server names").toContain(SHOP.name);
    await expect(line).toContainText(all ? SHOP.name : `${reach[key].shops.toLocaleString("en-US")} shops have it as an add-on`);
    await expect(line).toContainText(/A price here goes on (its bill|their bills)/);
    await expect(line, "a price that is on a bill was called charged to nobody").not.toContainText("charged to nobody");

    // "Goes on its bill" is not a figure of speech: price it, and the mart owes exactly that much more.
    const owedBefore = await owed();
    await put(request, "/admin/modules/prices", { changes: { [key]: 700 } });
    expect(await owed(), "a price on a module every plan includes did not reach the shop that has it past its plan").toBe(owedBefore + 700);

    // And a price doing that is the line drawn loud — as it is typed, before it is saved.
    await page.reload();
    const box = line.getByRole("spinbutton");
    await expect(box).toHaveValue("700", { timeout: 20_000 });
    await expect(line.locator("[data-reach]")).toHaveAttribute("data-odd", "true");
    await box.fill("");
    await expect(line.locator("[data-reach]"), "a box left free is still drawn as a price to look at").not.toHaveAttribute("data-odd", "true");
    await box.fill("700");
    await expect(line.locator("[data-reach]")).toHaveAttribute("data-odd", "true");
    // An ordinary add-on's price is nothing to look twice at.
    const ordinary = pastLine.getByRole("spinbutton");
    await ordinary.fill("450");
    await expect(pastLine.locator("[data-reach]")).not.toHaveAttribute("data-odd", "true");
  } finally {
    for (const k of ["fuel", "kitchen"]) await put(request, "/admin/modules/prices", { changes: { [k]: pricesBefore[k] ?? null } });
    await put(request, `/admin/tenants/${shop}/modules`, { modules: asBasic, addon_prices: {} });
  }
});

test("a price typed on a screen that has been open a while does not undo one set since", async ({ page, request }) => {
  // The list was saved whole — every box the screen held, as it had loaded
  // them. So a price set from one screen was taken off by a save from another
  // that had been open since before it, and off every bill that carried it.
  // Found when a price on this list changed under one of these tests' feet:
  // its "put it back as I found it" would have erased somebody's price.
  const pricesBefore = await get<Record<string, number>>(request, "/admin/modules/prices");
  const modules = await get<Array<{ key: string; label: string }>>(request, "/admin/modules");
  // Three modules nobody has a price on, so nobody's price is in the way.
  const [mine, theirs, kept] = ["reservations", "stocktake", "disposals", "promotions", "dine_in", "hrm"]
    .filter((k) => !(k in pricesBefore))
    .map((k) => modules.find((m) => m.key === k)!);
  expect(kept, "every module this test could use already has a price on it").toBeTruthy();
  const listed = async () => get<Record<string, number>>(request, "/admin/modules/prices");

  try {
    // One price is on the list when the screen opens, so the screen has a
    // box that is full and was not typed in — on any database.
    await put(request, "/admin/modules/prices", { changes: { [kept.key]: 120 } });

    await page.goto("/admin/plans");
    const prices = page.getByTestId("addon-prices");
    const save = prices.getByRole("button", { name: "Save prices" });
    const box = (m: { label: string }) => prices.getByLabel(`${m.label}: price a month`);
    await expect(box(kept)).toHaveValue("120", { timeout: 20_000 });
    await expect(box(mine)).toHaveValue("");
    await expect(prices.locator("[data-reach]").first()).toBeVisible({ timeout: 15_000 });
    await expect(save, "nothing has been typed and there is something to save").toBeDisabled();

    // Somebody else, on another screen, prices a module. This screen is not told.
    await put(request, "/admin/modules/prices", { changes: { [theirs.key]: 450 } });

    // Here, a different one is priced and saved.
    await box(mine).fill("250");
    await expect(save).toBeEnabled();
    const sending = page.waitForRequest((r) => r.url().endsWith("/admin/modules/prices") && r.method() === "PUT");
    await save.click();
    expect((await sending).postDataJSON(), "the screen sent boxes nobody typed in").toEqual({ changes: { [mine.key]: 250 } });
    await expect(page.getByText("Add-on prices saved")).toBeVisible({ timeout: 15_000 });

    const after = await listed();
    expect(after[mine.key]).toBe(250);
    expect(after[theirs.key], "a save from a screen that had been open a while took off a price set since").toBe(450);
    expect(after[kept.key]).toBe(120);
    for (const [k, v] of Object.entries(pricesBefore)) expect(after[k], `${k} lost its price to a save that was not about it`).toBe(v);

    // The screen now shows the list as it is — the other one's price with it.
    await expect(box(theirs)).toHaveValue("450", { timeout: 15_000 });
    await expect(save).toBeDisabled();

    // A box cleared takes ITS price off, and no other.
    await box(mine).fill("");
    await expect(save).toBeEnabled();
    const clearing = page.waitForRequest((r) => r.url().endsWith("/admin/modules/prices") && r.method() === "PUT");
    await save.click();
    expect((await clearing).postDataJSON()).toEqual({ changes: { [mine.key]: null } });
    await expect.poll(async () => mine.key in (await listed()), { message: "a cleared box left its price on the list" }).toBe(false);
    expect((await listed())[theirs.key]).toBe(450);
    expect((await listed())[kept.key]).toBe(120);
  } finally {
    await put(request, "/admin/modules/prices", { changes: { [mine.key]: null, [theirs.key]: null, [kept.key]: null } });
  }
});
