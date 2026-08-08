# Real money on a practice till, and three fields with no box

`2026-08-09`

The brief was "the Expense Manager's UI is poor". Fixing it turned up three
money bugs underneath, all in the seam between the books and the cash drawer.

## 1. A practice shift was taking real money

An expense is always real. The row lands in the books, the cashbook, the ledger
and every report the moment it is filed. A practice shift is the opposite —
everything rung on it is discarded, which is the entire point of it.

Pair the two and both halves break. With a training shift open, a cash expense
wrote a real expense row **and** an `expense_out` against the practice drawer:

- the real drawer never learns the cash left it, and closes short by exactly
  that amount with nothing to explain it — the precise failure this module
  exists to prevent, arriving through the back door;
- the expense is stamped with a movement on a practice shift, so the moment
  that shift closes the entry is frozen for good by `isSettledInAClosedShift()`
  and a genuine bill can never be corrected.

`App\Support\BooksDrawer` now treats a practice shift exactly like no shift at
all: the entry is still recorded, because the money genuinely was spent, and the
person is told the drawer was not touched. Two different sentences on purpose —
"you have no till open" and "the till you have open isn't real" are different
facts. Applied at all four call sites: record expense, record income, revise
expense, update income.

## 2. Correcting card → cash did nothing

`ReviseExpenseAction` had two of the three directions. Cash → card deleted the
movement. Cash → cash amended it. **Card → cash created nothing** — so the row
said the money came out of the till while the drawer had never heard of it, and
the shift closed short. The third arm now creates the movement, or warns when
there is no real drawer to move.

## 3. Every income filed from the panel was cash

`IncomePage` had no payment-method field at all — it posted four fields. The
server defaults a missing `payment_method` to `cash`, and `RecordIncomeAction`
puts cash in the open drawer. So an owner logging a bank transfer while a till
was running handed that cashier a **phantom overage**.

Proven with a probe before fixing: a bank-transfer income created `income_in`
and moved the drawer to 30000.

## The UI, which is what was actually asked for

`CategoryManager` rendered every category flat, with a search box that appeared
only past eight and nothing else. A Finance-Manager tenant is *seeded* with 20
and accountants keep 150+. Now a toolbar from seven up: search, an
All / In use / Switched off segmented filter with live counts, sort by
A–Z / most used / highest total, and rows drawn a page at a time with each
section paging independently, so a long live list can never hide the retired one.

Filters follow one pattern now, and it is worth writing down because it is the
one that keeps being got wrong: a compact **always-visible** bar (search, dates,
a counted Filters button), a right-side canvas for the long and rare filters —
which becomes a bottom sheet only below `sm`, because on a desktop table a
bottom sheet covers the very rows you are filtering — and **removable active
chips above the table**. The chips are not decoration. A canvas that hides what
is applied is how a merchant concludes the numbers are wrong.

## Three more fields that were built and unreachable

Making the tabs filterable turned up the same shape as the rest of the week:

- **expense `notes`** — stored, exported, and *searched by the filter bar*, with
  no box anywhere to type it in. Empty on every row ever filed.
- **recurring `is_active`** — displayed as "paused", accepted by the API,
  settable from nowhere. Killing a dead template meant deleting it and losing
  the schedule with it.
- **budgets `month`** — the API has taken it since budgets shipped; the panel
  only ever asked for "now".

Plus `period=custom` on reports, which was validated server-side and had no UI.
Wiring it caught `ReprintReportTab` resolving its own dates and starting its
week on **Sunday** while every neighbour used Carbon's Monday.

## Still open, and the first one matters

**The Cashbook ignores branch scope while the Ledger honours it.** On a
multi-branch tenant with a branch selected the two screens report different
money for the same period — `ReportService::cashbook` takes no branch parameter,
while `ExpenseController`, `IncomeController`, `ExpenseBudgetController` and
`LedgerService` all scope by `BranchContext`. `ReportService::summary` has the
same shape, so the whole Reports screen is tenant-wide.

Related: a branch-scoped Ledger silently includes every branch's refunds,
because `sale_returns` carries no `branch_id`. It lands in the opening balance,
so the balance column of a branch view is wrong by other branches' refunds.

Behind those: income has no receipt capture though `incomes.attachment_path`
exists; `expenses.recurring_expense_id` is write-only; a retired category's
spend vanishes from Budgets; there is no budget CSV export.

## Contrast

Separately, `text-gray-400 dark:text-gray-500` was being used for *content* text
across eight dashboard files — table headings, KPI captions, timestamps. That is
2.5:1 on white and ~3.4:1 on the dark ground, both failing WCAG AA, on 12px
uppercase headings read in shop lighting. Now `text-gray-500 dark:text-gray-400`
— 4.9:1 and 6.8:1.
