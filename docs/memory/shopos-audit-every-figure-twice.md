---
name: shopos-audit-every-figure-twice
description: STANDING — loadtest:audit recomputes every stated figure from raw rows by a different route, and names which tables were empty
metadata:
  type: feedback
---

`php artisan loadtest:audit [--shop=grocery]` (read-only), after
`loadtest:shops`. 84 checks across seven shops.

**Why:** volume proves the screens survive volume. Both faults that have cost a
shopkeeper money were ARITHMETIC, and no catalogue size would have caught
either. So every figure the product states is recomputed from the raw rows by a
DIFFERENT route.

**The denominator is part of the output.** It prints the row count of every
table it touched and names the empty ones. A check against an empty table
passes, and a page of passes means nothing until you know how many had a
subject — that list is how the whole gap was found (customers, khata, returns,
counts, transfers, write-offs, coupons, points: all zero across seven shops
while their screens were green).

**Both of the audit's own first findings were the audit's fault**, and that is
the habit to keep:
- it read `['stats']['payable']`; the key is `['money_owed']['payable']`. A
  missing key is null → 0.0 → a confident fictional zero. It asserts the key
  exists before comparing now.
- it summed points off SALES filtered to `completed`. A refund appends
  `reverse_earn` to `loyalty_entries` and leaves `sales.points_earned` alone,
  correctly. The balance lives in the ledger.

Same for the seeder: **count every refusal BY REASON**. Four refusal lines in
one run each looked like a product bug and were all the seeder's
(`amount_paid` is the TENDER not cash handed over; coupons at a shop with no
promotions module; a service in a van; 82 karahis with no spice level — which
meant no sale anywhere had EVER carried a modifier). A fifth was the query log
exhausting memory mid-run and leaving an audit crying "450 of 450 shelves
adrift".

Related: [[shopos-one-answer-what-i-owe]], [[shopos-outcome-not-coverage]], [[shopos-failed-check-is-not-a-verdict]]
