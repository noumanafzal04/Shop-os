---
name: shopos-archived-is-not-deleted
description: Retention is enforced on lists and reports only, never on a balance, and never silently
metadata:
  type: project
---

**2026-10-04.** `plans.retention_months` is enforced. Three rules make it
shippable, and each has a test that fails without it.

**Never a balance.** Only historical LISTS and REPORTS are fenced. A list is a
window onto rows — dropping the oldest page shortens the answer and you can
SEE it is shorter. A balance is the sum of every row there has ever been, so
dropping the oldest rows does not shorten it, it CHANGES it, and nothing on
screen looks different. Stock on hand, a customer's khata, a supplier account
are untouched. `ArchivedIsNotDeletedTest` exists for this one bug because
every natural implementation — a global scope, a trait, a middleware that
rewrites `from` — fences the ROWS instead of the READ.

**Never silent.** Every fenced read carries `meta.retention` and the panel
prints it under the pager, even when nothing was cut off. A notice that first
appears at the wall arrives too late: the shopkeeper is already on the phone
believing the records are gone.

**Never a delete.** Raise the plan and last year is back the same minute.

Choke points: `SaleController::filtered`, `MoneyEntryFilters::apply`,
`AuditLogController`, `PurchaseOrderController`, `BusinessDayController`
(index + deposits), and `ReportService::resolvePeriod` which covers all
thirteen report endpoints. `BusinessDayController::current()` is deliberately
NOT fenced — the day being traded is not history.

Related: [[shopos-the-plan-ladder]].
