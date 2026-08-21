---
name: shopos-three-verdicts-paid-off
description: the re-run verification lane with CONFIRMED/REFUTED/COULD_NOT_CHECK returned 11 confirmed and 2 refuted — and both refutations were of my own claims; do not re-raise them
metadata:
  type: project
---

Yesterday's lane lost 23 of 25 agents and reported all 22 unverified claims as
**refuted**, because a dead agent returns `null` and `!verdict?.real` is true for
null ([[shopos-failed-check-is-not-a-verdict]]).

Re-run with three agents told explicitly to answer CONFIRMED / REFUTED /
**COULD_NOT_CHECK**, and that absence of evidence is the third. Result: **11
confirmed, 2 refuted — and both refutations were of my own claims.**

**DO NOT RE-RAISE:**

- **"Announcement re-send has no dedupe."** Wrong on three layers: a per-recipient
  dedupe key, `unique(user_id, dedupe_key)` on `app_notifications`, a
  `QueryException` catch for the race — plus a passing `test_resend_is_idempotent`.
  `recipients_count` only increments where `notify()` returned non-null.
- **"There is no workshop job preset."** The label is missing; the consequence is
  not. The whole workshop surface sits behind `sales.manage`, which the `cashier`
  preset carries, and `StaffPresets::for()` offers it to any automotive tenant
  with POS. Real residual: `PresetCanDoItsJobTest` has no bay-board case.

**Why:** both were plausible and both were mine. One round of adversarial reading
killed them for the price of not spending a day each — which is the argument for
the lane, and why a lane that cannot tell "refuted" from "not checked" is worse
than no lane.

**How to apply:** ask agents to REFUTE, require three verdicts, and never treat a
null/missing verdict as a negative one.

Related: [[shopos-failed-check-is-not-a-verdict]], [[shopos-asked-as-nobody]].
