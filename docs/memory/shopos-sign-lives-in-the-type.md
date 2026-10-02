---
name: shopos-sign-lives-in-the-type
description: STANDING — three ledgers in this codebase store a POSITIVE amount and keep the direction in a `type` column; summing the column agrees with a ledger that says the opposite
metadata:
  type: feedback
---

Made the same mistake twice in one day, on two different ledgers, and nearly
shipped the first one.

| Table | Column | Where the sign lives |
|---|---|---|
| `loyalty_entries` | `points` (always +) | `type`: earn / reverse_redeem add, redeem / reverse_earn subtract |
| `customer_ledger_entries` | `amount` (always +) | `type`: charge adds, payment subtracts |
| `stock_movements` | `quantity_change` | **signed** — this one really is summable |

Both audit checks "passed" against a ledger that said the opposite until the
seeded data happened to contain a redemption and a void. The khata one
reported Rs 37,480 still owed on a shop that owed nothing.

**Why:** a positive-amount ledger with the direction in a neighbouring column
reads as summable, and a sum always returns a number — so the check never
looks broken, it looks like a finding.

**How to apply:** before summing any ledger column in an audit or a report,
read the writer. If the writer passes a positive amount and a `type`, put the
sign back from the type. Then ask whether the check could have failed before
the data contained both directions.

A related member of the family: a check that reads only ONE side of a pair.
`aVoidedSaleNeverHappened` summed `reference_type = 'sale'` movements and
reported 55 units "still out" — the restore is written as
`sale_cancellation`, so the detector was blind to exactly the remedy it
existed to confirm.

See [[shopos-detector-vs-rule]], [[shopos-measurement-that-lied]],
[[shopos-withheader-is-sticky]], [[shopos-failed-check-is-not-a-verdict]].
