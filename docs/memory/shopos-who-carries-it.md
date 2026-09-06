---
name: shopos-who-carries-it
description: "delivery_provider defaults to platform now; the setting had NO control anywhere, and PHP vs SQL resolve an absent key differently"
metadata: 
  node_type: memory
  type: project
  originSessionId: a4ba9d48-2a02-4ea8-81fb-a04eeaffd6b9
  modified: 2026-09-06T18:26:41.179Z
---

`delivery_provider` (CartZe rider pool vs the shop's own riders) defaulted to
`self` and had **no control on any panel screen** — a grep across the whole
panel returned nothing. So the entire platform-rider path (staged widening,
`TellShopNobodyTookIt`, accept race, rider board) was built, tested and
unreachable. Now defaults to `platform`, with a control at Shop Settings →
Order fulfillment → Who delivers.

**Why:** a shop that joins a marketplace has joined its riders. The wrong
default costs a three-minute delay, not an order — nobody taking it raises
`TellShopNobodyTookIt` and the shop can still assign its own rider.

**How to apply:** the key is read on two sides that disagree about an ABSENT
key — `Tenant::setting()` merges `ShopSettings::defaults()`, while
`RiderService::platformShopIds()` queries the JSON column where absent is SQL
NULL and matches nothing. Every existing shop is in that state. Flipping only
the default would offer every order and show it to nobody. `platformShopIds()`
now asks `defaults()` what absent means, so a future flip is one edit.

Two existing tests leaned on `self` being the default, so they tested the
default rather than the opt-out; both now state `self` on the row. See
[[shopos-switch-with-nothing-behind-it]], [[shopos-offered-must-be-reachable]],
[[shopos-half-a-rule]], [[shopos-rider-side]].
