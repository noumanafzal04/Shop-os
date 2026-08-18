---
name: shopos-sync-progress-pill
description: the till pill now says "Sending X of Y"; pillLabel had TWO drifted copies while it sat on NOT_SURFACED_YET; isPulling stays exempt because the pill reports money
metadata:
  type: project
---

**Shipped 2026-08-18.** The offline pill jumped from `47 still to send` straight
to `Online` with a silent gap — the one moment a shopkeeper most wants narrating
(the line came back, the day's takings are going up).

**The lesson worth keeping:** `pillLabel` says of itself *"One place, because the
wording is the feature"* and was on `reachable.test.ts`'s `NOT_SURFACED_YET`.
While it sat there, POS grew its **own inline copy** of the same four states, and
the two drifted — the export knew `Sending X of Y`, the POS copy knew `No server`,
neither knew both. **An entry on that exemption list is not free.** See
[[shopos-reachability-rule]].

`No server` ≠ `Offline`: "wait for the line" vs "telephone somebody". Selling
carries on either way, so the words are the only thing that distinguishes them.

Three design rules inside the progress (`flush.ts` → `FlushProgress`):
- **denominator freezes at round 0** — a sale rung mid-flush must not extend the
  total, or the bar walks backwards while the cashier watches it
- **count answered rows (`acked + failed`), not wired rows (`sent`)** — a round
  that all came back retryable moved nothing
- **cleared in `finally`** — a flush that throws must not freeze `Sending 12 of 47`
  for the shift; that is a worse lie than silence. And `total > 0` gates it, so
  the 15-minute catalog timer never says `Sending 0 of 0`.

`isPulling` deliberately stayed exempt with a NEW reason: **the pill reports the
outbox, which is money**; a catalog pull is housekeeping and must not make the one
indicator a cashier decides by flicker. It leaves the list when a manual
**Sync now** exists.

Full reasoning: `docs/decisions/shopos-sync-progress-pill.md`.

**2026-08-18 (later): the pill IS the Sync now button.** `isPulling` left
`NOT_SURFACED_YET` — but by RECLASSIFICATION, not by being surfaced. The helper
written to use it (`syncRunning`) was **deleted rather than shipped**: it read a
module variable React does not subscribe to, so it would have reported a stale
answer for ever. `isPulling` is now in `TEST_ONLY`, where it honestly belongs —
it exposes the single-flight slot so a test can prove the slot CLEARS on a
failed pull (without which one network blip wedges the till for ever).

> **An entry leaving NOT_SURFACED_YET is not automatically progress.** What it
> waited for was named, was built, and the honest answer was that it still had
> no correct caller.

A press gets its own state (`Sync now → Syncing… → Up to date`) because the
automatic sync is deliberately silent on an empty queue — and the two failures
are worded apart: "Sync failed" is to report, "Still no connection" is to wait
for. Never "Synced!" — overclaiming is how a cashier stops believing the next
message.

