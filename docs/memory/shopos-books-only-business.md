---
name: shopos-books-only-business
description: Journey stage Q (finance) DONE + PUSHED 2026-10-10 — RULE: ask what the business HAS (kindOfBusiness: sells / hasTill / noun), never its trade's name; wording per screen in small tested modules; dashboard `books` block; stage 28 makes its OWN business
metadata:
  type: project
---

**Stage Q — a Finance Manager lived through the screens (2026-10-10).** Pushed:
backend `704d276`, panel `b1f2a87`, docs `0c37753`. 13/13 cases, 106/106
mutations, no migration. Decision:
`docs/decisions/shopos-a-business-that-only-keeps-books.md`.

**What was wrong:** nothing was broken (every endpoint 200, backend
walkthrough green) — the screens it bought talked to it as a shop with a
till: "no shift open — the drawer was not adjusted" on EVERY cash entry,
"Cash (from till)", Income = "money in that isn't a sale", Cashbook's Sales /
Refunds columns, Ledger's Sales chip, Subscription's Products / Registers /
"Offline selling 0 / 0", an Online shop card, `/tenant/sales` open by address.

**The rule (STANDING):** ask what the business HAS, in ONE place.
- Panel `common/tenant/kindOfBusiness.ts` → `sells`, `hasTill`,
  `buysFromSuppliers`, `sellsOnline`, `noun` ("shop" | "business"). Wording
  lives in tested modules the pages print from: `expenses/booksWords`,
  `income/cashbookShape`, `income/ledgerShape`, `shop/subscriptionRows`,
  `shop/settingsWords`, `admin/tradePhrase`, `activity/words`.
- Server `BooksDrawer::hasTill()`; `untouchedDrawerWarning($user, …)` is NULL
  with no till (callers `array_filter`). `PlanLimits` rows: `needs`, `kind`,
  `applies`.
- A new sentence about a till / drawer / sale / "your shop" goes through one of
  those — never a literal on a page.

**Three things that were not wording:**
- Finance has its own income categories (`income_categories` in its type
  template; `defaultIncomeCategories($code)`). Seeded at setup only.
- Dashboard `books` block (`DashboardService::booksWaiting`): bills due, income
  due, over budget → rows that open `?tab=recurring` / `?tab=budgets` AND the
  head-of-page sentence, from one module (`booksWaiting.ts`).
  `BudgetStanding::forMonth()` is the one answer for the Budgets tab + dashboard.
- Ledger filter bar: "Clear all" cleared nothing (page MERGED what the bar
  returned); ✕ on the period → server 422. `MoneyFilterBar periodIsGiven`.

**Stage 28 is different from every other trade stage:** it makes its OWN
business (Q1 calls `begin()`; Q2 is the first sign-in and runs once per
business). `-g "Q9 ·|Q10 ·"` to resume. Figures are yesterday + today, so it
runs on any date.

**Not done on purpose:** the plan's own description still reads as a shop's;
shop-side screens have no `h1`; income form toasts a warning while the expense
form holds it in the form; no migration adds the new income categories to
existing finance businesses.

**Every trade has now been lived once.** Related: [[shopos-the-journey]],
[[shopos-half-a-rule]], [[shopos-promise-in-another-file]],
[[shopos-first-paint-asks-nobody]], [[shopos-check-measured-the-wrong-thing]]
