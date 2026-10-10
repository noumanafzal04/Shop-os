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

  // The ground this run stands on.
  await put(request, `/admin/plans/${basic.id}`, { modules: null });
  await put(request, "/admin/modules/prices", { prices: { ...pricesBefore, customers: 500 } });
  const shop = await theShop(request, basic);

  try {
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
    await put(request, "/admin/modules/prices", { prices: pricesBefore });
  }
});
