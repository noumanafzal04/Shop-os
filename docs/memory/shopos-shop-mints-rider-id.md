---
name: shopos-shop-mints-rider-id
description: shop mints RDR- id when adding a rider; rider claims it; vouched_by_tenant_id keeps a shop's word out of the platform pool
metadata:
  type: project
---

**2026-09-15 SHIPPED** — backend `fa9ba89`, panel `61626ca`, mobile `caf3bb1`.

**Direction reversed.** A shop adding a rider is handed `RDR-000123` there and
then; the rider CLAIMS it (`POST /rider/claim`). Before, the rider had to
install/sign up/apply/send CNIC/be approved/read the code out first — five steps
belonging to somebody who is not the shop.

**Schema:** `rider_profiles.user_id` nullable (an unclaimed id has nobody behind
it). Unique index kept — many NULLs are allowed. Used `change()`, NOT a
mysql-only ALTER: Laravel 11+ does this natively on SQLite too, and the
conditional would have left it NOT NULL in every test.

**The security rule, and the reason for `vouched_by_tenant_id`:** a shop-minted
rider is `approved` so they can carry THAT shop's orders. `setPlatform()` asked
only `canRide()` — so any shop could have minted an id for anybody and that
person could enter the CartZe pool with no CNIC. An approval with a shop's name
and no `approved_by` is **a shop's word**: good for that shop only.
- Only JOINING is fenced; leaving the pool always works.
- The fence had to be a DOOR: `apply()` refused every approved profile, which
  would have dead-ended a vouched rider. Now refuses only platform-approved.

**`has_app` now means CLAIMED**, not "a profile row exists". A shop whose riders
never claim reads exactly as before (no live pin, no OTP, panel drives status).

**Three tests broke and all three were right to be examined**, not patched:
- a guard pinned to `===` rather than to what it guards — see
  [[shopos-mutation-aimed-at-wrong-rule]]
- an assertion carrying a PREDICTION ("and always will be") that expired
- `has_app` meaning drift

**The trap avoided:** the board offered "Take CartZe deliveries" to a rider the
server would 403 → `can_join_pool` from the server; button becomes "Apply".
Same shape as [[shopos-job-offered-must-be-doable]].

Related: [[shopos-rider-side]] · [[shopos-commission-and-push]] ·
[[shopos-mobile-is-customer-and-rider]] · [[shopos-context-was-assumed]]
