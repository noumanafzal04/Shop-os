---
name: shopos-cover-cannot-ring
description: a reliever covering a till could not press Tender — both selling gates asked `!!open`, which is null under cover BY DESIGN; fixed with ringableSessionId()
metadata:
  type: project
---

**Found and fixed 2026-08-18**, in the same line of code as
[[shopos-offline-shift-gap]].

Relief cover exists so a reliever **rings under the cashier's drawer**. `open` is
null under cover **by design** (a cover carries the shift id and none of the
figures the cashier is measured on — the X-read panel asks `!!open` for exactly
that reason). Both selling gates then asked the same `!!open`, so a reliever saw
*"Open a shift to sell."* with Tender greyed out — while `activeSessionId` and
the sale payload were already built to ring under the covered drawer.

**Two questions that look like one:**

| Question | Under cover | Right for |
|---|---|---|
| do I have a drawer of my own? (`!!open`) | no | reconcile — X-read, close, count |
| is there a drawer to ring into? (`ringableSessionId`) | yes | selling |

Also returns null for a **closed** drawer — matters now that a shift can be
restored from the device after a reload.

**The lesson:** `cover.test.ts` opens by saying the narrowing must not *"leave
them unable to ring at all"* — then tests only `isCover`/`isTraining`, which were
never wrong.

> **A test file that describes the failure and then checks something adjacent is
> the most convincing kind of missing test: it reads as covered.**

Same family as [[shopos-detector-vs-rule]]. Fix is a NAMED function, not a
corrected boolean — a rule buried in a 3,000-line component gets re-derived
wrongly next time.
