# Half the sync obeyed the button

**2026-08-29.** A shop on `panel.cartze.shop` pressed Sync on a till reading
"7 still to send", and the number never moved.

## What I checked before believing it

The deployed bundle, first — the previous fix was pushed but I had never
confirmed it was live. `panel.cartze.shop` serves `PosPage-B5pWcY2v.js`, and
that file contains `needs attention` and `open the queue`, strings that exist
only in the latest commit. **The build was current.** The bug was real.

That also ruled out a whole branch of causes: the deployed code already reports
a stranded SALE as "N stuck — needs attention". The shop was reading "still to
send", so the seven were not stranded sales.

## The gap

`pendingCount()` — the badge — is `owedCount()` (sales) **plus**
`owedShiftOps()` (drawer events). Two stores, two flushes, one number.

The sale queue had learned two lessons. Neither reached the shift queue:

| | `outbox.ts` | `shiftQueue.ts` |
|---|---|---|
| a press ignores the backoff | `dueRows(now, tenant, force)` | **no force at all** |
| a fenced row is visible | `strandedRows()` | **nothing read them** |

So a till holding drawer events was forced by nothing (`pullNow` called
`flushShifts` without the flag; the backoff caps at ten minutes), and had no
reason available anywhere — `queueSummary.stranded` asked only the sale queue,
while `owedShiftOps` counts every pending row *regardless of tenant*. One
orphaned close was therefore added to the badge, withheld from the flush, and
absent from the one figure whose entire job is to explain why nothing moves.

A third, smaller: `sent` came off `flushed.acked` alone, so a press that
successfully sent four shift events reported "0 sent" while `waiting` dropped by
four — one sentence on one bar disagreeing with itself while the sync worked.

## The blind spot underneath

`queueSummary` has captured `lastError` since it was written and **nothing ever
displayed it**. That left the two cases a shopkeeper most needs to tell apart
looking identical: a queue held up by a bad line, and a queue the server is
refusing. Both read "7 still to send"; both survive any number of presses; only
one is worth waiting out. `syncDetail()` now puts the reason in the badge's
tooltip — and deliberately refuses to say "try again" for the stranded case,
pointing at the Settings screen that can actually release them.

## Proof

Five mutations, five failures — remove the force, blind the stranded reader,
drop shift ops from the count, report only the sale queue's acks, stop forcing
in `pullNow`. Each named the test that catches it.

Every new stranded test carries a denominator (`leaves a healthy queue alone`,
`still says 'still to send' for the ordinary bad line`), because all of them pass
against a function that has simply started calling everything stuck.

1310 unit tests (was 1287), 0 lint errors, build clean.

## The standing lesson

This is [Half A Rule](shopos-half-a-rule.md) again, and the second time the same
pair of fixes has had to be written twice. **When a number on screen is the sum
of two stores, a fix to one store is half a fix** — and the missed half is a
smaller true thing, so it never looks broken.

Related: [Stranded Sales](shopos-stranded-sales.md),
[Guards Share A Blind Spot](shopos-guards-share-a-blind-spot.md).
