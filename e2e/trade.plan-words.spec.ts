import { expect, test, type APIRequestContext } from "@playwright/test";

import { API, tradeAuth } from "./api";
import { projectOnly } from "./rules";

/**
 * WHAT THE PLAN SAYS ABOUT ITSELF — to the business reading it.
 *
 * A plan's description is the platform's sentence about it, and the platform
 * wrote it about shops: "One shop, one counter. Everything a single till
 * needs, and two years of history." It was printed as written on every
 * subscription page — including an office's that bought only the books, on
 * the one page that says what it is paying for.
 *
 * A business that sells is told all of it. One that does not is told the
 * sentences that are not about selling, and the figures under them are its
 * own. Reads only.
 */

const ABOUT_A_TILL = /\b(shop|counter|till)\b/i;

async function written(request: APIRequestContext, trade: string): Promise<{ name: string; description: string }> {
  const res = await request.get(`${API}/shop/subscription`, { headers: tradeAuth(trade) });
  expect(res.ok(), `the ${trade} shop's subscription could not be read (${res.status()})`).toBeTruthy();
  const plan = ((await res.json()) as { data: { plan: { name: string; description: string | null } | null } }).data.plan;
  expect(plan, `the ${trade} test shop is on no plan — this case needs one`).not.toBeNull();
  expect(plan!.description ?? "", `the ${trade} shop's plan no longer talks about a till — this case needs a description that does`).toMatch(ABOUT_A_TILL);

  return { name: plan!.name, description: plan!.description! };
}

test.describe("retail", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "trade-retail", projectOnly("a shop that sells is told its plan as written; the retail project carries one"));
  });

  test("a shop is told what its plan says, as the platform wrote it", async ({ page, request }) => {
    const plan = await written(request, "retail");

    await page.goto("/tenant/subscription");
    await expect(page.getByRole("heading", { name: "Subscription", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("plan-says")).toHaveText(plan.description);
  });
});

test.describe("finance", () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "trade-finance", projectOnly("an office that bought only the books is the business this is about; the finance project carries one"));
  });

  test("an office is not told about a till it does not have — and is still told what it is on", async ({ page, request }) => {
    const plan = await written(request, "finance");

    await page.goto("/tenant/subscription");
    await expect(page.getByRole("heading", { name: "Subscription", level: 1 })).toBeVisible({ timeout: 20_000 });
    // The plan by name, and how far back it keeps the books — in its own terms.
    await expect(page.getByText(plan.name, { exact: true }).first()).toBeVisible();

    // Not one sentence of the description that is about selling.
    for (const sentence of plan.description.split(/(?<=[.!?])\s+/).filter((s) => ABOUT_A_TILL.test(s))) {
      await expect(page.getByText(sentence), `an office was told: "${sentence}"`).toHaveCount(0);
    }
    const says = page.getByTestId("plan-says");
    if ((await says.count()) > 0) await expect(says).not.toHaveText(ABOUT_A_TILL);
    // Nor anywhere else on the page that says what it pays for.
    await expect(page.locator("main").getByText(/\b(till|ring a sale)\b/i)).toHaveCount(0);
  });
});
