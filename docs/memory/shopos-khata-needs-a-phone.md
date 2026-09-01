---
name: shopos-khata-needs-a-phone
description: FIXED — a customer could be given a Rs 50,000 credit limit with no phone, and the till finds a customer ONLY by phone; also: a scanner that could not see its own coverage
metadata:
  type: project
---

**The till identifies a customer by phone and by nothing else.**
`StoreSaleRequest` carries `customer_phone` and **no `customer_id`**; the group
discount, the loyalty balance and `Customer::capture` all look up by number.
Loyalty already said so out loud — *"Redeeming points needs a customer — add the
customer's phone."*

The CRM did not. `Phone` was a plain optional box sitting directly beside
`Credit limit (khata) — blank = no limit`. **Measured: a customer created with a
Rs 50,000 limit and no phone → 201.** Money that cannot be lent, repaid or
chased, and nothing says so until a cashier is at the counter with the customer
in front of them.

Now refused on the `phone` field. A customer with NO number is still fine —
shops keep directories of walk-in names — **the limit is what needs reaching
them**. On an edit the rule reads the record as it WILL be
([[shopos-edit-matrix]]), so raising an existing customer's limit is not refused
for a field nobody resent, and clearing the number of a customer who HAS a limit
is.

## The scanner could not see its own coverage

Found while re-running `untested-absence.py` to check the edit matrix's work. It
reported 13 routes as untested — **wrong**: the matrix dispatches through
`->{$verb.'Json'}($url)` and the scan looked for a literal verb beside a literal
path. Twelve of the thirteen were being posted to.

**That is worse than a miss** — the next person reads the list and writes the
tests a second time. Taught it the helper shape; 13 → 0. The general answer is
not a regex: record the routes the SUITE actually hits at runtime.

**How to apply:** after building a test helper that dispatches dynamically,
re-run whatever scanner counts coverage and check it can still SEE you.

Related: [[shopos-edit-matrix]], [[shopos-detector-vs-rule]],
[[shopos-measurement-that-lied]].
