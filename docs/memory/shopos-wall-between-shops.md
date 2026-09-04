---
name: shopos-wall-between-shops
description: CRITICAL FIXED — route-model binding ran before ResolveTenant, so any shop's row bound by id; one shop could read/rename/delete another's dining tables
metadata:
  type: project
---

2026-09-05. `GET /restaurant/tables/{another shop's id}` → **200**. And
`update`/`destroy` are bound the same way, so a shop could have **renamed or
deleted the tables in somebody else's restaurant.**

**Cause:** `BelongsToTenant`'s global scope only applies when a tenant CONTEXT
EXISTS. Laravel's `SubstituteBindings` is in the `api` group and ran **before**
`ResolveTenant`, so `show(DiningTable $table)` bound its model with no context —
scope became a no-op — and any tenant's row resolved.

**Why it hid:** most controllers do their own lookup, `show(string $id)` then
`Model::query()->findOrFail($id)`, which runs INSIDE the stack after the tenant
is known and 404s correctly. **Two styles in one folder and only one was safe**
— 21 methods across 16 controllers take a bound model, and the safe majority
made the surface look tested.

**Fix:** one line —
`$middleware->prependToPriorityList(SubstituteBindings::class, ResolveTenant::class)`.
Mutation: remove it and read/rename/delete of another shop's table all return
200. `TenantWallTest` also asserts the OWNER still gets 200 — a wall that
refuses everybody is a broken feature.

**The testing lesson, which is the bigger half:** phase F had asked this
question for months — **5 times, 1 shop pair, 5 record kinds**, out of 46
addressable kinds across 36 possible pairs. A sample that small passes over
almost any hole. `phase_v` asks it **227 times, 147 pairs, 8 shops**, and needs
no payload knowledge: it reads each list AS ITS OWNER, takes the first id, and
carries it next door.

**Two questions per record** — can they read it by id, and *does it appear in
their own list*. The second is what shops actually picture.

**And phase V's own first mistake:** it took "the next shop" as intruder, so 11
pairs answered 403 from the intruder's `feature:` gate — **questions never
asked, printing as refusals**. The neighbour is chosen now: the next shop that
HAS the module. Where none exists (only petroleum has `fuel`) the pair is named
as unasked, not counted as a pass.

Related: [[shopos-offered-must-be-reachable]] · [[shopos-detector-vs-rule]] ·
[[shopos-matrix-own-blind-spot]] · [[shopos-outcome-not-coverage]]
