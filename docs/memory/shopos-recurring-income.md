---
name: shopos-recurring-income
description: "Recurring income shipped 2026-08-17 — the Aug-09 gap list is now CLOSED. A template falls DUE, never posts itself; amount overridable at posting; schedule advances from the due date."
metadata:
  type: project
---

`docs/decisions/shopos-recurring-income.md`. **Aug-09 gap list is closed.**

Only half existed: the expense manager's 2nd pass gave rent/salaries/bills a
template that falls due. Income had the same table, categories, drawer link and
branch scope — **and no template.** The flat upstairs, a let shutter, a monthly
supply contract: typed from scratch every month while the electricity bill
three fields away offered itself.

**Copied deliberately, down to column names.** Two screens doing one job in two
vocabularies is how one ends up half-maintained — in a books module where the
shopkeeper reads both sides of the same page.

Rules (they carry MORE weight on this side):

- **A template falls DUE, never posts itself.** Income in the books because a
  clock ticked is income nobody checked against a payment, and **rent is
  exactly what goes unpaid quietly**.
- **Amount overridable at posting.** An expense template forcing last month's
  figure files a wrong one; an income template forcing the agreed figure files
  **a receipt for money nobody received**.
- **Schedule advances from the DUE date**, so three unposted months catch up
  one at a time rather than erasing two.
- **Files against the month it was owed for**, not today.
- Posting early is refused (would skip a period silently).

`RecurringIncomeTest` 12 tests. `test_nothing_posts_itself` runs `schedule:run`
and asserts zero rows — the one that would notice if somebody "helpfully"
automated it. Mutations: advance-from-today fails 6, due-fence removed fails 11.

**Test-helper collisions worth remembering:** `run()` hits PHPUnit's final
`TestCase::run()`, `post()` hits Laravel's `TestCase::post()`. Both are FATALS,
not assertion failures. Use `sweep()` / `fileIt()`.

Related: [[shopos-expense-manager-gaps]], [[shopos-reorder-to-po]], [[shopos-expiry-alerts]].
