---
name: shopos-which-day-is-open
description: FIXED — money banked today landed on yesterday's still-open day; three code paths answered "which day is open?" three ways
metadata:
  type: project
---

`BusinessDayController::storeDeposit` resolved the open day with **no ordering
at all**, while the screen (`current`) used `latest('trading_date')` and
`CloseBusinessDayAction::open` keyed on branch + today's date. With one open day
nobody could tell; with two — the ordinary state of a shop that shut late —
the deposit took the OLDER one. Today's banking column never moved, and
yesterday's day closed carrying money that was never in it.

Fixed with one resolver: `BusinessDay::openFor(?string $branchId)`, used by both.

**Why:** two lessons worth keeping.

1. **The first regression test PASSED against the bug.** An unordered
   `->value('id')` returns rows in insertion order, and the test built today's
   day first, so the broken query found the right row by luck. It only goes red
   once the rows are built in the order reality builds them — yesterday's day
   exists first, because yesterday came first.
2. **Closing a day is irreversible** (branch + date, no re-open path). The QA
   sweep's phase P shut the real trading day on all 8 shops and blocked every
   other phase for the rest of the afternoon. It now trades on its own branch
   (`Sweep Day N`) and takes the next one when today's is spent; `ROOM` raised
   to 12 branches. And the destructive check must not gate the harmless one —
   banking ran after the branch, so when the branch ceiling bit the check that
   found the bug stopped running silently.

**How to apply:** when the same question is asked in more than one place, make
it one function. And before believing a regression test, break the code and
watch it go red — build fixtures in the order reality would.

Related: [[shopos-detector-vs-rule]], [[shopos-qa-sweep]], [[shopos-adjust-wrong-branch]]
