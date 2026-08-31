---
name: shopos-outcome-not-coverage
description: STANDING — the supplier-payment bug was a COVERED branch with an unasserted consequence; assert outcomes, not paths
metadata:
  type: feedback
---

My first diagnosis of the Pay bug was "an untested branch": every payment test
sent `purchase_order_id`, so the screen's door (amount + method) was never
opened. I built `scripts/untested-absence.py` to find that class.

**It would not have found this one.** `CashMovementTest` had been posting a
payment with no order named **since August**. The branch was covered. That test
asserted the **drawer** and never looked at what the supplier was owed.

> The fault is not an unwalked path. It is a path somebody walked, looking at
> the wrong thing on the other side.

**How to apply:** when a bug slips a green suite, do not reach for coverage
first. Ask *what should have MOVED, and did any test read it?* Then write the
invariant, not the case:

- `ShapeMatrixTest` — succeed and move exactly what was asked, or refuse and
  move nothing. "Succeeded and moved nothing" is always a bug.
- `MoneyMatrixTest` — a money path that succeeds moves the balance it names.

Mutation-proven against the real historical state (BOTH halves reverted):
`supplier · paid on account: answered 201, balance moved 0, expected -5000`.

Related: [[shopos-pay-the-door-nobody-tested]], [[shopos-detector-vs-rule]],
[[shopos-saved-nothing]].
