import fs from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, removeProductsNamed } from "./api";

/**
 * A CATALOGUE FROM ANOTHER SYSTEM'S FILE — through the screen.
 *
 * The import was one step: choose a file, press Import, read what had already
 * happened. This walks the three it is now, with the kind of file a shop that
 * is moving over actually has — its old system's own headings, a category
 * spelt wrong, a column nobody asked for and one price that is not a number:
 *
 *   the check says what will happen and SAVES NOTHING
 *   a heading nobody knows is asked about, and then obeyed
 *   a category the shop does not have is asked about — never made from a typo
 *   the rows that will not go in can be taken away as a file, with the reason
 *   and what goes in is what the check said would
 *
 * Fixed names throughout; the run clears its own ground first.
 */

const PREFIX = "E2E Import ";
const SHELF = "E2E Import Drinks";

const FILE = [
  "Item Name,Product Code,Selling Price,Purchase Price,Qty,Company,Category,Kitchen Station",
  `${PREFIX}Cola 1.5L,E2E-IMP-COLA,220,190,24,Al-Noor,E2E Import Drinsk,Bar`,
  `${PREFIX}Lemon Soda,E2E-IMP-LEMON,"1,180",150,12,Al-Noor,E2E Import Drinsk,Bar`,
  `${PREFIX}Water 1.5L,E2E-IMP-WATER,90,70,60,Nestle,${SHELF},Bar`,
  `${PREFIX}Bad Price,E2E-IMP-BAD,abc,10,1,Nobody,${SHELF},Bar`,
].join("\n");

type Row = Record<string, unknown>;

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: ownerAuth() });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

const ours = async (request: APIRequestContext) =>
  (await get<Array<Row & { name: string }>>(request, `/products?search=${encodeURIComponent(PREFIX)}&per_page=50`)).filter((p) => p.name.startsWith(PREFIX));

const flat = (tree: Array<Row & { name: string; children?: unknown[] }>): Array<Row & { name: string }> =>
  tree.flatMap((c) => [c, ...flat((c.children ?? []) as Array<Row & { name: string }>)]);
const shelves = async (request: APIRequestContext) => flat(await get<Array<Row & { name: string }>>(request, "/categories"));

/** The one shelf the file's rows belong on. Made once, and left. */
async function theShelf(request: APIRequestContext): Promise<string> {
  const have = (await shelves(request)).find((c) => c.name === SHELF);
  if (have) return String(have.id);

  const res = await request.post(`${API}/categories`, { headers: ownerAuth(), data: { name: SHELF } });
  expect(res.ok(), `the shelf could not be made (${res.status()})`).toBeTruthy();

  return String(((await res.json()) as { data: { id: string } }).data.id);
}

const tile = (page: Page, key: string) => page.getByTestId(`import-${key}`);

test("another system's file is checked, asked about, and brought in — and nothing is saved before Import", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "one walk of the import is enough; it is a dialog, not a layout");

  await removeProductsNamed(request, PREFIX);
  const shelf = await theShelf(request);
  const shelvesBefore = (await shelves(request)).length;

  await page.goto("/tenant/products");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Import items" }) });
  await expect(dialog).toBeVisible();

  // ── the template is an Excel workbook, built for this shop ────────
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Excel template" }).click();
  const template = await downloading;
  expect(template.suggestedFilename()).toBe("products-import-template.xlsx");
  const saved = await template.path();
  expect(fs.readFileSync(saved).subarray(0, 2).toString(), "the Excel template is not an Excel file").toBe("PK");

  // ── the check ─────────────────────────────────────────────────────
  await dialog.locator("#import-file").setInputFiles({ name: "old-system-export.csv", mimeType: "text/csv", buffer: Buffer.from(FILE) });
  await dialog.getByRole("button", { name: "Check the file" }).click();
  const check = dialog.getByTestId("import-check");
  await expect(check).toBeVisible({ timeout: 20_000 });

  // The old system's headings were understood; one row is on a real shelf,
  // two are waiting on a category, and one will not go in.
  await expect(tile(page, "created")).toContainText("1");
  await expect(tile(page, "failed")).toContainText("1");
  await expect(check).toContainText('Row 5: Selling Price "abc" is not a number.');
  // NOTHING has been saved by looking.
  expect(await ours(request), "the check saved something").toHaveLength(0);

  // A column that belongs to another kind of shop is left out — and said,
  // not silently dropped and not refused. This shop is a grocer.
  await expect(check).toContainText("Columns left out");
  await expect(check).toContainText("Kitchen Station — it is not something your kind of shop keeps.");

  // ── a heading nobody knows ────────────────────────────────────────
  await expect(check).toContainText("Columns we did not recognise");
  await check.getByLabel("What the column Company is").selectOption({ label: "Brand" });
  const importButton = check.getByRole("button", { name: /^Import \d+ items?$/ });
  await expect(importButton, "a changed column could be imported without being checked again").toBeDisabled();
  await check.getByRole("button", { name: "Check again" }).click();
  await expect(check.getByText("Columns we did not recognise")).toHaveCount(0, { timeout: 20_000 });

  // ── a category the shop does not have ─────────────────────────────
  await expect(check).toContainText("Categories your shop does not have");
  const choice = check.getByLabel("What to do with the category E2E Import Drinsk");
  // The near-miss starts pointed at the shelf it nearly was — and can be changed.
  await expect(choice).toHaveValue(`map:${shelf}`);
  await choice.selectOption("");
  await expect(importButton, "rows could be imported with their category unanswered").toBeDisabled();
  await choice.selectOption(`map:${shelf}`);
  await expect(importButton).toBeEnabled();
  await expect(importButton).toHaveText("Import 3 items");

  // ── the rows that will not go in, as a file ───────────────────────
  const taking = page.waitForEvent("download");
  await check.getByRole("button", { name: /Download the 1 row to correct/ }).click();
  const handedBack = fs.readFileSync(await (await taking).path(), "utf8");
  expect(handedBack).toContain("Item Name,Product Code,Selling Price,Purchase Price,Qty,Company,Category,Kitchen Station,_import_status,_error_message");
  expect(handedBack).toContain("E2E-IMP-BAD,abc");
  expect(handedBack).toContain("is not a number");
  expect(handedBack, "a row that only needed its category answered was handed back as a fault").not.toContain("E2E-IMP-COLA");

  // ── and now it is saved ───────────────────────────────────────────
  await importButton.click();
  const done = dialog.getByTestId("import-done");
  await expect(done).toBeVisible({ timeout: 20_000 });
  await expect(tile(page, "created")).toContainText("3");
  await expect(tile(page, "failed")).toContainText("1");

  const now = await ours(request);
  expect(now.map((p) => p.name).sort()).toEqual([`${PREFIX}Cola 1.5L`, `${PREFIX}Lemon Soda`, `${PREFIX}Water 1.5L`]);
  const lemon = now.find((p) => p.name === `${PREFIX}Lemon Soda`)!;
  // "1,180" is a price, Company was said to be the brand, and Qty is stock.
  expect(Number(lemon.price)).toBe(1180);
  expect(lemon.brand).toBe("Al-Noor");
  expect(Number(lemon.stock_quantity)).toBe(12);
  expect(lemon.category_id, "the misspelt category did not land on the shelf chosen for it").toBe(shelf);
  // Not one category more than there was.
  expect((await shelves(request)).length, "a spelling mistake became a category").toBe(shelvesBefore);

  await done.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: `${PREFIX}Cola 1.5L` })).toBeVisible({ timeout: 15_000 });

  await removeProductsNamed(request, PREFIX);
});
