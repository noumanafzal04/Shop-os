# Archived is not deleted

**2026-10-04.** The retention window a plan sells is now enforced. It was
recorded and visible for a day, deliberately enforcing nothing, because
hiding a shop's own history is irreversible from where the shopkeeper sits
even when the rows are still there.

What made it shippable is not the fence. It is the three rules around it.

## Never silent

Every fenced read carries `meta.retention` — the months, the date history
starts from, and whether **this** request reached past it. The panel renders
it under the pager on Sales, Expenses and Income, and the Subscription page
prints the date.

It shows even when nothing was cut off. A notice that appears for the first
time at the moment history runs out arrives too late to be information: by
then the shopkeeper is already on the phone, convinced the records are gone.
Shown quietly all the time it is a fact about the plan; shown only at the
wall it is an error message.

## Never a balance

Only historical **lists and reports** are fenced.

A list is a window onto rows: dropping the oldest page shortens the answer,
and the shopkeeper can see that it is shorter. A balance is the SUM of every
row there has ever been: dropping the oldest rows does not shorten it, it
**changes** it, and nothing on the screen looks any different. Stock on hand,
a customer's khata, a supplier's account — a two-year plan that quietly
forgot the opening balance would hand a shopkeeper a confident wrong number
and give them no reason to doubt it.

`ArchivedIsNotDeletedTest` exists for that one bug, because every natural way
to build the fence — a global scope on the model, a trait on the base query,
a middleware that rewrites `from` — gets it wrong. All three fence the ROWS
rather than the READ.

## Never a delete

Raise the plan and last year is back, the same minute, because nothing was
removed. That is what makes an upgrade worth buying and a downgrade
survivable.

## Where it lives

`App\Support\Retention`. One choke point per surface:
`SaleController::filtered`, `MoneyEntryFilters::apply`, `AuditLogController`,
`PurchaseOrderController`, `BusinessDayController` (index and deposits), and
`ReportService::resolvePeriod` — which all thirteen report endpoints go
through, so none of them has to remember.

`BusinessDayController::current()` is deliberately NOT fenced: the day being
traded is not history, and a shop whose window had somehow swallowed today
must still be able to see its own open till.
