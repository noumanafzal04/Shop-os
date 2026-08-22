import { test, expect } from "@playwright/test";

import { API, ownerAuth } from "./api";

/**
 * CREATING A SHIRT IN COLOURS AND SIZES, THROUGH THE FORM.
 *
 * This spec exists because of what it found. The variants section had a
 * `+ Add variant` button with no `type`, inside a `<form onSubmit>` — so the
 * HTML default applied and clicking it SUBMITTED. The item was created with zero
 * variants, the drawer closed, and reopening it landed in edit mode where the
 * section was hidden. **The variant editor had never worked**, and every variant
 * in the system had arrived through the API.
 *
 * A thousand unit tests could not see it: the bug is the interaction between a
 * shared component's default, a form element, and a browser's own submit
 * behaviour. Only a real browser pressing a real button has an opinion about
 * that, which is why this file drives the screen rather than the state.
 *
 * ── Desktop only, and stated rather than assumed ────────────────────────
 *
 * This drives a FLOW: press these controls in this order and the right rows
 * appear on the server. Whether that flow is reachable at 390 points is a
 * different question and `chrome.spec` already asks it of every screen.
 *
 * Left unrestricted on the first run, it timed out on phone and tablet-landscape
 * — five minutes each, waiting to click a Save that was disabled because the
 * fields above it had not been filled the way this spec fills them. That is the
 * spec not fitting the viewport, not the screen being broken: measured directly,
 * the footer Save on both sizes is visible, on-screen (604–648 of 664 on a
 * phone) and correctly disabled until the required fields are in. Worth writing
 * down, because "we skipped it on mobile" and "mobile is fine" are not the same
 * sentence and only one of them was checked.
 */

test.describe.configure({ mode: "serial" });

// Playwright wants the fixtures object destructured even when unused, and
// eslint objects to an empty pattern — so the guard goes in a beforeEach, which
// is the canonical form and reads better anyway.
test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    "a flow test, not a layout one — chrome.spec walks every screen at every size",
  );
});

const NAME = `E2E Form Shirt ${Date.now()}`;

