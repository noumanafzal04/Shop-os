---
name: shopos-default-flip-does-not-reach
description: "STANDING: flipping a ShopSettings default changes nothing for any shop that ever pressed Save — the merged value was stored"
metadata:
  type: feedback
---

`ShopSettingsPage` READS `allSettings()` (defaults merged with overrides) and
SAVES the whole object back. So the first time a shop presses Save, every
DEFAULT becomes a stored override. Flipping a default later reaches only shops
that have never saved.

**Why:** `delivery_provider` was flipped to `platform`, and a live food shop
still carried `self` — so no CartZe rider was ever offered its orders and the
report came from the other end: "rider side no order coming". Days lost, with
three other real bugs found on the way and none of them the cause.

**How to apply:**
- Changing a default is NOT a data change. Ask: which shops already have the
  old value stored? A blanket migration is usually wrong (it would override a
  shop that genuinely chose `self`), so make the consequence VISIBLE instead —
  the panel now warns beside the control, and the Help Centre says to check it
  once even if you never changed it.
- Read-only check for live:
  `SELECT business_name, JSON_EXTRACT(settings,'$.delivery_provider') FROM tenants WHERE JSON_EXTRACT(settings,'$.delivery_provider') = 'self';`
- The same trap applies to every key in `ShopSettings::defaults()`.

See [[shopos-who-carries-it]], [[shopos-an-absent-field-is-a-branch]],
[[shopos-rider-pool-had-no-switch]], [[shopos-half-a-rule]].
