import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { API, ownerAuth, roomToWork } from "./api";

/**
 * SAVED — AND SOMETHING WORTH KNOWING. One behaviour, in both money forms.
 *
 * An expense or an income can be recorded and still have something to say: a
 * budget it took the month past, cash with no drawer open. The server sends
 * those back on a SUCCESSFUL save, and the two forms each did the wrong thing
 * with them:
 *
 *   the expense form stayed open with "Saved" on it — and "Save expense"
 *     still live beside it, over a form full of the bill just filed. One more
 *     press and it was filed twice.
 *   the income form closed and showed the FIRST warning in a toast INSTEAD of
 *     "Income recorded" — so it never said it had saved, dropped any second
 *     warning, and the one it showed was gone in four seconds.
 *
 * The save here is a real one; what the server says about it is put on the
 * answer as it comes back, so the test does not depend on whether a drawer
 * happens to be open in the shop it runs in. Fixed names; cleared before and
 * after.
 */

const NOTES = ["That is over this month's budget for the category.", "Paid in cash, and no drawer is open to take it from."];
const EXPENSE = "E2E Saved-with-a-note bill";
const INCOME = "E2E Saved-with-a-note receipt";

type Entry = { id: string; description: string };

async function held(request: APIRequestContext, kind: "expenses" | "incomes", description: string): Promise<Entry[]> {
  const res = await request.get(`${API}/${kind}?search=${encodeURIComponent(description)}&per_page=50`, { headers: ownerAuth() });
  expect(res.ok(), `the ${kind} could not be read (${res.status()})`).toBeTruthy();

  return ((await res.json()) as { data: Entry[] }).data.filter((e) => e.description === description);
}

async function clear(request: APIRequestContext, kind: "expenses" | "incomes", description: string): Promise<void> {
  for (const entry of await held(request, kind, description)) {
    await request.delete(`${API}/${kind}/${entry.id}`, { headers: ownerAuth() });
  }
}

/** Let the save through for real, and put the notes on its answer. */
async function saysSomething(page: Page, kind: "expenses" | "incomes"): Promise<{ saves: () => number }> {
  let saves = 0;
  await page.route((url) => url.pathname.endsWith(`/api/v1/${kind}`), async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    saves++;
    const answer = await route.fetch();
    const body = (await answer.json()) as { meta?: Record<string, unknown> };

    return route.fulfill({ response: answer, json: { ...body, meta: { ...(body.meta ?? {}), warnings: NOTES } } });
  });

  return { saves: () => saves };
}

// One owner, 240 requests a minute — see roomToWork.
test.beforeEach(async ({ request }) => {
  await roomToWork(request, ownerAuth(), 130, "/auth/me");
});

for (const form of [
  { kind: "expenses" as const, path: "/tenant/expenses", open: /Add expense/, save: "Save expense", description: EXPENSE, title: "Expense recorded", saved: "This expense is recorded.", toast: "Expense recorded" },
  { kind: "incomes" as const, path: "/tenant/income", open: /Add income/, save: "Save income", description: INCOME, title: "Income recorded", saved: "This income is recorded.", toast: "Income recorded" },
]) {
  test(`${form.path}: an entry saved with something to say is saved ONCE, says so, and cannot be saved again from the form`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop", "one walk is enough; it is a dialog, not a layout");

    await clear(request, form.kind, form.description);
    const server = await saysSomething(page, form.kind);

    try {
      await page.goto(form.path);
      await page.getByRole("button", { name: form.open }).first().click();
      // The form, by what it is called — "Add expense", then "Expense
      // recorded". The filter drawer is a dialog on this page as well.
      const dialog = page.getByRole("dialog", { name: /expense|income/i });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel(/^Category/).selectOption({ index: 1 });
      const description = dialog.getByLabel(/^Description/);
      await description.fill(form.description);
      await dialog.getByLabel(/^Amount/).fill("1234");
      await dialog.getByRole("button", { name: form.save }).click();

      // ── it is saved, and it says so — on the form and as a toast ────
      const notice = dialog.getByTestId("saved-notice");
      await expect(notice, "a save with something to say did not say so on the form").toBeVisible({ timeout: 15_000 });
      await expect(notice).toContainText(form.saved);
      await expect(dialog.getByRole("heading", { name: form.title })).toBeVisible();
      // The TOAST, not the form's title — they say the same words, and a
      // check that could not tell them apart passed with the toast gone.
      const toasts = page.locator('[role="status"]:not([data-testid="saved-notice"])');
      await expect(toasts.filter({ hasText: form.toast }).first(), "it never said it had saved").toBeVisible();
      for (const note of NOTES) await expect(toasts.filter({ hasText: note }), "a warning was shown as a toast").toHaveCount(0);

      // Every note, not only the first.
      for (const note of NOTES) await expect(notice).toContainText(note);

      // ── and it cannot be saved a second time from here ──────────────
      await expect(dialog.getByRole("button", { name: form.save }), "Save is still live beside the word Saved").toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
      await expect(description, "the form is still a form after it has saved").toBeDisabled();
      // Enter in a locked field does nothing either.
      await page.keyboard.press("Enter");
      expect(server.saves(), "the entry was sent more than once").toBe(1);
      expect(await held(request, form.kind, form.description), "the entry is in the books more than once").toHaveLength(1);

      // ── Done, and the form is gone ──────────────────────────────────
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(dialog).toHaveCount(0);

      // Opened again it is a clean form, not last time's notice.
      await page.getByRole("button", { name: form.open }).first().click();
      await expect(dialog.getByTestId("saved-notice")).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: form.save })).toBeVisible();
    } finally {
      await clear(request, form.kind, form.description);
    }
  });
}
