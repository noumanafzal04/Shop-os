---
name: shopos-park-it-here
description: "FIXED: offline hold/recall was fully built and unreachable — three !connected fences on PosPage, each propping up the next"
metadata:
  type: feedback
---

2026-09-03. C20 was written down as "the last offline coding task, a design
question rather than an oversight". **Both halves were wrong.**
`src/modules/pos/heldLocal.ts` had shipped 18 Aug — park/list/claim/remove,
tenant-fenced, 12h expiry, 7 tests — and `usePos` was fully wired for it.

`PosPage` refused it in **three** places (added 21 Aug): Hold, Resume, and the
list itself. Each was defensible **beside the other two** — nothing could be
parked, so the list was empty, so showing it was pointless, so nothing could be
parked. The commit that added them was a genuine fix for a genuine lie ("No held
sales" over ten parked tickets); it replaced a lie with a refusal, and the
refusal was the newer mistake.

Two documents agreed with the screen: `shopos-offline-shift-gap.md` said "not
implemented — `/pos/held` is server-only, no local store", and the ledger said
"a design question".

**Why:** a refusal is a CLAIM ABOUT THE CODE and goes stale like any other. It
reads as a decision, so nobody re-checks it.

**How to apply:**
- **Before writing a refusal, grep for the thing being refused.** Third time in
  this repo: see [[shopos-offline-browse]], [[shopos-sold-out-and-reachability]],
  [[shopos-offline-shift-gap]].
- **Count the fences.** One `!connected` is a decision; three that justify each
  other are a loop nobody can see from inside any one of them.
- The design rule that survived: offline hold makes the **smaller promise** —
  parked on this till, resumed on this till. Nobody else can see it, so nobody
  else can take it, and the two-lanes rule holds by construction with no lock.
  The till says so **three times** (before, after, and on the row).
- Local tickets are **never pushed up**: a held ticket is intent, not money, and
  a queue flushing after the line returns hands the shop baskets already rung.
- Only `context.setOffline(true)` can prove any of this — jsdom reports
  `navigator.onLine === true` no matter what. See [[shopos-screen-testing]],
  [[shopos-offline-in-a-browser]].
