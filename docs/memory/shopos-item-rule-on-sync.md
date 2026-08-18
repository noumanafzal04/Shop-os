---
name: shopos-item-rule-on-sync
description: "PosSyncController enforced 4 of OfflinePolicy's 5 rules — the ITEM one (medicine/serial) was never applied; backend ReachableTest found it"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-08-18T04:57:12.845Z
---

2026-08-18. The backend now has its own reachability rule,
`tests/Unit/ReachableTest.php` — the server half of [[shopos-reachability-rule]]
— and it found a real bug on its first run.

**The bug.** `OfflinePolicy` has five offline rules: four about the SALE
(tender, dine-in, redeemed points, coupon) and one about the ITEM (medicine, or
tracks_serial). `PosSyncController` called `violations($sale)`, which only ever
looked at sale-level fields. `refusalFor()` was written, tested, and called by
nothing — so a medicine synced from a till landed as a **clean** offline sale:
`offline_violations` null, nothing in Reports → Offline.

**Why it was the worst one to miss.** The till refuses all five at the counter,
but that refusal is a user interface — the outbox is a browser database on a
tablet that may have left the shop. The server's second layer had a hole exactly
the shape of the rule whose failures are a regulatory event (medicine out with
no batch recorded) and one handset sold twice (two tills, one IMEI).

**The fix's shape:** flag, never refuse (money crossed the counter); the reason
NAMES the item (a report read a week later ≠ a cashier holding the box);
deduplicated per product; catalog asked ONCE per request, pinned by a
query-counting test (per-sale loop reads 12 instead of 1).

**PHP-specific lesson for any future source-scanning rule:** the first version
stripped string literals along with comments and reported 19 findings, 14 noise
— **in Laravel a route names its method as a string**
(`[Controller::class, 'receive']`). Comments out, strings IN. Third instance of
*an audit that produces findings is a thing to verify, not to believe*.

**What the rule cannot see** (written into it, both found by mutation): private
methods, and methods whose name is a common word (`for`, `all`, `get`) which
self-exempt because own-file use is counted by name.

`Product::isLowStock` was exempted with a warning rather than deleted: it is a
PHP copy of a rule that lives in SQL in three controllers, and it is
**branch-blind** — `InventoryController` asks per branch, this asks the shop
total.

**Why:** the recurring shape here is "built, tested, unreachable"; this is the
first time the rule caught one instead of a person.

**How to apply:** run `php artisan test --filter=ReachableTest` as part of the
backend gate; when it flags something, decide between TEST_ONLY (introspection)
and NOT_SURFACED_YET (unshipped capability, each line naming what must be BUILT
to leave the list) — never a bare skip.
