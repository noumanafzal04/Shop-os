---
name: shopos-qa-sweep
description: standing QA sweep (docs/qa/sweep) drives the whole product from outside per business type; mutate.py proves it can fail; 11 harness findings vs 0 product bugs
metadata:
  type: project
---

`docs/qa/sweep/` is a standing sweep, not a test suite: it creates a tenant per
business type through the admin console, logs in as the owner, and sells things.
`python3 run.py` runs every phase; `python3 mutate.py` proves the sweep can still
fail. **Thirteen phases (A–M), 891 checks green in one run, 15 of 15 mutations
caught.** A–H = does the shop work;
I = who is at the counter and which lane; J = the Expense Manager's wire to the
drawer; K = more than one branch; L = the floor (tabs, the pass, split bills,
whose table); M = points, coupons, promotions.

Three report levels — `BUG`, `QUERY` (behaviour that surprised the sweep; about
half turn out to be correct behaviour nobody wrote down), and `HARNESS` (the
sweep itself being wrong). **Running total: 37 harness findings, 2 product bugs**, and every one of the
thirty-seven looked like a defect on first read. Both real defects were the same
shape — one question, two paths, two different answers, no error anywhere:
[[shopos-forecourt-branch]] and [[shopos-adjust-wrong-branch]].

**Why:** `php artisan test` cannot answer "does a pharmacy created this morning
have a shelf, a till and a way to refund a customer" — every fixture in it was
built by the same hands that built the feature.

**How to apply:** when a sweep run reports something, verify before believing —
the base rate says it is the harness. Rate limits (`throttle:auth` 5/min per IP,
`throttle:api` 240/min per user) are the product working; the sweep caches
tokens and waits out a 429 rather than asking for looser limits. `mutate.py`
itself once printed "THE CHECK IS BLIND" about checks that had never run because
the phase died on a 429 — it now needs a `ran_marker` per mutation and has a
third verdict, `UNCLEAR`. See [[shopos-detector-vs-rule]], [[shopos-workflow-test-rule]].

The worst harness bug so far: a permission probe **ran as the wrong identity** —
a staff sign-in throttled to None fell back to the ambient token, got a 401, and
the check read it as the 403 it wanted. A refusal that proves nothing, printed
as a pass. There is now a `NOBODY` sentinel and a 401 in a permission probe is
reported, never counted.

Also settled: plan limits are real (staff 5, registers 2, branches 1) and a
ceiling cannot be set below current usage (`LIMIT_BELOW_USAGE`); the sweep
raises them but checks they bite first. And `products.stock_quantity` is the
across-branches ROLLUP — the shelf you sell from is the branch figure, while the
moving cost is weighted by the rollup. Two different numbers, both called stock.

Settled here: `GET /shop/business-type` 404 is correct (units and variant
attributes ride the public `/business-types` catalog, matched on
`business_type_primary` — the catalog hides legacy codes, so the raw code finds
nothing). And `business_category` really does have its one behavioural use:
food + `restaurant` grants the inventory module, food alone does not.

**2026-08-19 — 927 → 1303 checks, 17 → 18 mutations.** Phases K/M/N/I stopped
picking trades from a hardcoded list and now gate on the module. `summary()`
prints a per-phase coverage denominator (shops spoken about vs shops with the
module), because phase M had been silently skipping every salon. Running total:
**45 harness findings, 3 product bugs.** See [[shopos-job-offered-must-be-doable]].
