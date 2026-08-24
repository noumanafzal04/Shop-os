import { test, expect, type APIRequestContext } from "@playwright/test";

import { API, ownerAuth } from "./api";
import { projectOnly } from "./rules";

/**
 * HIRING SOMEBODY INTO A BRANCH, THROUGH THE SCREEN.
 *
 * The server has accepted and written `users.branch_id` since branches existed.
 * The staff screen never sent it — the word "branch" did not appear on it — so
 * every staff member in every multi-branch shop fell back to Main, and branch
 * two's cashier rang on branch one's stock. A whole model driven by a column
 * nothing set: this repository's most repeated defect, in its most expensive
 * form, because the server was right the entire time and nothing looked wrong.
 *
 * A unit test cannot catch that shape. It needs the actual form, submitted, and
 * then the SERVER asked what it received.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(({ browserName }, testInfo) => {
  void browserName;
  test.skip(
    testInfo.project.name !== "desktop",
    projectOnly("a flow test, not a layout one — chrome.spec walks every screen at every size"),
  );
});

const NAME = "E2E Branch Hire";
const EMAIL = "e2e-branch-hire@shopos.test";

/** The fixture shop needs a second branch before a branch can be chosen. */
async function secondBranch(request: APIRequestContext): Promise<string | null> {
  const auth = ownerAuth();
  const listed = await request.get(`${API}/branches`, { headers: auth });
  if (!listed.ok()) return null;

  const rows = ((await listed.json()) as { data: Array<{ id: string; name: string }> }).data ?? [];
  const found = rows.find((b) => b.name === "E2E Second Branch");
  if (found) return found.id;

  const made = await request.post(`${API}/branches`, {
    headers: auth,
    data: { name: "E2E Second Branch", is_active: true },
  });

  return made.ok() ? ((await made.json()) as { data: { id: string } }).data.id : null;
}

test("a shop hires somebody into a branch and the server has it", async ({ page, request }) => {
  const auth = ownerAuth();

  const branchId = await secondBranch(request);
  test.skip(!branchId, "this shop is on a single-branch plan — nothing to choose between");

  /**
   * REUSED, never deleted and remade.
   *
   * The first version removed last run's hire and created a new one. That left
   * a soft-deleted row behind every single run — and the very first of them
   * found a real bug by colliding with the next create, because the validation
   * exempted trashed rows and the DATABASE's unique index did not. That is
   * fixed; the growth was still mine to stop.
   *
   * So: hire once, and edit that person on every run afterwards. One row,
   * forever, and the assertion is the same either way — did the FORM send a
   * branch the server kept.
   */
  const existing = await request.get(`${API}/staff?search=${encodeURIComponent(NAME)}`, { headers: auth });
  const already = ((await existing.json()) as { data: Array<{ id: string; name: string }> }).data
    ?.find((r) => r.name === NAME);

  await page.goto("/tenant/staff");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);

  if (already) {
    await page.getByLabel(`Edit ${NAME}`).click();
  } else {
    await page.getByRole("button", { name: /Add staff|Add team|New staff/i }).first().click();
  }
  await page.waitForTimeout(700);

  await page.getByLabel(/^Name/).first().fill(NAME);
  await page.getByLabel(/^Email/).first().fill(EMAIL);
  if (!already) await page.getByLabel(/Temp password/i).fill("password123");

  // THE control that did not exist. Its absence is the whole bug.
  const branch = page.getByLabel(/Which branch do they work at/i);
  await expect(branch, "the staff form still cannot name a branch").toBeVisible();
  await branch.selectOption({ label: "E2E Second Branch" });

  // A job, so the person has permissions — the server refuses an empty list.
  await page.getByRole("button", { name: /^Cashier$/ }).first().click();


  await page.getByRole("button", { name: /^(Save|Add|Create)/ }).last().click();
  await page.waitForTimeout(2500);

  // THE assertion, asked of the server rather than of the screen.
  const after = await request.get(`${API}/staff?search=${encodeURIComponent(NAME)}`, { headers: auth });
  const hired = ((await after.json()) as { data: Array<{ name: string; branch_id: string | null }> })
    .data.find((r) => r.name === NAME);

  expect(hired, "the staff member was not created at all").toBeTruthy();
  expect(
    hired!.branch_id,
    "the form saved without a branch — which is the state every staff member was in",
  ).toBe(branchId);
});
