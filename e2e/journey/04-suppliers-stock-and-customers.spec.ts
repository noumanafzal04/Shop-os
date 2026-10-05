import { OWNER_STATE, ask, expect, rupees, session, settled, test } from "./kit";
import { CUSTOMERS, GROUPS, PURCHASE, SUPPLIERS, item } from "./shop";

/**
 * STAGE B (the back office) — who the shop buys from, what arrives, and who
 * it sells to.
 *
 * A purchase order is the first thing in the journey that moves two numbers
 * at once: the shelf goes UP by what was received and the supplier is OWED
 * what it cost. Both are read back, and so is the cost of the goods, which
 * blends with what was already on the shelf.
 */

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => { await session(browser, "owner"); });
test.use({ storageState: OWNER_STATE });

type Row = Record<string, unknown>;
const stockOf = async (request: Parameters<typeof ask>[0], name: string) => {
  const rows = await ask<Row[]>(request, "owner", `/products?search=${encodeURIComponent(name)}`);
  const p = rows.find((r) => r.name === name)!;

  return { stock: Number(p.stock_quantity), cost: Number(p.cost), id: String(p.id) };
};

test("B8 · suppliers are added and listed", async ({ page, request }) => {
  const held = await ask<Row[]>(request, "owner", "/suppliers?per_page=100");

  for (const s of SUPPLIERS) {
    if (held.some((h) => h.name === s.name)) continue; // resumed

    await page.goto("/tenant/suppliers");
    await page.getByRole("button", { name: "+ New supplier" }).click();
    const form = page.getByRole("dialog", { name: "New supplier" });
    await form.getByRole("textbox", { name: "Supplier / company name *" }).fill(s.name);
    await form.getByRole("textbox", { name: "Contact person" }).fill(s.contact);
    await form.getByRole("textbox", { name: "Phone" }).fill(s.phone);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  await page.goto("/tenant/suppliers");
  await settled(page);
  for (const s of SUPPLIERS) {
    await expect(page.getByRole("row").filter({ hasText: s.name }).first(), `${s.name} is not listed`).toBeVisible();
  }
});

test("B9 · a purchase order is placed, received, and the shelf and the supplier both move", async ({ page, request }) => {
  const before = {
    oil: await stockOf(request, item("oil").name),
    rice: await stockOf(request, item("rice").name),
  };
  const existing = await ask<Row[]>(request, "owner", "/purchase-orders?per_page=50");
  test.skip(existing.some((po) => po.status === "received"), "resumed: this journey's purchase order is already received");

  // ── write it ───────────────────────────────────────────────────────
  await page.goto("/tenant/purchases");
  await page.getByRole("button", { name: "+ New purchase order" }).click();
  const form = page.getByRole("dialog", { name: "New purchase order" });

  const supplier = form.getByLabel("Supplier", { exact: true });
  await expect.poll(async () => (await supplier.locator("option").allTextContents()).join("|")).toContain(PURCHASE.supplier);
  await supplier.selectOption({ label: PURCHASE.supplier });

  for (const line of PURCHASE.lines) {
    const name = item(line.item).name;
    await form.getByPlaceholder("Search products to add…").fill(name);
    await form.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await form.getByLabel(`Quantity of ${name}`).fill(String(line.quantity));
    await form.getByLabel(`Cost each for ${name}`).fill(String(line.cost));
  }

  // The form adds it up before anything is sent.
  await expect(form.getByText(/^Rs /).last()).toHaveText(/95,500/);

  await form.getByRole("button", { name: "Place order" }).click();
  await expect(form).toBeHidden({ timeout: 15_000 });

  // ── it is on the list, ordered, unpaid ─────────────────────────────
  const row = page.getByRole("row").filter({ hasText: PURCHASE.supplier }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(/ordered/i);
  await expect(row).toContainText("95,500");

  // Nothing has arrived yet: ordering is not receiving.
  expect((await stockOf(request, item("oil").name)).stock, "stock moved when the order was only PLACED").toBe(before.oil.stock);

  // ── the goods arrive ───────────────────────────────────────────────
  await row.click();
  const detail = page.getByRole("dialog").filter({ hasText: "Receive all" });
  await expect(detail).toBeVisible();
  await detail.getByRole("button", { name: /Receive all/ }).click();
  await expect(page.getByRole("row").filter({ hasText: PURCHASE.supplier }).first()).toContainText(/received/i, { timeout: 20_000 });

  // ── the shelf went up by exactly what was received ─────────────────
  const after = {
    oil: await stockOf(request, item("oil").name),
    rice: await stockOf(request, item("rice").name),
  };
  expect(after.oil.stock).toBe(before.oil.stock + 20);
  expect(after.rice.stock).toBe(before.rice.stock + 30);

  // ── and the cost blended with what was already there ───────────────
  // (40 × 2,500 + 20 × 2,450) ÷ 60, and (60 × 1,600 + 30 × 1,550) ÷ 90.
  expect(after.oil.cost).toBeCloseTo((before.oil.stock * before.oil.cost + 20 * 2450) / (before.oil.stock + 20), 2);
  expect(after.rice.cost).toBeCloseTo((before.rice.stock * before.rice.cost + 30 * 1550) / (before.rice.stock + 30), 2);

});

test("B9 · the supplier is owed exactly what the order cost", async ({ page }) => {
  await page.goto("/tenant/suppliers");
  await settled(page);
  const owed = page.getByRole("row").filter({ hasText: PURCHASE.supplier }).first();
  await expect(owed).toBeVisible();

  // The MONEY in the row — its phone number is digits too, and the first
  // version of this read "0421110001" as the amount outstanding.
  const amounts = ((await owed.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
  expect(amounts, "what the Suppliers list says is outstanding").toContain(PURCHASE.total);

  // The two the shop has not bought from are owed nothing.
  for (const other of SUPPLIERS.filter((s) => s.name !== PURCHASE.supplier)) {
    const row = page.getByRole("row").filter({ hasText: other.name }).first();
    const theirs = ((await row.innerText()).match(/Rs\s?[0-9,]+(?:\.[0-9]+)?/g) ?? []).map(rupees);
    expect(theirs.every((a) => a === 0), `${other.name} is shown as owed ${theirs.join(", ")}`).toBe(true);
  }
});

test("B10 · the Inventory screen shows the same shelf", async ({ page, request }) => {
  const oil = await stockOf(request, item("oil").name);

  await page.goto("/tenant/inventory");
  await settled(page);
  const search = page.getByPlaceholder(/search/i).first();
  await search.fill(item("oil").name);
  const row = page.getByRole("row").filter({ hasText: item("oil").name }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row, "Inventory and Products disagree about the same item").toContainText(String(oil.stock));
});

test("B12 · customer groups, customers and a credit limit are added and read back", async ({ page, request }) => {
  // ── groups ─────────────────────────────────────────────────────────
  const groupsHeld = await ask<Row[]>(request, "owner", "/customer-groups?per_page=100");
  await page.goto("/tenant/customers");
  await page.getByRole("button", { name: "Groups" }).click();
  const groups = page.getByRole("dialog", { name: "Customer groups" });
  for (const g of GROUPS) {
    if (groupsHeld.some((h) => h.name === g.name)) continue; // resumed
    await groups.getByPlaceholder("Group name (e.g. Wholesale)").fill(g.name);
    await groups.getByLabel("Price level", { exact: true }).selectOption({ label: g.level });
    await groups.getByPlaceholder("Members' discount %").fill(String(g.pct));
    await groups.getByRole("button", { name: "Add", exact: true }).click();
    await expect(groups.getByText(g.name).first()).toBeVisible({ timeout: 15_000 });
  }
  await groups.getByRole("button", { name: "Done" }).click();

  // ── customers ──────────────────────────────────────────────────────
  const held = await ask<Row[]>(request, "owner", "/customers?per_page=100");
  for (const c of CUSTOMERS) {
    if (held.some((h) => h.phone === c.phone)) continue; // resumed

    await page.getByRole("button", { name: "+ Add customer" }).click();
    const form = page.getByRole("dialog", { name: "Add customer" });
    await form.getByRole("textbox", { name: "Name *" }).fill(c.name);
    await form.getByRole("textbox", { name: "Phone" }).fill(c.phone);
    if ("creditLimit" in c) await form.getByRole("spinbutton", { name: /Credit limit/ }).fill(String(c.creditLimit));
    if ("group" in c) await form.getByLabel("Customer group", { exact: true }).selectOption({ label: new RegExp(c.group).source });
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }

  // ── on the list ────────────────────────────────────────────────────
  await page.reload();
  await settled(page);
  for (const c of CUSTOMERS) {
    await expect(page.getByRole("row").filter({ hasText: c.name }).first(), `${c.name} is not listed`).toBeVisible();
  }

  // ── and what the TILL will be told about each ──────────────────────
  for (const c of CUSTOMERS) {
    const looked = await ask<{ name: string; credit_limit: number | null; group: { name: string; price_level: string; discount_percent: number } | null }>(
      request, "owner", `/customers-lookup?phone=${c.phone}`,
    );
    expect(looked.name).toBe(c.name);
    if ("group" in c) {
      const g = GROUPS.find((x) => x.name === c.group)!;
      expect(looked.group?.name).toBe(g.name);
      expect(looked.group?.discount_percent).toBe(g.pct);
      expect(looked.group?.price_level).toBe(g.level.startsWith("Wholesale") ? "wholesale" : "retail");
    } else {
      expect(looked.group).toBeNull();
    }
    if ("creditLimit" in c) expect(looked.credit_limit).toBe(c.creditLimit);
  }
});
