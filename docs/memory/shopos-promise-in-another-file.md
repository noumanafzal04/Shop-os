---
name: shopos-promise-in-another-file
description: FIXED x4 — a comment or label stating a requirement whose implementation lives elsewhere and never happened; stock.expiry link, "mutually exclusive buckets", job-card expiry, deposits_held
metadata:
  type: feedback
---

Four of one day's defects were the same shape: **a promise made in one file and
kept in none.**

- `NotifyExpiringStock`'s docblock: the expired alert *"Links to Disposals"*.
  `DeepLinks` tested `$type === 'stock.low'` for exact equality, so both
  `stock.expiry.*` types fell to `default => null`. Third comment-as-requirement
  this month.
- `BillingController`: `// Mutually exclusive buckets (no double counting):` over
  four counts that were not. A suspended shop with a live date was in two;
  a null end date was in none. Two errors partly cancelling, so the dashboard
  stayed plausible. `Tenant::scopePaymentStatus` had it right all along.
- `DeleteTenantAction`: "reports, invoices and history survive for auditing".
  They survived anonymously — the `belongsTo` carried the soft-delete scope, so
  every payment a closed shop ever made rendered with a blank name.
- `deposits_held`'s comment described "the customers' money it is holding" while
  summing layaways only; `RecordDepositAction` admits job cards too.

**Why:** a comment reads as DONE. That makes it worse than nothing written down —
the next reader takes it as a description of the code beneath it and doesn't
check. Same for a UI label ([[shopos-everyone-minus-one-role]]).

**How to apply:** when a comment, docblock or label states a rule, grep for the
rule. If it lives in another file, that is a DEPENDENCY, and an unchecked
dependency is a hope. Prefer a test that enumerates producers over one that names
a few examples — the old deep-link test named four types and passed, because it
did not know the two expiry types existed.

Related: [[shopos-detector-vs-rule]], [[shopos-sold-out-three-paths]],
[[shopos-ceiling-follows-the-bill]], [[shopos-other-half-of-a-date]].
