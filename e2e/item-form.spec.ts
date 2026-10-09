import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed, tradeAuth } from "./api";

/**
 * THE ITEM FORM — what is on it, and what it says when a save is refused.
 *
 * Three things this holds in place, each of which the form used to get wrong:
 *
 *   the picture is beside the name, and the second tab is about the online
 *     shop only — it was "Media & online" in every shop that kept photos
 *   a field the server refuses on a tab nobody is looking at is SAID — a
 *     barcode another item already has left Create doing nothing at all
 *   a service can be retired — the switch sat on a tab a service does not have
 *
 * Fixed names; the run clears its own ground first.
 */

const TAKEN = { name: "E2E Form Taken Code", barcode: "8961230000059" };
const SECOND = "E2E Form Second Item";
const HAIRCUT = "E2E Form Haircut";

type Row = Record<string, unknown> & { id: string; name: string };

async function named(request: APIRequestContext, auth: Record<string, string>, name: string): Promise<Row[]> {
  const res = await request.get(`${API}/products?search=${encodeURIComponent(name)}&per_page=20`, { headers: auth });
  expect(res.ok(), `the catalogue could not be read (${res.status()})`).toBeTruthy();

  return (((await res.json()) as { data: Row[] }).data ?? []).filter((p) => p.name === name);
}

async function carded(request: APIRequestContext, auth: Record<string, string>, data: Record<string, unknown>): Promise<Row> {
  const have = await named(request, auth, String(data.name));
  if (have[0]) return have[0];

  const made = await request.post(`${API}/products`, { headers: auth, data });
  expect(made.ok(), `the fixture could not be carded (${made.status()} ${await made.text()})`).toBeTruthy();

  return ((await made.json()) as { data: Row }).data;
}

test("the picture is beside the name, and a refusal on another tab is said where the person is", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk of the form is enough; its fit on small screens is the chrome spec's");

  await removeProductsNamed(request, SECOND);
  await carded(request, ownerAuth(), {
    item_type: "physical_product", name: TAKEN.name, price: 10, barcode: TAKEN.barcode, is_active: true,
    description: "A fixture for the item form.", tax_rate: 0, track_inventory: false,
  });

  await page.goto("/tenant/products/new");
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Add item" }) });
  await expect(form).toBeVisible({ timeout: 20_000 });

  // ── what is on it ─────────────────────────────────────────────────
  // This shop sells online: four tabs, and the second is about that and nothing else.
  for (const tab of ["Details", "Online", "Sizes & options", "Codes & packs"]) {
    await expect(form.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }
  await expect(form.getByRole("button", { name: /Media/ }), "the tab is still called Media").toHaveCount(0);
  // The picture is on the first screen, beside the name.
  await expect(form.getByTestId("item-photo"), "the picture is not on Details").toBeVisible();
  await expect(form.getByTestId("item-photo")).toContainText("+ Add photo");
  // The switch that retires an item is on the tab every item has.
  await expect(form.getByRole("button", { name: /^Still selling this/ })).toBeVisible();

  // ── a refusal nobody is looking at ────────────────────────────────
  await form.getByLabel("Name *", { exact: true }).fill(SECOND);
  await form.getByLabel("Price *", { exact: true }).fill("25");
  await form.getByLabel("Description *", { exact: true }).fill("A second item, with a code that is already taken.");
  await form.getByRole("button", { name: "Codes & packs", exact: true }).click();
  await form.getByLabel("Barcode", { exact: true }).fill(TAKEN.barcode);
  await form.getByRole("button", { name: "Details", exact: true }).click();
  await form.getByRole("button", { name: "Create item" }).click();

  const refused = form.getByTestId("item-refused");
  await expect(refused, "the save was refused on another tab and Details says nothing").toBeVisible({ timeout: 15_000 });
  await expect(refused).toContainText(/barcode/i);
  await expect(form.getByTestId("tab-refused-advanced"), "the tab holding the refused field is not marked").toBeVisible();
  expect(await named(request, ownerAuth(), SECOND), "a refused item was saved").toHaveLength(0);

  // It takes you there, where the field says it itself — once, not twice.
  await refused.getByRole("button", { name: "Open Codes & packs" }).click();
  await expect(form.getByLabel("Barcode", { exact: true })).toBeVisible();
  await expect(form.getByText(/barcode.*(taken|already|another)/i)).toHaveCount(1);
  await expect(refused).toHaveCount(0);

  // ── the online tab says what a customer will find ─────────────────
  await form.getByRole("button", { name: "Online", exact: true }).click();
  const ready = form.getByTestId("online-ready");
  await expect(ready).toContainText("No photo yet");
  await expect(ready).toContainText("A description");
  await expect(form.getByLabel("Minimum order quantity (online)", { exact: true })).toBeVisible();
});

test("a service can be retired from its own form, and not only deleted", async ({ browser, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk is enough");

  const auth = tradeAuth("services");
  const haircut = await carded(request, auth, {
    item_type: "service", name: HAIRCUT, price: 500, is_active: true, duration_minutes: 30,
  });
  const set = async (is_active: boolean) => {
    const res = await request.put(`${API}/products/${haircut.id}`, { headers: auth, data: { name: HAIRCUT, price: 500, is_active } });
    expect(res.ok(), `the fixture could not be reset (${res.status()} ${await res.text()})`).toBeTruthy();
  };
  await set(true);

  // The salon's own session, not the grocer's this file otherwise runs as.
  const context = await browser.newContext({ storageState: "e2e/.auth/services.json", baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await page.goto(`/tenant/products/${haircut.id}/edit`);
  const form = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: `Edit ${HAIRCUT}` }) });
  await expect(form).toBeVisible({ timeout: 20_000 });

  // A service has no codes and no packs, and so no such tab…
  await expect(form.getByRole("button", { name: "Codes & packs", exact: true })).toHaveCount(0);
  // …and the switch is here all the same.
  const selling = form.getByRole("button", { name: /^Still selling this/ });
  await expect(selling, "a service has nowhere to be retired from").toBeVisible();
  await expect(selling).toHaveAttribute("aria-pressed", "true");
  await selling.click();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(form).toHaveCount(0, { timeout: 15_000 });

  await expect.poll(async () => (await named(request, auth, HAIRCUT))[0]?.is_active, { message: "the service is still on sale" }).toBe(false);

  // Reopened, the form says so before anything is read.
  await page.goto(`/tenant/products/${haircut.id}/edit`);
  await expect(page.getByRole("dialog").getByText("Not selling", { exact: true })).toBeVisible({ timeout: 20_000 });

  await context.close();
  await set(true);
});