test("the size grid generates rows, prices them all at once, and saves them", async ({ page, request }) => {
  const auth = ownerAuth();

  await page.goto("/tenant/products/new");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  // ── the details a product cannot be saved without ────────────────────
  await page.getByLabel(/^Name/).first().fill(NAME);
  await page.getByLabel(/^Price/).first().fill("1000");
  // A description, because this shop sells online and `submit()` returns early
  // without one — "Add a description before saving an item that's shown online."
  // Learned the hard way: the click produced no network request at all, and the
  // only thing on screen was three required-field asterisks.
  await page.getByLabel(/^Description/).first().fill("Cotton shirt, e2e fixture.");

  // ── the sizes tab, which used to vanish on edit ──────────────────────
  await page.getByRole("button", { name: /Sizes & options/i }).click();
  await page.waitForTimeout(400);

  // ── axis one: a colour, typed ────────────────────────────────────────
  await page.getByRole("button", { name: /Add sizes or colours/i }).click();
  const colourName = page.getByLabel("What varies").first();
  await colourName.fill("Colour");

  // Pasted with commas, because a shop with three colours types them once.
  await page.getByLabel(/Add a Colour/i).fill("Red, Blue");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);

  // ── axis two: a size, tapped from the suggestions ────────────────────
  await page.getByRole("button", { name: /Add another option/i }).click();
  await page.waitForTimeout(200);
  const sizeName = page.getByLabel("What varies").nth(1);
  await sizeName.fill("Size");
  await page.waitForTimeout(300);

  // The one-tap values that come with the axis name. These are what the trade
  // config has always known and the form used to spend on grey hint text.
  for (const v of ["S", "M"]) {
    await page.getByRole("button", { name: `+ ${v}`, exact: true }).click();
    await page.waitForTimeout(150);
  }

  // ── four combinations, in reading order ──────────────────────────────
  //
  // The first axis moves slowest, so a colour's sizes stay together — which is
  // how a rail is arranged and how a shop says it out loud.
  // `data-variant-grid`, not "the table" — the product list sits behind the
  // drawer and has one of its own.
  const grid = page.locator("[data-variant-grid]");
  await expect(grid, "the grid did not appear").toBeVisible({ timeout: 8000 });
  for (const label of ["Red / S", "Red / M", "Blue / S", "Blue / M"]) {
    await expect(grid, `${label} was not generated`).toContainText(label);
  }

  // Column headers, which the old grid never had — past row one its only labels
  // were placeholders, and a placeholder clears on the first keystroke.
  for (const head of ["Size", "Price", "Cost"]) {
    await expect(grid.locator("th").filter({ hasText: head }).first()).toBeVisible();
  }

  // ── one price on all four ────────────────────────────────────────────
  await page.getByLabel("Same price for all").fill("1499");
  await page.getByRole("button", { name: /Apply to all/i }).click();
  await page.waitForTimeout(300);

  // Every cell names its own row. Twelve boxes all announced as "Price" is the
  // state this replaces.
  await expect(page.getByLabel("Price for Red / S")).toHaveValue("1499");
  await expect(page.getByLabel("Price for Blue / M")).toHaveValue("1499");

  // One row priced differently, to prove the bulk fill is a starting point and
  // not a straitjacket.
  await page.getByLabel("Price for Blue / M").fill("1650");

  // ── save ─────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: /^(Save|Create)/ }).last().click();
  await page.waitForTimeout(2500);

  // ── and the SERVER has four sizes, at the right prices ───────────────
  //
  // THE assertion. Before the `type="button"` fix this request came back with a
  // product and an empty variants array, because pressing "+ Add variant" had
  // submitted the form.
  const res = await request.get(`${API}/products?search=${encodeURIComponent(NAME)}&per_page=5`, { headers: auth });
  const rows = ((await res.json()) as { data: Array<{ name: string; variants: Array<{ name: string; price: string }> }> }).data;
  const saved = rows.find((r) => r.name === NAME);

  expect(saved, "the product was not created at all").toBeTruthy();
  const priced = Object.fromEntries((saved!.variants ?? []).map((v) => [v.name, Number(v.price)]));

  expect(
    Object.keys(priced).sort(),
    "the product saved with the wrong set of sizes — an empty array here is the submit bug",
  ).toEqual(["Blue / M", "Blue / S", "Red / M", "Red / S"]);
  expect(priced["Red / S"]).toBe(1499);
  expect(priced["Blue / M"], "the per-row price was overwritten by the bulk fill").toBe(1650);
});

test("reopening the item shows the grid it was typed as, and a price can be corrected", async ({ page, request }) => {
  const auth = ownerAuth();

  // Variants used to be create-only: the section was hidden on edit and
  // `PUT /products/{id}` answered 200 while discarding them. So both halves of
  // this are new — that the grid comes back, and that a change sticks.
  const res = await request.get(`${API}/products?search=${encodeURIComponent(NAME)}&per_page=5`, { headers: auth });
  const rows = ((await res.json()) as { data: Array<{ id: string; name: string }> }).data;
  const id = rows.find((r) => r.name === NAME)?.id;
  expect(id, "the first test's product is missing — nothing below can run").toBeTruthy();

  await page.goto(`/tenant/products/${id}/edit`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: /Sizes & options/i }).click();
  await page.waitForTimeout(600);

  // The AXES came back, not just the rows. That is the difference between a grid
  // and twelve unexplained lines.
  await expect(page.getByLabel("What varies").first()).toHaveValue("Colour");
  await expect(page.getByLabel("What varies").nth(1)).toHaveValue("Size");

  const cell = page.getByLabel("Price for Red / S");
  await expect(cell).toHaveValue("1499");
  await cell.fill("1525");

  await page.getByRole("button", { name: /^(Save|Update)/ }).last().click();
  await page.waitForTimeout(2500);

  const after = await request.get(`${API}/products?search=${encodeURIComponent(NAME)}&per_page=5`, { headers: auth });
  const saved = ((await after.json()) as { data: Array<{ name: string; variants: Array<{ name: string; price: string }> }> })
    .data.find((r) => r.name === NAME);
  const red = saved!.variants.find((v) => v.name === "Red / S");

  expect(
    Number(red!.price),
    "the edit was accepted and thrown away — the shape that used to answer 200 and change nothing",
  ).toBe(1525);
});
