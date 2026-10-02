---
name: shopos-model-a-and-the-blend
description: 2026-10-02 two P0s found by seeding trades that had no fixture — a phone-call rider could never be settled, and a converted quote averaged its tax rates
metadata:
  type: project
---

Both found the same way: build the fixture the product says it supports, then
let the audit do arithmetic on it. Neither was findable by reading.

**1. The rider with no app could never be settled.** `delivered_at` had
exactly ONE writer in the codebase — `RiderService::deliver()`, the rider APP
endpoint — and two readers: `cash_in_hand` on the riders screen and
`settle()`. `OrderService::assignRider()`'s own docblock documents Model A
("no rider app — the shop drives the status"), which is how nearly every
Pakistani shop runs. Those shops completed every delivery from the panel, left
the column null, saw Rs 0 beside a rider holding the day's takings, and Settle
refused for ever. **Four existing tests of that money, four riders WITH the
app, zero of the shape most shops run** — and one of them asserted the bug and
called it "the honest limit of Model A" in a comment. Fixed in
`OrderService::complete()`: completing a DELIVERY stamps it, a pickup never
does, the rider app's own stamp still wins.

**2. A converted quote averaged its tax rates.** `CreateSaleAction` blends a
trusted caller's single settled `tax` across every line. Right for an ORDER
(one tax figure for the basket, no per-line rate to carry, and the catalog
rate would refund tax never collected). Wrong for a sale DOCUMENT, which
snapshots a rate per line: tea at 18% beside flour at 0% became an invoice
saying 7.08% on both. A later refund then gives tax back on a zero-rated
staple. Fix: `settled_tax_rate` on the line — a trusted line that arrives with
its own rate keeps it, the rest are blended.

**The shape both share** is [[shopos-promise-in-another-file]] turned inside
out: a rule stated in a docblock and implemented for only one of its callers.

**Also standing:** a swallowed refusal lies about what the server said. The
seeder's `priceIt()` catch-all reported 128 "could not price the fuel line"
when the real message was "there is no petrol in this shop" — third instance
this quarter. The probe now re-asks without the net so the real message
reaches the tally. See [[shopos-measurement-that-lied]].

The load-test world is now NINE shops: a filling station (two sites) and a
workshop joined the seven. `loadtest:audit` runs 229 checks and reports
`EMPTY: nothing` for the first time.

Related: [[shopos-rider-side]], [[shopos-orders-live-first]],
[[shopos-outcome-not-coverage]], [[shopos-failed-check-is-not-a-verdict]].
