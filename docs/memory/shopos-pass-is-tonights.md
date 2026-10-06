---
name: shopos-pass-is-tonights
description: Kitchen board = this service only (ServiceDay: turns 05:00 shop time, last 6h never old); leftovers counted + cleared in one press as `cleared` (never `served`); floor payload + close-older
metadata:
  type: project
---

**2026-10-06, reported:** "bht old data b kitchen main show ho raha … close all on single click … DIN screen achi bnao".

**The rule (`App\Support\ServiceDay::began()`):** the pass, the dashboard and the floor all show THIS service. The day turns at 05:00 by the shop's clock AND nothing fired in the last 6 hours is ever "old" — the earlier of the two wins. Not midnight (a karahi house is cooking at 1 AM); the 6h rule keeps sehri whole.

**Leftovers are counted, not hidden:** `GET /restaurant/kitchen` → `older:{count, oldest_fired_at}`; `?older=1` lists them.

**Clearing:** `POST /restaurant/kitchen/clear {scope: older|board, station?}`. Status `cleared` (`KitchenTicket::CLEARED`) — NEVER `served`: clearing says "not kitchen work any more", not "the food went out". Lines' `kot_status` → `cleared` too. Scope is required (no scope = 422, not "everything"). Same permission as a bump. One AuditLog row, `event: cleared`. String columns → no migration.

**Floor:** `GET /restaurant/floor` = tables + takeaway tabs + per-tab `TabSummary` (to_pay, unsent, cooking, ready, part_paid, from_earlier). `POST /restaurant/floor/close-older` needs `tables.serve_any`, never touches a part-paid tab (returns `kept`), never tonight's.

**Bugs found on the way:** dashboard "Bills running" counted PAID counter orders; a voided/cleared docket could be bumped back (`LIFECYCLE[$x] ?? 0`); a counter order waited on "everything served" which a cleared docket never is.

**How to apply:** anything new that asks "what does the kitchen owe / what is open on the floor" uses `KitchenTicket::stillOwed()->inService(ServiceDay::began())`, not its own date maths. Decision doc: `docs/decisions/shopos-the-pass-is-tonights.md`.

Related: [[shopos-docket-outlived-tab]], [[shopos-counter-order-kitchen]], [[shopos-line-changes-until-sent]], [[shopos-work-screen-rail]]
