---
name: shopos-half-the-sync
description: FIXED — the shift queue never got the sale queue's two fixes (force on press, stranded visible), so a till holding drawer events read "7 still to send" for ever
metadata:
  type: project
---

**2026-08-29.** A shop pressed Sync on a till reading "7 still to send" and the
number never moved.

**Checked the deploy FIRST, and it mattered.** `panel.cartze.shop` served
`PosPage-B5pWcY2v.js`, which contains `needs attention` — a string only in the
latest commit. The build was current, so the bug was real. It also ruled out
stranded *sales*: deployed code already labels those "stuck — needs attention",
and the shop was reading "still to send".

**The gap.** `pendingCount()` (the badge) = `owedCount()` (sales) +
`owedShiftOps()` (drawer events). Two stores, two flushes, ONE number. The sale
queue had learned two lessons; neither reached `shiftQueue.ts`:

- a press ignores the backoff → `dueRows(now, tenant, force)` vs **no force**
- a fenced row is visible → `strandedRows()` vs **nothing read them**

So a till holding drawer events was forced by nothing (`pullNow` called
`flushShifts` without the flag; backoff caps at 10 min), and had no reason
anywhere — `queueSummary.stranded` asked only the sale queue, while
`owedShiftOps` counts every pending row **regardless of tenant**. One orphaned
close: added to the badge, withheld from the flush, absent from the figure whose
job is to explain why nothing moves.

Third: `sent` came off `flushed.acked` alone, so a press that sent 4 shift
events said "0 sent" while `waiting` dropped by 4.

**Blind spot underneath:** `queueSummary.lastError` had been captured since it
was written and displayed by NOTHING. A bad line and a server refusing the rows
read identically. `syncDetail()` now shows it in the badge tooltip, and refuses
to say "try again" for the stranded case.

**Proof:** 5 mutations, 5 failures. Every stranded test has a denominator —
they all pass against a function that has started calling everything stuck.
1310 tests (was 1287).

**STANDING:** when a number on screen is the SUM OF TWO STORES, a fix to one
store is half a fix — and the missed half is a smaller true thing, so it never
looks broken. See [[shopos-half-a-rule]], [[shopos-stranded-sales]],
[[shopos-guards-share-a-blind-spot]].
