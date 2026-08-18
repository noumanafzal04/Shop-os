---
name: shopos-expense-manager-gaps
description: "Expense & Income Manager — second pass SHIPPED (drawer link, budgets, recurring, receipts); what deliberately wasn't built"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-06T15:35:43.317Z
---

As of 2026-08-06 the Expense & Income Manager second pass is **shipped**
(migration `2026_08_06_000002_deepen_expense_manager`, 22 tests, 1026 green).

**The bug that motivated it:** `expense_out` had been declared in
`CashMovement::SYSTEM_TYPES` since the beginning and never written. A shopkeeper
paying a bill from the till filed a perfect expense and left the drawer
expecting cash that was gone — an unexplained short at close, on the one number
a shop uses to detect theft.

**What now exists:**
- `expenses.payment_method` + `cash_movement_id`; only `cash` writes an
  `expense_out` movement, against **the actor's own open shift or nowhere**
  (same rule as void refunds / supplier payouts). No shift → recorded, with a
  warning saying the drawer was untouched.
- `income_in` added as the mirror — cash income is in the till immediately, and
  an unrecorded overage is the variance nobody investigates.
- Edit/delete keeps the movement in step while the shift is OPEN; once the
  shift is closed both are refused (`EXPENSE_SETTLED` / `INCOME_SETTLED`) —
  fix with a compensating entry.
- `expense_budgets`: NULL month = standing monthly ceiling, dated row overrides
  that month. **Never blocks** — warns in `meta.warnings` at entry.
- `recurring_expenses`: templates that fall DUE and are posted by a human. No
  scheduler by design. Amount overridable at posting; schedule advances from
  the DUE date so a late posting doesn't drag the series.
- Receipt attachments (`attachment_path` + appended `attachment_url`).
- Category delete now refused when history exists (`CATEGORY_IN_USE`) —
  deactivate instead, or a year of "Rent" detaches from its name.
- Panel: ExpensesPage rebuilt as three tabs (Expenses / Recurring / Budgets)
  with a due-count badge.

**Deliberately NOT built:** an approval workflow (threshold-based sign-off for
staff-entered expenses). Judged over-engineering for a small shop; revisit if
asked.

Categories: seeded per business type by `ApplyBusinessTypeDefaultsAction` only
when a tenant has none, `is_default` is provenance not a lock, full CRUD on the
backend. **CAUTION — an earlier version of this note said categories "were
already correct". That was wrong in the way that matters: the backend CRUD
existed and the PANEL only ever called `apiGet`, so a merchant had no way to
add or rename one. Fixed in the third pass below. Lesson: "the endpoint exists"
is not "the feature ships".**

---

**2026-08-06 THIRD PASS — SHIPPED (backend f8ff1de 1206 green / 5047 assertions,
+22 tests; panel a6c0c5e 95 green, +6).** Prompted by the user pointing out the
Finance-Manager type was "still basic level expense manage — no dynamic
categories, no deep filters, reports, ledger". All three were correct.

- **THE LEDGER is the headline.** New `App\Services\LedgerService` +
  `GET /ledger` and `/ledger/export`. Line-level: every movement (sale / income
  / expense / refund) as one row with the balance carried down. Built as a DB
  **UNION** (`DB::query()->fromSub`), not four PHP collections, so a mart's
  six-figure year still pages in one query. Rides **`feature:expenses`**, NOT
  `reports.view` — for a books-only shop this IS the module they bought.
  Invariants (each has a test): opening balance = the account before the
  period; **a filter never rewrites the opening balance** (it's a view, not a
  different account); page N carries forward from page N−1; ledger totals ==
  cashbook totals to the paisa.
- **TWO REAL BUGS found while testing the ledger, both non-obvious:**
  (1) a UNION-subquery column carries **no type affinity** and PDO binds a PHP
  float as a **string**, so `amount_out >= 50000.0` compared REAL vs TEXT on
  SQLite → matched NOTHING silently. Fix: `CAST(x AS DECIMAL(18,2))` (the one
  spelling SQLite and MySQL both take). (2) selecting a date column raw gave
  `"2026-03-01 00:00:00"` from expenses vs `"2026-03-01"` from sales → same day
  sorted as two. Fix: `DATE()` on all four sources.
- **`App\Support\MoneyEntryFilters`** — shared by expenses + income: search now
  hits description **+ reference + notes** (a merchant hunting an invoice number
  found nothing before), multi-value `category_id` / `payment_method`, amount
  range, sort, and `meta.totals` for the FILTERED set. `ApiResponse::paginated`
  gained a 3rd `$meta` param for it.
- CSV export for expenses, income and the ledger, carrying the live filter.
- **Panel:** `CategoryManager` (one component, both category types),
  `MoneyFilterBar` (shared by all three screens; totals live IN the bar), new
  `LedgerPage` at `/tenant/ledger` (sidebar under Expense Manager, gated
  `expenses.manage` in screenPermissions), Cashbook day → ledger drill-down.
- **Reports were offering a books-only tenant 7 tabs of which 5 could NEVER
  fill** (Margins/Staff/Tax/Receipts need sales; Purchases needs inventory) and
  an Overview with 4 permanently-Rs 0 cards + a flat-zero revenue line + a "No
  sales in this period" panel forever. Rule extracted to
  `src/modules/expenses/reportTabs.ts` and tested across all 16 module
  combinations.

Related: [[shopos-unit11-status]], [[shopos-build-sequence]], [[shopos-audit-backlog]].
