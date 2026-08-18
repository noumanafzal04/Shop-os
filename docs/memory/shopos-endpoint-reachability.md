---
name: shopos-endpoint-reachability
description: "dead-endpoints.py (294 routes vs panel+mobile) found DELETE /customer/reviews unreachable; guard tests can't parse ternary labels"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-18T05:17:40.280Z
---

2026-08-18. Reachability one level up from [[shopos-item-rule-on-sync]]: **does
any client call this endpoint.** `shopos-backend/scripts/dead-endpoints.py`
reads `php artisan route:list` plus every file in the panel and mobile app.

**A script, not a test, on purpose** — it needs two sibling repos, and a test
that fails on a missing directory gets switched off within a week.

**The finding:** `DELETE /customer/reviews/{id}` — written, tested, correctly
scoped, called by nothing. A customer could post a review and never take it
back (only overwrite it, since `store()` is an upsert).

**The better half — why it was never wired:** the public review list carries
`customer_name` and nothing else, so no screen could tell which review was
yours. **The capability was unreachable because the data needed to reach it did
not travel.** Worth remembering as a distinct sub-shape.

**Design call:** `is_mine` on the public payload was REJECTED — that response is
identical for every visitor and cacheable, and a body that varies with whoever
holds the token is how one shopper's view gets served to another. Built
`GET /customer/reviews` in the authenticated customer group instead.

**Two bugs in the audit itself:** it missed paths built from a variable
(``apiGet(`${basePath}/presets`)``); and its retry required a static tail ≥ 8
chars — `presets` is 7, so `staff/presets` was reported dead while
`useJobPresets` was calling it. Import paths also read like API paths
(`from "../staff/permissions"`).

**The bigger lesson — a guard test that cannot parse its own subject:**
`destructive.test.ts` flagged the new Remove button. The RULE was right, the
PARSER was not: its word list is anchored (`/^(Remove|Delete|…)/`) and a button
with a pending state labels itself `{busy ? "Removing…" : "Remove review"}`.
Every destructive button with a spinner was invisible to it, in both directions.
Fixing the parser immediately found two real ones the Aug-17 sweep
([[shopos-ui-sweep-aug17]]) had missed: Products and Categories delete
confirmations rendered the BRAND colour — the button that deletes a product was
the same button as Save.

**Why:** counts of findings mean nothing without knowing what the tool could
see; both audits this session lied on their first run.

**How to apply:** run `python3 scripts/dead-endpoints.py` after adding
endpoints; check every finding by hand and treat a clean result as "short enough
to read", not proof. When a guard test flags your new code, first ask whether it
can actually READ your code before assuming your code is wrong.

**2026-08-18 (later):** the script now asks **three** questions, not one — a route
no client calls, **a call no route serves** (a 404 in a customer's hand, invisible
to `tsc` because clients hand-write their own API types), and **a call with the
wrong verb** (a 405 = "the button does nothing"). 359 call sites, all agree, 4
unresolvable and printed rather than dropped. Both new halves mutation-proved
with planted probes.

**HANDOVER's long-standing warning that the mobile contracts had "moved under
them" (`item_types`, `other_income`, `logo_url`) was NOT TRUE** and had not been
for some time — mobile `tsc` clean, 31 tests pass, `Tenant` matches
`TenantResource`, `other_income` absent from mobile entirely. The customer app is
behind on FEATURES, not out of contract. A stale caution sends the next person
hunting a defect that does not exist. See [[shopos-docs-discipline]].
