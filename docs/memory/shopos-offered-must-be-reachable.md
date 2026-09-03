---
name: shopos-offered-must-be-reachable
description: STANDING — the sidebar had a module-gate test; the dashboard and reports screen offer screens too and had none. 8 leaks. The guard's first version was blind.
metadata:
  type: feedback
---

**2026-09-03.** The user asked whether an un-assigned module could still show up
anywhere — *"reports tabs, settings, ya kisi b page py?"* — and it could, in
**eight** places. All the same shape: the P1 module split landed each key in the
registry, the route gate and the **sidebar**, and the sidebar was the only
surface with a test.

Leaks: Reports → Purchases (`inventory`→`purchasing`) · Reports → Bank claims
(sells→`bank_offers`) · Dashboard "Stock in" and "You owe"
(`tracksStock`→`purchasing`) · Settings → POS → Kitchen tab
(`dine_in`→`kitchen`) · `kotPrint` route (`feature:dine_in`→`feature:kitchen`) ·
Dashboard "Owed to you" (sells→`customers`) · Dashboard Day & banking
(permission only→`pos` too, where the card HEADER and its TILES read two
different things).

**Why:** a module a shop was never sold is invisible and fine. A **button that
bounces** reads as a broken product — see [[shopos-job-offered-must-be-doable]].

**How to apply:**
- New module key ⇒ check **four** surfaces, not three: registry, route gate,
  sidebar, **and every other thing that links** (dashboard tiles/actions,
  report tabs, settings tabs). [[shopos-guards-share-a-blind-spot]].
- The guard is `panel/src/test/offeredIsReachable.test.ts`. Its **first version
  was blind**: a hand-written table of "which capability guards which link"
  stayed green when the original bug was put back, because the table was what
  was being graded ([[shopos-detector-vs-rule]]). It now PARSES the
  `RequireFeature` nesting out of `App.tsx` and READS the links out of the DOM
  the panels render. Rewritten, it found 2 more leaks immediately.
- **Settle the matrix.** Generated module combinations must go through
  `settleFeatures()` (mirrors `Modules::normalize`) or the walk invents shops
  the server never stores — `purchasing` without `inventory` — and files the
  refusal as a bug. [[shopos-matrix-own-blind-spot]].
- **Never `setAttribute()` a non-column on a model.** It makes the model dirty
  and the next `save()` anywhere writes it. Doing this on `Sale` killed
  `DemoDataSeeder`'s warranty/loyalty blocks and went red on two
  `DemoWorldIsCompleteTest` cases — files the change never touched, while
  `--filter` on the new tests stayed green. Transient response data belongs on
  the ACTION (reset per `execute`) and is merged in by the controller.
