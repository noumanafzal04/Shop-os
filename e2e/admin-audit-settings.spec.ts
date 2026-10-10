import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, roomToWork, tradeAuth } from "./api";

/**
 * WHO CHANGED WHAT THE PLATFORM CHARGES — in the trail, in words.
 *
 * The add-on price list on a development database went from one price to
 * none in half an hour, and "who emptied it, and when?" could not be read off
 * anything. A shop's every module switch was in the audit log; the list that
 * decides what every shop is billed for a module was not.
 *
 * This prices a module nobody has priced, takes the price off again, and
 * reads both off the audit log the way an admin would: which module, what it
 * was, what it is, who did it.
 *
 * It changes ONE key of the list and hands that key back.
 */

const admin = () => tradeAuth("admin");

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`, { headers: admin() });
  expect(res.ok(), `GET ${path} → ${res.status()}`).toBeTruthy();

  return ((await res.json()) as { data: T }).data;
}

async function price(request: APIRequestContext, key: string, to: number | null): Promise<void> {
  const res = await request.put(`${API}/admin/modules/prices`, { headers: admin(), data: { changes: { [key]: to } } });
  expect(res.ok(), `the price could not be ${to === null ? "taken off" : "set"} (${res.status()} ${await res.text()})`).toBeTruthy();
}

// One signed-in admin, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, tradeAuth("admin"));
});

test("a price put on the add-on list, and taken off it, are each in the audit log — which module, from what, to what, by whom", async ({ page, request }) => {
  const priced = await get<Record<string, number>>(request, "/admin/modules/prices");
  const modules = await get<Array<{ key: string; label: string }>>(request, "/admin/modules");
  const me = await get<{ name: string }>(request, "/auth/me");
  // A module nobody has a price on, so nobody's price is in the way.
  const mine = ["reservations", "stocktake", "disposals", "promotions", "dine_in", "hrm"].filter((k) => !(k in priced)).map((k) => modules.find((m) => m.key === k)!)[0];
  expect(mine, "every module this test could use already has a price on it").toBeTruthy();

  try {
    await price(request, mine.key, 275);

    await page.goto("/admin/audit-logs");
    await expect(page.getByRole("heading", { name: "Audit Log", level: 1 })).toBeVisible({ timeout: 20_000 });
    // The trail offers platform settings as a kind of thing to look for.
    await page.getByLabel("All entities").selectOption({ label: "Platform Setting" });

    const first = page.getByRole("row").nth(1);
    await expect(first, "the price that was just set is not at the head of the audit log").toContainText(`Add-on price · ${mine.label}`, { timeout: 15_000 });
    // Free before, the price now — not "value: 2 fields → 3 fields".
    await expect(first).toContainText("free");
    await expect(first).toContainText("Rs 275");
    await expect(first).not.toContainText("fields");
    // Who.
    await expect(first).toContainText(me.name);
    // And what kind of thing, in words.
    await expect(first).toContainText("Platform setting");
    await expect(first).not.toContainText("PlatformSetting");

    // ── taken off again: the line that could not be found ───────────
    await price(request, mine.key, null);
    await page.reload();
    await page.getByLabel("All entities").selectOption({ label: "Platform Setting" });
    const newest = page.getByRole("row").nth(1);
    await expect(newest).toContainText(`Add-on price · ${mine.label}`, { timeout: 15_000 });
    // Read in order: what it was, struck through; then what it is.
    await expect(newest).toContainText(/Rs 275\s*→\s*free/);
  } finally {
    await price(request, mine.key, null);
  }
});
