---
name: shopos-rider-pool-had-no-switch
description: "is_platform defaulted false with no way to set it after approval — riders got no orders; the board now names one of six reasons"
metadata:
  type: project
---

`rider_profiles.is_platform` defaults to **FALSE** and was writable in exactly
one place: the apply payload. `apply()` refuses an approved profile ("You are
already an approved rider") and the admin review screen only SERIALISES the
field. So a rider whose application went through without the flag was invisible
to the pool for ever — `availableNear()` and `openOffers()` both require it —
with no control anywhere and nothing on any screen naming it.

**Why:** reported as "Rider side no order coming, koi rider assign ni ho raha".
`PUT /rider/pool` (`RiderService::setPlatform`) is the exit; the rider board's
empty state offers it.

**How to apply:**
- `RiderService::offerBlock()` names ONE of six reasons the board is empty —
  not approved / offline / at limit / not in pool / no position / stale (5 min)
  — and returns **null** when nothing is wrong. All six used to draw "No
  deliveries near you". The app supplies the heading, the server the sentence:
  only the server can see the pool flag, the heartbeat and the position age.
- Leaving the pool never touches work in hand: the pool decides what is
  OFFERED.
- The duty switch must NOT await a high-accuracy fix — indoors that is 12s +
  8s with the row still reading "You are offline". One quick attempt
  (`retry: false`), then online; the heartbeat corrects the pin.
- The offer trigger is the shop moving the order to **confirmed**
  (`/orders/{id}/advance`), delivery, no rider, shop's `delivery_provider` =
  platform. No confirm, no offer.

See [[shopos-rider-side]], [[shopos-who-carries-it]],
[[shopos-offered-must-be-reachable]], [[shopos-approximate-is-allow]].
