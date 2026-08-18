---
name: shopos-offline-shift-gap
description: a till that RELOADED while offline could not sell — shift lived only in a query cache; FIXED via shiftMirror (only status 0 falls back); shift open/close offline still owed
metadata:
  type: project
---

**Found 2026-08-18. Severe half FIXED same day (`offline/shift/shiftMirror.ts`); the rest still owed.**

`PosPage` disables Tender/Pay on `!open`. `open` comes from `useCurrentSession()`
— a plain `useQuery`, **no query persistence anywhere in the app**, and the
service worker runtime-caches only product images. The shift lives in memory and
nowhere else.

- Outage mid-shift, page stays mounted → **sells** (query keeps last data). This
  is the case that was tested.
- **Page reloads while offline** → `open` null → *"Open a shift to sell."* The
  whole offline module is unreachable.
- Outage at opening time → no shift can be opened at all.
- Shift ends offline → no drawer close, no cash count, no Z-read.

A tablet sleeping, a PWA relaunch, or **a power cut** all reload the page — and
the power cut is the example the **Help Centre gives by name**. Same
"documented as working" shape as [[shopos-slip-number-lookup]].

`STORE.SHIFT` is created, listed in `DURABLE_STORES`, and has an upgrade test —
**and nothing writes to or reads it.** The offline plan says
*"Open / close a shift, count the drawer ✅"* and *"`shift` | local shift +
drawer movements | push"*.

**Why the guards missed it:** `reachable.test.ts` catches an *export* whose only
caller is its test. `STORE.SHIFT` is an object key that is referenced constantly.
**The guards find unreachable code, not unbuilt design** — see
[[shopos-detector-vs-rule]].

Also unimplemented while claimed ✅: **hold/recall offline** (`/pos/held` is
server-only, no local store, no refusal message). `cartStorage.ts` parks the OPEN
cart in localStorage — that is the cart, not the shift and not a held ticket.

Denominator: 9 ✅ claims checked → 6 hold, 2 false dangerously, 1 false safely
(plan allows unlimited-use coupons offline; `canSellOffline` refuses all coupons).

Fix outline + full reasoning: `docs/decisions/shopos-offline-shift-gap.md`.

**The fix, and the three rules that keep it safe** (all mutation-proved):
- **only silence falls back** — `ApiError.status === 0`; a **401 must NOT** hand a
  drawer to a signed-out till, a **500** is a broken server not a dead line
- **a closed shift is cleared**, not remembered — a counted drawer is not a shift
- **tenant-fenced BOTH ways** — shop B isn't offered shop A's drawer, and
  mirroring for B must not DELETE A's row (a test caught that one)
- a **cover is never mirrored** — only the server starts/ends one

**Still owed:** queued shift open/close/movements + sync endpoint, opening a
shift with NO server (client-minted id, same collision problem `OFF-…` solves),
offline hold/recall, Z-read stays provisional.

Sibling bug found in the same line of code: [[shopos-cover-cannot-ring]].
