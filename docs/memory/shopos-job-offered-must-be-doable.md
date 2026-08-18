---
name: shopos-job-offered-must-be-doable
description: FIXED — a restaurant was offered a Purchasing job whose every screen is MODULE_DISABLED; buyer preset was gated inventory-OR-products
metadata:
  type: project
---

`buyer` ("Purchasing") was offered on `inventory` **or** `products`. A restaurant
keeps a menu and holds no stock, so it was shown the job — but suppliers,
purchase orders and payables all ride `feature:inventory`. Hire someone into it
and they can open nothing. Fixed to `'modules' => ['inventory']`;
`stock_keeper` correctly keeps both (keeping a menu straight is real work).

**Why:** three separate blindnesses stacked.

1. **A phase chose its own shops.** Phase I ran 4 of 8 trades on an expired
   reason ("7 logins vs a 5/min limit" — the token cache killed that cost).
   Preset lists are built PER TRADE, so a salon's and a workshop's had never
   been looked at. Same fault in K/M/N: a hardcoded trade list beside a
   `features` check that already knew the answer.
2. **Two refusals wearing one number.** The widened run reported 11 bugs, all
   false: the check read any 403 as "the preset didn't grant the permission",
   but the shop's own OWNER gets the same 403 — `MODULE_DISABLED` says nothing
   about permissions. Chasing the false accusation instead of silencing it is
   what produced the real rule.
3. **The rule had to name the right routes.** "All reachable routes off" found
   nothing — `buyer` still opens `/products` because `PRODUCTS_MANAGE` rides
   along. It had to be the routes the job's DESCRIPTION names (`core`).

**How to apply:** never let a test/sweep hold its own copy of a fact the product
publishes (`features`, `item_types`). Gate on the module, always. And when a
guard accuses something, check whether the SUBJECT would fail the same way —
if the owner gets the same 403, the finding is about the shop, not the person.

Sweep now prints a per-phase coverage denominator (which shops each phase
actually spoke about vs. which have its module), because phase M had silently
skipped every salon's loyalty for the sweep's whole life while printing green.

Related: [[shopos-read-vs-manage]], [[shopos-detector-vs-rule]], [[shopos-qa-sweep]], [[shopos-no-roles]]
