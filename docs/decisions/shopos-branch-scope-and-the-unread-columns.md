# Branch scope, and four more columns nobody read

`2026-08-09` — backend. Closes the seven outstanding findings from the expense
audit. Full suite **1433 passed / 6187 assertions** (was 1407), Pint clean on
every touched path.

## 1. The Cashbook and the Ledger disagreed about money

The Ledger scoped by `BranchContext`; `ReportService` took no branch parameter at
all. On a multi-branch tenant with a branch selected, **two screens answered the
same question differently**, and nothing on either said which was the shop's.

`?string $branchId` now threads through `summary`, `series`, `topProducts`,
`expensesByCategory`, `margins`, `staffPerformance`, `tax` and `cashbook`,
matching `LedgerService`'s existing parameter order. `ReportController` passes
`BranchContext::scopeId()` — null still means the owner's all-branches roll-up.

**`purchases` is deliberately left tenant-wide.** `purchase_orders` has no branch
column, because an order is raised against a *supplier* and the goods can be
received anywhere. Inventing one would make per-branch totals disagree with the
supplier's own statement. That needs a column and a decision, not a filter.

The CSV export of margins was scoped too. An export that widens the scope the
merchant was looking at is a different report with the same name.

## 2. Refunds belonged to no branch at all

`sale_returns` had no `branch_id`, so a branch-scoped Ledger *could not* exclude
another branch's refunds even in principle.

The visible half was wrong rows. The worse half: a refund dated before the window
never appears as a row, so it was folded silently into the **opening balance** —
every running balance down the page inherited it, on a screen whose only reason
to exist is that column.

Migration `2026_08_09_000001` adds the column, indexes `(tenant_id, branch_id,
returned_at)`, and backfills from the parent sale with a correlated subquery that
runs identically on MySQL and SQLite. Verified against the real MySQL dev
database inside a rolled-back transaction, because an empty table proves nothing.

**A refund belongs to the branch of the sale it reverses**, not to whichever till
handed the cash back. That is the only reading under which a branch's takings and
its refunds describe the same trade. `ProcessSaleReturnAction` takes it from
`$sale->branch_id`, which it already had in hand for the stock movements.

## 3–5. Three more columns written and never read

Same shape as the `drug_schedule` / `tax_group_id` / `kitchen_station` trio found
earlier this week. The schema looks finished, so nobody goes looking.

- **`incomes.attachment_path`** — expenses have had receipt capture since the
  module shipped; income had the column and nothing else. The side of the book an
  owner is most likely to challenge ("what was this Rs 80,000?") was the side
  with no evidence. Added `attach`/`detach` mirroring the expense pair, plus the
  `attachment_url` accessor. Deliberately *not* blocked by `assertAmendable()`:
  attaching paper changes no money, and refusing it would leave a closed shift
  permanently unevidenced.
- **`expenses.recurring_expense_id`** — stamped by `PostRecurringExpenseAction`,
  read by nothing, so the books could not answer a question about their own rows:
  is this second rent entry a duplicate or the standing one? Added the relation,
  eager-loaded it, and added `?source=recurring|manual` and
  `?recurring_expense_id=` so the standing costs can be set apart from the
  decided ones.
- **`expenses.supplier_id`** — validated in and loaded out, with nothing between
  ever asserting it. The gap was that the column was writable and readable but
  not *askable*; added `?supplier_id=`. Suppliers ride `feature:inventory` +
  `suppliers.read`, so the panel control belongs behind that gate — **still
  outstanding, panel side.**

## 6. Retiring a category unspent its money

The Budgets page listed `is_active = true` categories but summed spend across all
of them. Close "Ramzan Promo" in May and August's page showed a total lower than
what the shop actually spent, with no row and no hint anything was missing.

A retired category now earns its row for exactly as long as it has money against
it — soft-deleted ones too, same reason — and carries `is_retired` so the screen
marks it rather than offering it as somewhere to budget. A retired category
nobody spent against still stays off the page; otherwise the fix grows the list
forever with dead rows.

## 7. `/expense-categories` at 150 rows

`withCount` + `withSum` is two correlated subqueries **per category**, on an
endpoint the expense form loads every time it opens — cost growing with the
catalogue *and* with the expense history behind it.

Replaced with one grouped pass. **The response is byte-for-byte what it was**,
because the panel picker takes a flat array and typed pagination onto it would
have broken every dropdown. `?search=` and `?per_page=` are opt-in for the
management screen; without `per_page` the flat array is unchanged.

## What this run confirms about the codebase

Nine unread columns in the previous sweep, four more here. This is not a run of
bad luck, it is a shape the codebase produces: **a column added with its feature,
wired at one end, and shipped.** Schema review will not catch it — the schema is
the part that looks right.

Two habits that did catch things here:

- Every fix was **reverted after it went green** to confirm the new test actually
  fails without it. Two of the six new branch tests were the only ones that
  moved; the other four would have passed against the bug.
- The MySQL backfill was exercised with a real row and rolled back. `RefreshDatabase`
  runs migrations against an empty database, so **no test can cover a backfill.**

## The panel half, same session

Finishing the backend without the panel would have left **five fresh instances
of the exact bug above** — endpoints with nothing calling them. Panel gate:
**153 tests** (was 146), tsc / eslint / build clean.

- **Income receipts.** `attachment_url` on the type, attach/detach mutations, a
  Receipt column mirroring the expense side.
- **Supplier picker**, absent rather than disabled. Two gates, not one: the
  `inventory` module *and* one of `suppliers.manage` / `purchases.manage` /
  `inventory.manage`, because cost prices live in that directory. `useSuppliers`
  gained an `enabled` option for it — without that, a book-keeper who can file
  bills all day would fire a 403 every time the expense page opened. The payload
  sends `null` rather than omitting the key, or clearing the picker would leave
  the old supplier in place.
- **`scheduled` badge** on rows a schedule posted, and a *Where it came from*
  filter following the `sorts` precedent — offered only where the server can
  honour it, so income's bar shows nothing.
- **`closed` badge** on retired budget rows, with the budget box replaced by a
  line of text. Accounting for money already spent is not an invitation to plan
  more against a category nothing can be filed under.
- **Budgets CSV**, built client-side via a new `downloadCsv`. Budgets return the
  whole set in one response, so the rows on screen *are* the rows in the file and
  a round trip could only make the two disagree. Everything else still streams
  from the server, because an export of page one is not an export.

`downloadCsv` has seven tests, and they are the reason it exists rather than an
inline `join(",")`: a category called "Rent, shop" splits into two columns
unquoted, an Urdu name is mojibake in Excel without a BOM, and a field starting
`=`, `+`, `-` or `@` is **executed as a formula** — a merchant's own books should
not be able to run something on their machine.

## Still outstanding

- `purchase_orders.branch_id` if per-branch buying is ever wanted.
