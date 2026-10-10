import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { roomToWork, tradeAuth } from "./api";

/**
 * ON THE CONSOLE TOO: a list that did not arrive is not an empty list.
 *
 * The shop's lists are walked by list-failed.spec. The platform's said the
 * same things over a failed request — "No announcements yet", "No banners
 * yet", "Nothing here", "Nobody is behind" — and the last of those is on the
 * billing screen: every shop inside its subscription, because the request
 * for who is NOT had failed.
 *
 * Reads only.
 */

const SLOWED = "Too many requests. Please slow down.";

interface Listed {
  path: string;
  screen: string;
  api: string;
  says: string;
  empty: RegExp;
}

const LISTS: Listed[] = [
  { path: "/admin/tenants", screen: "admin/pages/AdminTenantsPage.tsx", api: "/admin/tenants", says: "The tenant list could not be loaded.", empty: /No tenants found|No business matches/ },
  { path: "/admin/audit-logs", screen: "admin/pages/AdminAuditPage.tsx", api: "/admin/audit-logs", says: "The audit log could not be loaded.", empty: /No audit entries match/ },
  { path: "/admin/announcements", screen: "admin/pages/AdminAnnouncementsPage.tsx", api: "/admin/announcements", says: "The announcements could not be loaded.", empty: /No announcements yet/ },
  { path: "/admin/banners", screen: "admin/pages/AdminBannersPage.tsx", api: "/admin/banners", says: "The banners could not be loaded.", empty: /No banners yet/ },
  { path: "/admin/enquiries", screen: "admin/pages/AdminEnquiriesPage.tsx", api: "/admin/enquiries", says: "The enquiries could not be loaded.", empty: /Nothing here\. Most visitors/ },
  { path: "/admin/payments", screen: "admin/pages/AdminPaymentsPage.tsx", api: "/admin/billing/payments", says: "The payments ledger could not be loaded.", empty: /No payments? (in|recorded|matches)/ },
];

async function failIts(page: Page, api: string): Promise<{ asked: () => number }> {
  let asked = 0;
  await page.route((url) => url.pathname.endsWith(`/api/v1${api}`), (route) => {
    if (route.request().method() !== "GET") return route.continue();
    asked++;

    return route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: SLOWED, data: null, errors: {}, meta: {} }),
    });
  });

  return { asked: () => asked };
}

test("this test still knows what each console list says when it IS empty", () => {
  for (const list of LISTS) {
    const written = fs.readFileSync(path.join(process.cwd(), "src/modules", list.screen), "utf8")
      + fs.readFileSync(path.join(process.cwd(), "src/modules/admin/ledgerWords.ts"), "utf8");
    expect(written, `${list.screen} no longer says ${list.empty} — find what it says now when it is empty`).toMatch(list.empty);
  }
});

// One signed-in admin, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

for (const list of LISTS) {
  test(`${list.path}: a list that failed to arrive says so — not that there is nothing`, async ({ page }) => {
    const held = await failIts(page, list.api);
    await page.goto(list.path);

    const failed = page.getByRole("alert").filter({ hasText: list.says });
    await expect(failed, `${list.path} did not say its list had failed to load`).toBeVisible({ timeout: 30_000 });
    expect(held.asked(), "the request this test fails was never made — it is failing the wrong one").toBeGreaterThan(0);
    await expect(failed).toContainText(SLOWED);
    await expect(page.getByText(list.empty), `${list.path} called a failed list an empty one`).toHaveCount(0);
    await expect(page.getByText("Counting…"), `${list.path} says it is counting a list that did not load`).toHaveCount(0);

    await page.unrouteAll({ behavior: "wait" });
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed, "Try again did not bring the list back").toHaveCount(0, { timeout: 20_000 });
  });
}

test("billing whose figures did not arrive does not say everybody has paid", async ({ page }) => {
  // The summary is one request behind every card above the ledger. Failed,
  // the screen drew skeletons for ever where the figures go and, under them,
  // "Nobody is behind. Every shop is inside its subscription."
  await failIts(page, "/admin/billing/summary");
  await page.goto("/admin/payments");

  const failed = page.getByRole("alert").filter({ hasText: "The billing figures could not be loaded." });
  await expect(failed).toBeVisible({ timeout: 30_000 });
  await expect(failed).toContainText(SLOWED);
  await expect(page.getByText("Nobody is behind")).toHaveCount(0);
  // No card left waiting for a figure that is not coming.
  await expect(page.getByTestId("billing-in-period")).toHaveCount(0);
  await expect(page.getByTestId("money-late")).toHaveCount(0);
  // The ledger is its own request, and it did arrive.
  await expect(page.getByRole("heading", { name: "The ledger" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(failed).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("billing-in-period")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("period-name")).toHaveText("This month");
});
